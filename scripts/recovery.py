"""Données sommeil / récupération (Garmin) + facteurs externes (Open-Meteo).

Appelé par fetch_garmin.py avec la session Garmin déjà ouverte.
Résultat : data/recovery.json, en accès libre (plus de code depuis octobre 2026).
L'ancien fichier chiffré data/recovery.enc est relu une dernière fois avec RECUP_CODE
pour ne rien perdre, puis supprimé.

Rattrapage progressif : à chaque passage, les 3 derniers jours sont rafraîchis
et jusqu'à BACKFILL_PER_RUN jours plus anciens sont ajoutés, pour ménager Garmin.
"""
import base64
import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ENC_FILE = ROOT / "data" / "recovery.enc"   # ancien format chiffré
JSON_FILE = ROOT / "data" / "recovery.json"
CONFIG_FILE = ROOT / "config.json"

START = date(2026, 1, 1)
REFRESH_DAYS = 3
BACKFILL_PER_RUN = 30
HYPNO_NIGHTS = 21          # nuits gardées avec le détail des phases
PBKDF2_ITER = 250_000
TZ = ZoneInfo("Europe/Paris")


# ------------------------------------------------------------------ Chiffrement
def _key(code, salt):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                      iterations=PBKDF2_ITER).derive(code.encode())


def encrypt(obj, code):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(code, salt)).encrypt(iv, json.dumps(obj, separators=(",", ":")).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": PBKDF2_ITER, "salt": b(salt), "iv": b(iv), "data": b(ct)}


def decrypt(env, code):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = lambda k: base64.b64decode(env[k])
    raw = AESGCM(_key(code, d("salt"))).decrypt(d("iv"), d("data"), None)
    return json.loads(raw)


# ------------------------------------------------------------------ Helpers
def num(x, nd=None):
    if isinstance(x, bool) or x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if nd is not None else round(v)


def local_from_gmt_ms(ms):
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(TZ)


def any_time(v):
    """Horodatage Garmin (ms epoch ou chaîne GMT) -> datetime locale."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return local_from_gmt_ms(v)
    return parse_gmt(v)


def series(items, bed, val_keys, time_keys):
    """[[minutes depuis le coucher, valeur], ...] moyenné par tranches de 5 min."""
    buckets = {}
    for it in items or []:
        if not isinstance(it, dict):
            continue
        v = next((it[k] for k in val_keys if isinstance(it.get(k), (int, float)) and not isinstance(it.get(k), bool)), None)
        t = next((any_time(it[k]) for k in time_keys if it.get(k)), None)
        if v is None or v <= 0 or t is None:
            continue
        m = int((t - bed).total_seconds() // 60)
        if -30 <= m <= 16 * 60:
            buckets.setdefault(m // 5 * 5, []).append(v)
    return [[m, round(sum(v) / len(v))] for m, v in sorted(buckets.items())]


def parse_gmt(s):
    """'2026-10-01T22:10:00.0' (GMT) -> datetime locale."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "")[:19])
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(TZ)


def parse_local_iso(s):
    return datetime.fromisoformat(s).replace(tzinfo=TZ)


def safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # une donnée absente ne bloque pas le reste
        name = getattr(fn, "__name__", "?")
        if "429" in str(e) or "TooManyRequests" in type(e).__name__:
            raise
        print(f"    {name}{a} indisponible : {type(e).__name__}")
        return None


# ------------------------------------------------------------------ Une journée Garmin
def stage_mapping(levels, dto):
    """Garmin code les phases 0..3 ; on vérifie la correspondance avec les totaux du jour."""
    default = {0: "deep", 1: "light", 2: "rem", 3: "awake"}
    totals = {}
    for l in levels:
        s, e = parse_gmt(l.get("startGMT")), parse_gmt(l.get("endGMT"))
        if s and e:
            k = int(l.get("activityLevel", -1))
            totals[k] = totals.get(k, 0) + (e - s).total_seconds()
    ref = {"deep": dto.get("deepSleepSeconds") or 0, "light": dto.get("lightSleepSeconds") or 0,
           "rem": dto.get("remSleepSeconds") or 0, "awake": dto.get("awakeSleepSeconds") or 0}
    if not totals or not any(ref.values()):
        return default
    # attribue chaque code au total le plus proche (sans doublon)
    best, used = {}, set()
    for k, v in sorted(totals.items(), key=lambda kv: -kv[1]):
        cands = sorted((abs(v - r), name) for name, r in ref.items() if name not in used)
        if cands:
            best[k] = cands[0][1]
            used.add(cands[0][1])
    err_best = sum(abs(totals[k] - ref[best[k]]) for k in best)
    err_def = sum(abs(totals.get(k, 0) - ref[n]) for k, n in default.items())
    return best if err_best < err_def * 0.8 else default


def fetch_day(api, d, with_hypno):
    ds = d.isoformat()
    rec = {"d": ds, "f": 1}   # f = journée déjà interrogée

    sl = safe(api.get_sleep_data, ds) or {}
    dto = sl.get("dailySleepDTO") or {}
    if dto.get("sleepTimeSeconds"):
        st, en = local_from_gmt_ms(dto.get("sleepStartTimestampGMT")), local_from_gmt_ms(dto.get("sleepEndTimestampGMT"))
        scores = dto.get("sleepScores") or {}
        rec.update({
            "bed": st.strftime("%Y-%m-%dT%H:%M") if st else None,
            "wake": en.strftime("%Y-%m-%dT%H:%M") if en else None,
            "sl": num(dto.get("sleepTimeSeconds")),
            "deep": num(dto.get("deepSleepSeconds")), "light": num(dto.get("lightSleepSeconds")),
            "rem": num(dto.get("remSleepSeconds")), "awake": num(dto.get("awakeSleepSeconds")),
            "score": num((scores.get("overall") or {}).get("value")),
            "resp": num(dto.get("averageRespirationValue"), 1),
            "spo2": num(dto.get("avgSpO2") or dto.get("averageSpO2Value"), 1),
            "sstress": num(dto.get("avgSleepStress"), 1),
            "bbch": num(sl.get("bodyBatteryChange")),
            "srhr": num(sl.get("restingHeartRate")),
        })
        levels = sl.get("sleepLevels") or []
        if with_hypno and levels:
            mp = stage_mapping(levels, dto)
            segs = []
            for l in levels:
                s, e = parse_gmt(l.get("startGMT")), parse_gmt(l.get("endGMT"))
                k = mp.get(int(l.get("activityLevel", -1)))
                if s and e and k:
                    segs.append([s.strftime("%Y-%m-%dT%H:%M"), round((e - s).total_seconds() / 60), k])
            rec["hyp"] = segs
        if with_hypno and st:
            rec["nhr"] = series(sl.get("sleepHeartRate"), st, ("value",), ("startGMT", "startTimeGMT"))
            rec["nv"] = 2

    hrv_full = safe(api.get_hrv_data, ds) or {}
    hrv = hrv_full.get("hrvSummary") or {}
    if with_hypno and rec.get("bed"):
        bed = parse_local_iso(rec["bed"])
        pts = series(hrv_full.get("hrvReadings"), bed, ("hrvValue", "value"), ("readingTimeGMT", "startGMT"))
        if not pts:
            pts = series(sl.get("hrvData"), bed, ("value", "hrvValue"), ("startGMT", "readingTimeGMT"))
        rec["nhrv"] = pts
    if hrv:
        b = hrv.get("baseline") or {}
        rec.update({
            "hrv": num(hrv.get("lastNightAvg")), "hrv7": num(hrv.get("weeklyAvg")),
            "hrvHi": num(hrv.get("lastNight5MinHigh")), "hrvSt": hrv.get("status"),
            "hrvLo": num(b.get("balancedLow")), "hrvUp": num(b.get("balancedUpper")),
        })

    tr = safe(api.get_morning_training_readiness, ds)
    if isinstance(tr, list):
        tr = sorted(tr, key=lambda x: x.get("timestamp") or "")[0] if tr else None
    if tr:
        rec.update({
            "tr": num(tr.get("score")), "trLvl": tr.get("level"), "trTxt": tr.get("feedbackShort"),
            "trSleep": num(tr.get("sleepScoreFactorPercent")), "trHrv": num(tr.get("hrvFactorPercent")),
            "trRec": num(tr.get("recoveryTimeFactorPercent")), "trLoad": num(tr.get("acwrFactorPercent")),
            "trStress": num(tr.get("stressHistoryFactorPercent")), "recov": num(tr.get("recoveryTime")),
        })

    su = safe(api.get_user_summary, ds) or {}
    if su:
        rec.update({
            "hrMin": num(su.get("minHeartRate")), "hrMax": num(su.get("maxHeartRate")),
            "rhr": num(su.get("restingHeartRate")), "stress": num(su.get("averageStressLevel")),
            "bbHi": num(su.get("bodyBatteryHighestValue")), "bbLo": num(su.get("bodyBatteryLowestValue")),
            "bbUp": num(su.get("bodyBatteryChargedValue")), "bbDn": num(su.get("bodyBatteryDrainedValue")),
            "steps": num(su.get("totalSteps")),
        })

    hr = safe(api.get_heart_rates, ds) or {}
    vals = [v[1] for v in (hr.get("heartRateValues") or []) if isinstance(v, (list, tuple)) and len(v) > 1 and isinstance(v[1], (int, float)) and v[1] > 0]
    if vals:
        rec["hrAvg"] = round(sum(vals) / len(vals))
        if rec.get("hrMin") is None:
            rec["hrMin"] = min(vals)
        if rec.get("hrMax") is None:
            rec["hrMax"] = max(vals)
    return rec


def body_battery_curve(api, d):
    bb = safe(api.get_body_battery, d.isoformat()) or []
    if isinstance(bb, dict):
        bb = [bb]
    out = []
    for entry in bb:
        for v in entry.get("bodyBatteryValuesArray") or []:
            if not isinstance(v, (list, tuple)) or len(v) < 2 or not v[0]:
                continue
            lvl = v[1] if len(v) == 2 else next((x for x in v[1:] if isinstance(x, int) and not isinstance(x, bool)), None)
            if isinstance(lvl, (int, float)) and 0 <= lvl <= 100:
                t = local_from_gmt_ms(v[0])
                if t.date() == d:
                    out.append([t.strftime("%H:%M"), int(lvl)])
    return sorted(out)


# ------------------------------------------------------------------ Météo / air (Open-Meteo, sans clé)
def get_json(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(full, timeout=40) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt == 2:
                print(f"  Open-Meteo indisponible ({e})")
                return None
            time.sleep(3)


HOURLY = "temperature_2m,relative_humidity_2m,surface_pressure,precipitation,wind_speed_10m,cloud_cover"


def weather(lat, lon, start, end):
    """Retourne {date_reveil: {...}} pour la nuit précédente (22 h -> 7 h)."""
    hours = {}
    today = date.today()
    arch_end = min(end, today - timedelta(days=6))
    chunks = []
    if start <= arch_end:
        chunks.append(("https://archive-api.open-meteo.com/v1/archive",
                       {"start_date": (start - timedelta(days=1)).isoformat(), "end_date": arch_end.isoformat()}))
    chunks.append(("https://api.open-meteo.com/v1/forecast", {"past_days": 8, "forecast_days": 1}))
    daily = {}
    for url, extra in chunks:
        j = get_json(url, {"latitude": lat, "longitude": lon, "hourly": HOURLY,
                           "daily": "sunrise,sunset,daylight_duration", "timezone": "Europe/Paris", **extra})
        if not j:
            continue
        h = j.get("hourly") or {}
        for i, t in enumerate(h.get("time") or []):
            hours[t] = {k: (h.get(k) or [None] * (i + 1))[i] for k in HOURLY.split(",")}
        dd = j.get("daily") or {}
        for i, t in enumerate(dd.get("time") or []):
            daily[t] = {"sunrise": (dd.get("sunrise") or [None])[i], "sunset": (dd.get("sunset") or [None])[i],
                        "daylight": (dd.get("daylight_duration") or [None])[i]}

    aq = get_json("https://air-quality-api.open-meteo.com/v1/air-quality",
                  {"latitude": lat, "longitude": lon, "hourly": "european_aqi,grass_pollen,birch_pollen",
                   "timezone": "Europe/Paris", "past_days": 92, "forecast_days": 1}) or {}
    aqh = aq.get("hourly") or {}
    air = {t: {"aqi": (aqh.get("european_aqi") or [None])[i], "grass": (aqh.get("grass_pollen") or [None])[i],
               "birch": (aqh.get("birch_pollen") or [None])[i]} for i, t in enumerate(aqh.get("time") or [])}

    out = {}
    d = start
    while d <= end:
        night = [(datetime.combine(d - timedelta(days=1), datetime.min.time()) + timedelta(hours=22 + i)).strftime("%Y-%m-%dT%H:00") for i in range(10)]
        rows = [hours[t] for t in night if t in hours]
        if rows:
            col = lambda k: [r[k] for r in rows if r.get(k) is not None]
            temps, hum, rain, wind, cloud = col("temperature_2m"), col("relative_humidity_2m"), col("precipitation"), col("wind_speed_10m"), col("cloud_cover")
            p_now = (hours.get(f"{d.isoformat()}T06:00") or {}).get("surface_pressure")
            p_before = (hours.get(f"{(d - timedelta(days=1)).isoformat()}T06:00") or {}).get("surface_pressure")
            a_rows = [air[t] for t in night if t in air]
            acol = lambda k: [r[k] for r in a_rows if r.get(k) is not None]
            dl = daily.get((d - timedelta(days=1)).isoformat()) or {}
            out[d.isoformat()] = {
                "tMin": round(min(temps), 1) if temps else None,
                "tAvg": round(sum(temps) / len(temps), 1) if temps else None,
                "hum": round(sum(hum) / len(hum)) if hum else None,
                "rain": round(sum(rain), 1) if rain else None,
                "wind": round(max(wind)) if wind else None,
                "cloud": round(sum(cloud) / len(cloud)) if cloud else None,
                "dP": round(p_now - p_before, 1) if p_now is not None and p_before is not None else None,
                "aqi": round(max(acol("aqi"))) if acol("aqi") else None,
                "pollen": round(max(acol("grass") + acol("birch")), 1) if (acol("grass") + acol("birch")) else None,
                "sunset": (dl.get("sunset") or "")[11:16] or None,
                "daylight": round(dl["daylight"] / 3600, 2) if dl.get("daylight") else None,
            }
        d += timedelta(days=1)
    return out



# ------------------------------------------------------------------ Profil d'entraînement (FTP, VO2max, zones)
def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def _num(v, lo, hi):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


def _date(d):
    for k in ("calendarDate", "date", "from", "startDate", "updatedDate"):
        v = d.get(k)
        if isinstance(v, str) and len(v) >= 10 and v[4] == "-":
            return v[:10]
    return None


def _raw(o, n=1500):
    try:
        return json.dumps(o, ensure_ascii=False)[:n]
    except Exception:
        return None


# ------------------------------------------------------------------ Profil course à pied (une fois par jour)
RACE_START = date(2025, 3, 1)       # historique des prédictions de course
LT_PACE_REF = 253                   # allure semi de février 2026 (4:13/km) : sert à départager l'échelle de la vitesse
LT_PACE_OK = (180, 360)             # allure seuil plausible : 3:00 à 6:00 /km
RACE_KEYS = (("5k", "time5k", 600, 3600), ("10k", "time10k", 1300, 7500),
             ("hm", "timehalfmarathon", 2800, 15000), ("m", "timemarathon", 5800, 30000))
PR_TYPES = {1: ("1k", 120, 900), 2: ("1mi", 200, 1500), 3: ("5k", 600, 3600), 4: ("10k", 1300, 7500),
            5: ("hm", 2800, 15000), 6: ("m", 5800, 30000), 7: ("long", 1000, 300000)}  # 7 : plus longue sortie, en mètres
RUN_RAW = {"runLt": 2500, "runRaces": 1500, "runRacesHist": 1200, "runTol": 2500, "runEndu": 2500,
           "runHill": 2500, "runPr": 2500}


class Throttled(Exception):
    """Garmin limite les requêtes (429) : on arrête les appels course, on réessaiera au prochain passage."""


def _run_call(fn, *a, **kw):
    """Appel indépendant : en cas d'échec le champ est absent (None), sauf 429 qui interrompt la série."""
    try:
        return fn(*a, **kw)
    except Exception as e:
        if "429" in str(e) or "TooManyRequests" in type(e).__name__:
            raise Throttled() from e
        print(f"    {getattr(fn, '__name__', '?')} indisponible : {type(e).__name__}")
        return None


def _dated(o):
    """(date, dict) pour chaque dict daté, y compris ceux rangés sous une clé « AAAA-MM-JJ »."""
    for d in _walk(o):
        dt = _date(d)
        if dt:
            yield dt, d
        for k, v in d.items():
            if isinstance(k, str) and len(k) >= 10 and k[4] == "-" and k[7] == "-" and isinstance(v, dict):
                yield k[:10], v


def pace_from_speed(v):
    """Vitesse du seuil lactique -> allure en s/km. Garmin la rend parfois à une autre échelle
    (ex. m/s ÷ 10, ou km/h) : on garde l'échelle qui donne une allure plausible, la plus proche de l'allure semi."""
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
        return None
    best = None
    for k in (1, 10, 1 / 3.6):
        pace = 1000 / (v * k)
        if LT_PACE_OK[0] <= pace <= LT_PACE_OK[1]:
            gap = abs(math.log(pace / LT_PACE_REF))
            if best is None or gap < best[0]:
                best = (gap, round(pace))
    return best[1] if best else None


def read_lt(resp):
    """Seuil lactique : {'pace': s/km, 'hr': bpm, 'd': date}. Absent si la vitesse n'est pas plausible."""
    for d in _walk(resp):
        pace = pace_from_speed(d.get("speed"))
        if pace:
            out = {"pace": pace}
            hr = _num(d.get("heartRate") if d.get("heartRate") is not None else d.get("hearRate"), 100, 220)
            if hr:
                out["hr"] = round(hr)
            dt = _date(d)
            if dt:
                out["d"] = dt
            return out
    return None


def _race_times(d):
    low = {str(k).lower().replace("_", ""): v for k, v in d.items()}
    t = {}
    for key, name, lo, hi in RACE_KEYS:
        v = _num(low.get(name), lo, hi)
        if v:
            t[key] = round(v)
    return t


def read_races(latest, hist_resps):
    """Prédictions du jour (secondes) + historique quotidien [date, 5k, 10k, semi, marathon] sans répéter les jours identiques."""
    out = {}
    for d in _walk(latest):
        t = _race_times(d)
        if t:
            out.update(t)
            dt = _date(d)
            if dt:
                out["d"] = dt
            break
    pts = {}
    for resp in hist_resps:
        for dt, d in _dated(resp):
            t = _race_times(d)
            if t:
                pts[dt] = [t.get(k) for k, *_ in RACE_KEYS]
    hist, last = [], None
    for dt, v in sorted(pts.items()):
        if v != last:
            hist.append([dt, *v])
            last = v
    if hist:
        out["hist"] = hist
    return out or None


def read_series(resp, keys, lo, hi, nd=0):
    """[[date, valeur]] : première clé numérique plausible de chaque ligne datée, un point par semaine (le dernier)."""
    pts = {}
    for dt, d in _dated(resp):
        v = next((_num(d.get(k), lo, hi) for k in keys if _num(d.get(k), lo, hi) is not None), None)
        if v is not None:
            pts[dt] = round(v, nd) if nd else round(v)
    weeks = {}
    for dt in sorted(pts):
        y, w, _ = date.fromisoformat(dt).isocalendar()
        weeks[(y, w)] = dt
    return [[dt, pts[dt]] for dt in sorted(weeks.values())]


def read_tol(resp):
    """Tolérance à la course (hebdo) : [[date, {champ: valeur}]] avec les champs de charge / ratio rendus par Garmin."""
    out = {}
    for dt, d in _dated(resp):
        f = {k: round(v, 2) for k, v in d.items() if isinstance(v, (int, float)) and not isinstance(v, bool)
             and any(w in k.lower() for w in ("load", "acwr", "ratio", "tolerance"))}
        if f:
            out[dt] = f
    return [[dt, out[dt]] for dt in sorted(out)]


def _day(v):
    """Jour (AAAA-MM-JJ) d'une chaîne ISO ou d'un horodatage en millisecondes (Garmin donne les deux)."""
    if isinstance(v, str) and len(v) >= 10 and v[4] == "-":
        return v[:10]
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 1e11:
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    return None


def read_pr(resp):
    """Records de course : {'5k': [secondes, date, id]}, 'long' en mètres. Les records vélo etc. sont ignorés."""
    out = {}
    items = resp if isinstance(resp, list) else [d for d in _walk(resp) if "typeId" in d]
    for it in items:
        if not isinstance(it, dict) or str(it.get("activityType", "")).lower() != "running":
            continue
        spec = PR_TYPES.get(it.get("typeId"))
        v = spec and _num(it.get("value"), spec[1], spec[2])
        if not v:
            continue
        dt = next((_day(it.get(k)) for k in ("prStartTimeLocalFormatted", "prStartTimeGmtFormatted", "actStartDateTimeInGMTFormatted",
                                              "prStartTimeGmt", "activityStartDateTimeInGMT") if _day(it.get(k))), None)
        if spec[0] not in out or (dt or "") >= (out[spec[0]][1] or ""):
            out[spec[0]] = [round(v, 1) if spec[0] == "long" else round(v), dt, it.get("activityId")]
    return out or None


def read_vo2_run(mm):
    """VO2max course : partie « generic » seulement (profile.vo2 reste celui du vélo, utilisé par le Plan)."""
    vo = {}
    for d in _walk(mm):
        sub = d.get("generic")
        if isinstance(sub, dict):
            v = _num(sub.get("vo2MaxPreciseValue"), 20, 95) or _num(sub.get("vo2MaxValue"), 20, 95)
            dt = _date(sub) or _date(d)
            if v and dt:
                vo[dt] = round(v, 1)
    return sorted(vo.items())


def fetch_run_profile(api, start, today, mm=None):
    """Bloc profile.run + extraits bruts. None si Garmin limite les requêtes (429) : on garde l'ancien bloc."""
    run, raw = {"d": today.isoformat()}, {}
    ds, td = start.isoformat(), today.isoformat()
    try:
        r = _run_call(api.get_lactate_threshold)
        raw["runLt"] = _raw(r, RUN_RAW["runLt"])
        lt = read_lt(r)
        if lt:
            run["lt"] = lt
        latest = _run_call(api.get_race_predictions)
        raw["runRaces"] = _raw(latest, RUN_RAW["runRaces"])
        hist, a = [], RACE_START
        while a <= today:  # l'API limite chaque demande à un an
            b = min(a + timedelta(days=365), today)
            h = _run_call(api.get_race_predictions, a.isoformat(), b.isoformat(), "daily")
            if h is not None:
                hist.append(h)
            a = b + timedelta(days=1)
            time.sleep(0.4)
        raw["runRacesHist"] = _raw(hist[-1] if hist else None, RUN_RAW["runRacesHist"])
        races = read_races(latest, hist)
        if races:
            run["races"] = races
        r = _run_call(api.get_running_tolerance, ds, td)
        raw["runTol"] = _raw(r, RUN_RAW["runTol"])
        tol = read_tol(r)
        if tol:
            run["tol"] = tol
        r = _run_call(api.get_endurance_score, ds, td)
        raw["runEndu"] = _raw(r, RUN_RAW["runEndu"])
        endu = read_series(r, ("overallScore", "groupAverage", "enduranceScore", "avg", "value"), 0, 30000)
        if endu:
            run["endu"] = endu
        r = _run_call(api.get_hill_score, ds, td)
        raw["runHill"] = _raw(r, RUN_RAW["runHill"])
        hill = read_series(r, ("overallScore", "hillScore", "score", "value"), 0, 200)
        if hill:
            run["hill"] = hill
        r = _run_call(api.get_personal_record)
        # réponse longue (un bloc par record) : on garde l'essentiel de chaque ligne pour pouvoir contrôler la lecture
        raw["runPr"] = _raw([[i.get("typeId"), i.get("activityType"), i.get("value"), i.get("status")] for i in r if isinstance(i, dict)]
                            if isinstance(r, list) else r, RUN_RAW["runPr"])
        pr = read_pr(r)
        if pr:
            run["pr"] = pr
    except Throttled:
        print("    profil course : Garmin limite les requêtes (429), on réessaiera au prochain passage.")
        return None
    vo = read_vo2_run(mm)
    if vo:
        run["vo2"] = vo
    return run, raw


def fetch_profile(api, start, today, prev=None):
    p, raw = {}, {}
    # FTP actuelle
    ftp = safe(api.get_cycling_ftp)
    raw["ftp"] = _raw(ftp)
    for d in _walk(ftp):
        v = _num(d.get("functionalThresholdPower"), 60, 700) or _num(d.get("ftp"), 60, 700) or _num(d.get("value"), 60, 700)
        if v:
            p["ftp"], p["ftpDate"] = round(v), _date(d)
            break
    # Historique FTP (hebdo)
    try:
        hist = api.get_functional_threshold_power_range(start.isoformat(), today.isoformat(), sport="CYCLING", aggregation="weekly")
    except Exception as e:
        hist = None
        print(f"    historique FTP indisponible : {type(e).__name__}")
    raw["ftpHist"] = _raw(hist, 800)
    pts = {}
    for d in _walk(hist):
        v = _num(d.get("value"), 60, 700) or _num(d.get("functionalThresholdPower"), 60, 700)
        dt = _date(d)
        if v and dt:
            pts[dt] = round(v)
    p["ftpHist"] = sorted(pts.items())
    # VO2max vélo (sinon générique)
    mm = safe(api.get_max_metrics_range, start.isoformat(), today.isoformat())
    raw["vo2"] = _raw(mm, 1200)
    vo = {}
    for d in _walk(mm):
        for key in ("cycling", "generic"):
            sub = d.get(key)
            if isinstance(sub, dict):
                v = _num(sub.get("vo2MaxPreciseValue"), 20, 95) or _num(sub.get("vo2MaxValue"), 20, 95)
                dt = _date(sub) or _date(d)
                if v and dt and (key == "cycling" or dt not in vo):
                    vo[dt] = round(v, 1)
    p["vo2"] = sorted(vo.items())
    # Zones cardio (profil vélo, sinon par défaut)
    zones = safe(api.get_heart_rate_zones) or []
    raw["zones"] = _raw(zones, 1500)
    cand = [z for z in _walk(zones) if any(k.startswith("zone") and k.endswith("Floor") for k in z)]
    pick = next((z for z in cand if str(z.get("sport", "")).upper() == "CYCLING"), None) or next((z for z in cand if str(z.get("sport", "")).upper() in ("DEFAULT", "")), None) or (cand[0] if cand else None)
    if pick:
        floors = [_num(pick.get(f"zone{i}Floor"), 40, 230) for i in range(1, 6)]
        p["hrZones"] = {
            "floors": floors, "max": _num(pick.get("maxHeartRateUsed"), 120, 230),
            "lthr": _num(pick.get("lactateThresholdHeartRateUsed"), 100, 220),
            "rest": _num(pick.get("restingHeartRateUsed"), 30, 100),
            "sport": pick.get("sport"), "method": pick.get("trainingMethod"),
        }
    # Course : rafraîchie une fois par jour (l'état précédent, s'il date d'aujourd'hui, est repris tel quel)
    old = prev or {}
    if (old.get("run") or {}).get("d") == today.isoformat():
        res = (old["run"], {k: v for k, v in (old.get("raw") or {}).items() if k in RUN_RAW})
    else:
        res = fetch_run_profile(api, start, today, mm)
        if res is None and old.get("run"):  # 429 : on garde les anciennes valeurs
            res = (old["run"], {k: v for k, v in (old.get("raw") or {}).items() if k in RUN_RAW})
    if res:
        p["run"] = res[0]
        raw.update(res[1])
    p["raw"] = raw
    return p

# ------------------------------------------------------------------ Point d'entrée
def run(api):
    code = os.environ.get("RECUP_CODE", "").strip()
    cfg = {}
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    lat, lon = float(cfg.get("latitude", 48.1173)), float(cfg.get("longitude", -1.6778))

    state = {"days": {}}
    if JSON_FILE.exists():
        try:
            state = json.loads(JSON_FILE.read_text(encoding="utf-8"))
        except Exception:
            print("Récup : fichier illisible, on repart de zéro.")
    elif ENC_FILE.exists() and code:
        try:
            state = decrypt(json.loads(ENC_FILE.read_text()), code)
            print("Récup : migration de l'ancien fichier chiffré vers recovery.json.")
        except Exception:
            print("Récup : ancien fichier chiffré illisible, on repart de zéro.")
    days = state.get("days", {})

    today = datetime.now(TZ).date()
    all_dates = [START + timedelta(days=i) for i in range((today - START).days + 1)]
    recent = all_dates[-REFRESH_DAYS:]
    hypno_from = today - timedelta(days=HYPNO_NIGHTS)
    def todo(d):
        r = days.get(d.isoformat(), {})
        return not r.get("f") or (d >= hypno_from and r.get("sl") and r.get("nv") != 2)
    missing = [d for d in reversed(all_dates[:-REFRESH_DAYS]) if todo(d)][:BACKFILL_PER_RUN]

    for d in recent + missing:
        old_wx = days.get(d.isoformat(), {}).get("wx")
        days[d.isoformat()] = fetch_day(api, d, with_hypno=d >= hypno_from)
        if old_wx:
            days[d.isoformat()]["wx"] = old_wx
        time.sleep(0.4)
    # on retire le détail des phases des nuits trop anciennes (fichier léger)
    for k, v in days.items():
        if k < hypno_from.isoformat():
            for f in ("hyp", "nhr", "nhrv"):
                v.pop(f, None)

    wx = weather(lat, lon, START, today)
    for k, v in wx.items():
        if k in days:
            days[k]["wx"] = v
        else:
            days[k] = {"d": k, "wx": v}
    for k, v in state.get("wx_cache", {}).items():  # garde l'historique air (limité à 92 j par l'API)
        if k in days and "wx" in days[k]:
            for f in ("aqi", "pollen"):
                if days[k]["wx"].get(f) is None and v.get(f) is not None:
                    days[k]["wx"][f] = v[f]

    new = {
        "days": dict(sorted(days.items())),
        "bb": body_battery_curve(api, today),
        "bbDate": today.isoformat(),
        "wx_cache": {k: {"aqi": v["wx"].get("aqi"), "pollen": v["wx"].get("pollen")} for k, v in days.items() if v.get("wx")},
        "pending": len([d for d in all_dates if not days.get(d.isoformat(), {}).get("f")]),
        "profile": fetch_profile(api, START, today, state.get("profile")),
    }
    strip = lambda x: {k: v for k, v in x.items() if k != "updated_at"}
    if JSON_FILE.exists() and strip(state) == new:
        print("Récup : rien de nouveau.")
        return True
    new["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    JSON_FILE.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if ENC_FILE.exists():
        ENC_FILE.unlink()
    print(f"Récup : {len(recent) + len(missing)} jours mis à jour, {len(days)} jours au total.")
    return True
