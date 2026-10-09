#!/usr/bin/env python3
"""Récupère tes activités Garmin Connect et écrit les fichiers data/*.json lus par index.html.

Secrets GitHub utilisés :
  GARMIN_TOKENS  jetons de connexion créés une fois sur ton Mac (scripts/garmin_setup.py)
  GARMIN_KEY     phrase secrète qui chiffre les jetons renouvelés

Garmin renouvelle régulièrement les jetons. Les derniers sont donc gardés dans
le dépôt, chiffrés (.garmin/tokens.enc), et déchiffrables uniquement avec GARMIN_KEY.
Ton mot de passe Garmin n'est jamais stocké nulle part.
"""
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ACTIVITIES_FILE = DATA / "activities.json"
TRACES_FILE = DATA / "traces.json"
ROUTES_FILE = DATA / "routes.json"
META_FILE = DATA / "meta.json"
CONFIG_FILE = ROOT / "config.json"
TOKEN_FILE = ROOT / ".garmin" / "tokens.enc"

MAX_TRACES = 30
MAX_POINTS = 160
# Parcours pour « Refaire une sortie Garmin » (onglet Sortie) : sorties vélo dehors de 20 km et plus, sur 2 ans
ROUTE_POINTS = 400
ROUTE_MIN_M = 20000
ROUTE_DAYS = 730
ROUTES_PER_RUN = 10   # récupérées petit à petit pour ménager Garmin
NOT_OUTDOOR = ("whoosh", "zwift", "home trainer", "hometrainer", "rouvy")
PAGE = 200

CYCLING = {
    "cycling", "road_biking", "gravel_cycling", "mountain_biking", "cyclocross",
    "track_cycling", "recumbent_cycling", "bmx", "downhill_biking", "e_bike_fitness",
    "e_bike_mountain", "e_enduro_mtb", "enduro_mtb", "handcycling", "bike_commuting",
}
INDOOR_CYCLING = {"indoor_cycling", "virtual_ride", "indoor_handcycling"}
# Course à pied : mêmes clés que charge.js (RUN_TYPES). Tapis et course virtuelle : pas de GPS publié.
RUN_TYPES = {"running", "trail_running", "treadmill_running", "track_running", "virtual_run"}
NO_GPS_TYPES = {"VirtualRide", "treadmill_running", "virtual_run"}


# ---------------------------------------------------------------- Jetons chiffrés
def _openssl(args, data):
    key = os.environ.get("GARMIN_KEY", "")
    if not key:
        sys.exit("Secret GARMIN_KEY manquant (voir README, étape 3).")
    r = subprocess.run(
        ["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-a", "-A",
         *args, "-pass", "env:GARMIN_KEY"],
        input=data, capture_output=True, env={**os.environ, "GARMIN_KEY": key},
    )
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors="replace"))
    return r.stdout


def read_tokens():
    """Jetons les plus récents : fichier chiffré du dépôt, sinon le secret GARMIN_TOKENS."""
    if TOKEN_FILE.exists():
        try:
            return _openssl(["-d"], TOKEN_FILE.read_bytes()).decode()
        except Exception:
            print("Fichier de jetons illisible (GARMIN_KEY changée ?), on repart du secret GARMIN_TOKENS.")
    return os.environ.get("GARMIN_TOKENS", "").strip() or None


def save_tokens(api):
    new = api.client.dumps()
    old = None
    if TOKEN_FILE.exists():
        try:
            old = _openssl(["-d"], TOKEN_FILE.read_bytes()).decode()
        except Exception:
            pass
    # On ne réécrit (=> commit) que si le jeton de renouvellement a changé.
    if old and json.loads(old).get("di_refresh_token") == json.loads(new).get("di_refresh_token"):
        return
    TOKEN_FILE.parent.mkdir(exist_ok=True)
    TOKEN_FILE.write_bytes(_openssl(["-e", "-salt"], new.encode()))


def connect():
    tokens = read_tokens()
    email, pwd = os.environ.get("GARMIN_EMAIL", "").strip(), os.environ.get("GARMIN_PASSWORD", "")
    if not tokens and not (email and pwd):
        sys.exit("Secret GARMIN_TOKENS manquant (voir README, étapes 2 et 3).")
    # Plan B (README) : sans jetons, connexion par e-mail / mot de passe (comptes sans MFA)
    api = Garmin(email or None, pwd or None, retry_attempts=3)
    try:
        api.login(tokens)
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin limite les connexions (429). Le prochain passage réessaiera.")
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        sys.exit(
            "Garmin refuse les jetons : refais l'étape 2 du README (garmin_setup.py) "
            f"puis remplace le secret GARMIN_TOKENS.\nDétail : {e}"
        )
    return api


# ---------------------------------------------------------------- Traces
def dist_m(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def private_trace(pts, radius, max_points=MAX_POINTS):
    """Retire les points proches du départ et de l'arrivée (ton domicile n'apparaît pas)."""
    pts = [p for p in pts if p[0] is not None and p[1] is not None]
    if len(pts) < 10:
        return None
    if radius > 0:
        s, e = pts[0], pts[-1]
        pts = [p for p in pts if dist_m(p, s) > radius and dist_m(p, e) > radius]
    if len(pts) < 10:
        return None
    step = max(1, math.ceil(len(pts) / max_points))
    return [[round(p[0], 4), round(p[1], 4)] for p in pts[::step]]


def fetch_trace(api, act_id, radius, max_points=MAX_POINTS):
    try:
        det = api.get_activity_details(str(act_id), maxchart=10, maxpoly=1500)
    except GarminConnectTooManyRequestsError:
        raise
    except Exception as e:  # une trace manquante n'empêche pas le reste
        print(f"  trace {act_id} indisponible : {e}")
        return None
    poly = ((det or {}).get("geoPolylineDTO") or {}).get("polyline") or []
    return private_trace([(p.get("lat"), p.get("lon")) for p in poly], radius, max_points)


def update_routes(api, acts, radius):
    """data/routes.json : tracés (tronqués autour du départ et de l'arrivée) des sorties vélo dehors à refaire."""
    routes = {int(k): v for k, v in load(ROUTES_FILE, {}).items()}
    cut = (datetime.now(timezone.utc) - timedelta(days=ROUTE_DAYS)).strftime("%Y-%m-%d")
    want = [a["id"] for a in reversed(acts)
            if a["t"] == "Ride" and not a["tr"] and a["m"] >= ROUTE_MIN_M and a["d"][:10] >= cut
            and not any(w in (a.get("n") or "").lower() for w in NOT_OUTDOOR)]
    out, fetched = {}, 0
    for i in want:
        if i in routes:
            out[i] = routes[i]
        elif fetched < ROUTES_PER_RUN:
            out[i] = fetch_trace(api, i, radius, ROUTE_POINTS)  # None = pas de GPS, mémorisé
            fetched += 1
            time.sleep(0.5)
    if out != routes:
        dump(ROUTES_FILE, {str(k): v for k, v in out.items()})
    missing = sum(1 for i in want if i not in out)
    print(f"Parcours : {sum(1 for v in out.values() if v)} disponibles, {fetched} récupérés, {missing} restants.")


# ---------------------------------------------------------------- Activités
def kind(type_key):
    if type_key in INDOOR_CYCLING:
        return "VirtualRide"
    if type_key in CYCLING:
        return "Ride"
    return type_key or "other"


PC_DUR = (5, 60, 300, 1200, 3600)  # meilleures puissances (s) pour la FTP détectée


def power_curve(a):
    pc = {}
    for d in PC_DUR:
        v = a.get(f"maxAvgPower_{d}")
        if isinstance(v, (int, float)) and v > 0:
            pc[str(d)] = round(v)
    if "1200" not in pc and isinstance(a.get("max20MinPower"), (int, float)) and a["max20MinPower"] > 0:
        pc["1200"] = round(a["max20MinPower"])
    return pc


def slim(a):
    tk = (a.get("activityType") or {}).get("typeKey") or ""
    num = lambda k: a.get(k) or 0
    out = {
        "id": a["activityId"],
        "n": a.get("activityName") or "",
        "t": kind(tk),
        "tk": tk,
        "d": (a.get("startTimeLocal") or "").replace(" ", "T")[:19],
        "m": round(num("distance")),
        "mt": round(num("movingDuration") or num("duration")),
        "et": round(num("elapsedDuration") or num("duration")),
        "el": round(num("elevationGain")),
        "cal": round(num("calories")),
        "hr": round(num("averageHR")),
        "w": round(num("avgPower")),
        "np": round(num("normPower")),
        "vmax": round(num("maxSpeed") * 3.6, 1),
        "tl": round(num("activityTrainingLoad")),
        "te": round(num("aerobicTrainingEffect"), 1),
        "tr": 1 if tk in INDOOR_CYCLING else 0,
    }
    pc = power_curve(a)
    if pc:
        out["pc"] = pc
    # temps passé dans chaque zone Garmin (s) : secours du bilan quand le détail de la séance manque
    for key, field, n in (("pz", "powerTimeInZone_", 7), ("hz", "hrTimeInZone_", 5)):
        z = [a.get(f"{field}{i}") for i in range(1, n + 1)]
        if any(isinstance(v, (int, float)) and v > 0 for v in z):
            out[key] = [round(v) if isinstance(v, (int, float)) else 0 for v in z]
    return out


# ---------------------------------------------------------------- Détail des séances (bilan)
STREAMS = DATA / "streams"
STREAM_INDEX = STREAMS / "index.json"
STREAM_DAYS = 42      # on analyse les sorties des 6 dernières semaines
STREAM_KEEP = 120     # et on garde 4 mois d'historique
STREAM_PER_RUN = 6    # téléchargements maximum par passage, pour ménager Garmin
STREAM_BINS = 1200    # au plus 1 200 points par séance


def fit_records(blob):
    """Points « record » d'un FIT (ou du zip « original » de Garmin)."""
    import io
    import zipfile
    import fitdecode

    data = blob
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = next((n for n in z.namelist() if n.lower().endswith(".fit")), None)
            if not name:
                return []
            data = z.read(name)
    out = []
    with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.DISABLED) as fr:
        for f in fr:
            if isinstance(f, fitdecode.FitDataMessage) and f.name == "record":
                out.append({fl.name: fl.value for fl in f.fields if fl.value is not None})
    return out


def sport_of(a):
    """'bike' pour le vélo (dehors ou virtuel), 'run' pour la course, None pour le reste."""
    if a["t"] in ("Ride", "VirtualRide"):
        return "bike"
    return "run" if a["t"] in RUN_TYPES else None


def _in(v, lo, hi):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


def build_stream(act_id, recs, radius, run=False):
    """Séance ramenée à des pas réguliers : puissance, cardio, cadence, vitesse, altitude, position.
    Course (run=True) : cadence en pas/min, et si le FIT les donne, longueur de pas (sl, cm),
    temps de contact au sol (gct, ms) et oscillation verticale (vo, cm)."""
    recs = [r for r in recs if isinstance(r.get("timestamp"), datetime)]
    if len(recs) < 60:
        return None
    t0 = recs[0]["timestamp"]
    span = (recs[-1]["timestamp"] - t0).total_seconds()
    if span < 300:
        return None
    dt = max(5, int(math.ceil(span / STREAM_BINS / 5)) * 5)
    n = int(span // dt) + 1
    keys = ("p", "h", "c", "v", "a", "la", "lo", "sl", "gct", "vo")
    acc = {k: [[0.0, 0] for _ in range(n)] for k in keys}
    has = set()
    deg = 180 / 2 ** 31

    def put(k, i, v):
        if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
            acc[k][i][0] += v
            acc[k][i][1] += 1
            has.add(k)

    for r in recs:
        i = min(n - 1, int((r["timestamp"] - t0).total_seconds() // dt))
        put("p", i, r.get("power"))
        put("h", i, r.get("heart_rate") if (r.get("heart_rate") or 0) > 0 else None)
        cad = r.get("cadence")
        if run and isinstance(cad, (int, float)) and not isinstance(cad, bool):
            # le FIT compte les cycles (une jambe) par minute : × 2 pour des pas/min, fractional_cadence en plus
            cad = (cad + (r.get("fractional_cadence") if isinstance(r.get("fractional_cadence"), (int, float)) else 0)) * 2
        put("c", i, cad)
        if run:  # unités FIT : mm pour la longueur de pas et l'oscillation, ms pour le contact au sol
            sl, vo = _in(r.get("step_length"), 200, 3000), _in(r.get("vertical_oscillation"), 10, 400)
            put("sl", i, sl / 10 if sl else None)
            put("gct", i, _in(r.get("stance_time"), 80, 600))
            put("vo", i, vo / 10 if vo else None)
        sp = r.get("enhanced_speed", r.get("speed"))
        put("v", i, sp * 3.6 if isinstance(sp, (int, float)) else None)
        put("a", i, r.get("enhanced_altitude", r.get("altitude")))
        la, lo = r.get("position_lat"), r.get("position_long")
        if isinstance(la, int) and isinstance(lo, int) and (la or lo):
            put("la", i, la * deg)
            put("lo", i, lo * deg)

    def mean(k, i, nd=0):
        s, c = acc[k][i]
        return round(s / c, nd) if c else None

    out = {"id": act_id, "t0": t0.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "dt": dt, "n": n}
    if "p" in has:
        out["p"] = [None if v is None else int(v) for v in (mean("p", i) for i in range(n))]
    if "h" in has:
        out["h"] = [None if v is None else int(v) for v in (mean("h", i) for i in range(n))]
    if "c" in has:
        out["c"] = [None if v is None else int(v) for v in (mean("c", i) for i in range(n))]
    if "sl" in has:
        out["sl"] = [None if v is None else int(round(v)) for v in (mean("sl", i, 1) for i in range(n))]
    if "gct" in has:
        out["gct"] = [None if v is None else int(round(v)) for v in (mean("gct", i, 1) for i in range(n))]
    if "vo" in has:
        out["vo"] = [None if v is None else v for v in (mean("vo", i, 1) for i in range(n))]
    if "v" in has:
        out["v"] = [None if v is None else int(round(v * 10)) for v in (mean("v", i, 2) for i in range(n))]
    if "a" in has:
        out["a"] = [None if v is None else int(v) for v in (mean("a", i) for i in range(n))]
    if "la" in has:
        g = [(mean("la", i, 6), mean("lo", i, 6)) for i in range(n)]
        pts = [p for p in g if p[0] is not None]
        if len(pts) >= 10:
            s, e = pts[0], pts[-1]
            # comme pour les traces : rien autour du départ et de l'arrivée (ton domicile n'apparaît pas)
            out["g"] = [0 if p[0] is None or dist_m(p, s) <= radius or dist_m(p, e) <= radius
                        else [round(p[0], 4), round(p[1], 4)] for p in g]
    if not any(k in out for k in ("p", "h", "v")):
        return None
    return out


def update_streams(api, acts, radius):
    """Télécharge le détail des nouvelles sorties (vélo et course), purge les vieux fichiers.
    index.json : "s" = "bike" ou "run" (les entrées plus anciennes, sans "s", sont du vélo)."""
    STREAMS.mkdir(exist_ok=True)
    index = load(STREAM_INDEX, {})
    now = datetime.now()
    age = lambda d: (now - datetime.strptime(d[:10], "%Y-%m-%d")).days
    for k, v in list(index.items()):  # purge
        if age(v.get("d", "1970-01-01")) > STREAM_KEEP:
            (STREAMS / f"{k}.json").unlink(missing_ok=True)
            index.pop(k)
    todo = [a for a in reversed(acts)
            if sport_of(a) and a["mt"] >= 600 and age(a["d"]) <= STREAM_DAYS
            and str(a["id"]) not in index][:STREAM_PER_RUN]
    done = 0
    for a in todo:
        try:
            blob = api.download_activity(a["id"], dl_fmt=api.ActivityDownloadFormat.ORIGINAL)
            st = build_stream(a["id"], fit_records(blob), radius, run=sport_of(a) == "run")
        except GarminConnectTooManyRequestsError:
            print("Bilan : Garmin limite les requêtes (429), on reprendra au prochain passage.")
            break
        except Exception as e:  # séance sans fichier (saisie manuelle…) : on ne redemandera pas
            print(f"Bilan : détail de {a['id']} indisponible ({type(e).__name__})")
            st = None
        if st and a["t"] in NO_GPS_TYPES:
            st.pop("g", None)  # position virtuelle (ou tapis) : sans intérêt, et rien à publier
        if st:
            (STREAMS / f"{a['id']}.json").write_text(json.dumps(st, separators=(",", ":")), encoding="utf-8")
            done += 1
        index[str(a["id"])] = {"d": a["d"][:10], "ok": 1 if st else 0, "s": sport_of(a)}
        time.sleep(0.5)
    STREAM_INDEX.write_text(json.dumps(index, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    if todo:
        print(f"Bilan : {done} séance(s) détaillée(s) sur {len(todo)} demandée(s).")


def fetch_all(api, only_recent=False):
    out, start = [], 0
    while True:
        batch = api.get_activities(start, 50 if only_recent else PAGE) or []
        out.extend(batch)
        if only_recent or len(batch) < PAGE:
            break
        start += PAGE
        time.sleep(0.5)
    return out


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    DATA.mkdir(exist_ok=True)
    radius = float(load(CONFIG_FILE, {}).get("rayon_confidentialite_m", 400))
    meta = load(META_FILE, {})
    old_acts = load(ACTIVITIES_FILE, [])
    known = {a["id"]: a for a in old_acts}
    traces = {int(k): v for k, v in load(TRACES_FILE, {}).items()}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    full = meta.get("full_sync_on") != today or not known or os.environ.get("FULL_SYNC") == "1"

    api = connect()
    try:
        # MyWhoosh → Garmin (fichier présenté comme venant de ton Edge 540) : avant la récupération des activités
        try:
            import mywhoosh
            mywhoosh.run(api)
        except GarminConnectTooManyRequestsError:
            raise
        except Exception as e:
            print(f"MyWhoosh : erreur {type(e).__name__} : {e}")
        raw = fetch_all(api, only_recent=not full)
        if full:
            known = {}
        sample = next((a for a in raw if a.get("avgPower")), None)
        if sample:
            print("Champs puissance Garmin :", sorted(k for k in sample if "ower" in k)[:40])
        for a in raw:
            if a.get("activityId"):
                known[a["activityId"]] = slim(a)
        acts = sorted(known.values(), key=lambda a: a["d"])

        # Traces : seulement pour les sorties récentes en extérieur pas encore connues
        want = [a["id"] for a in reversed(acts) if not a["tr"] and a["m"] > 0][:MAX_TRACES]
        new_traces = {}
        for i in want:
            if i in traces:
                new_traces[i] = traces[i]
            else:
                # None = pas de GPS : mémorisé pour ne pas redemander à chaque passage
                new_traces[i] = fetch_trace(api, i, radius)
                time.sleep(0.3)
        # Bilan de séance : détail seconde par seconde des sorties récentes (une erreur ici ne bloque rien)
        try:
            update_streams(api, acts, radius)
        except Exception as e:
            print(f"Bilan : erreur {type(e).__name__} : {e}")
        # Parcours à refaire (onglet Sortie) : une erreur ou une limite Garmin ici ne bloque rien
        try:
            update_routes(api, acts, radius)
        except GarminConnectTooManyRequestsError:
            print("Parcours : Garmin limite les requêtes (429), on continuera au prochain passage.")
        except Exception as e:
            print(f"Parcours : erreur {type(e).__name__} : {e}")
        # Onglet Récup (sommeil, VFC, FC…) : une erreur ici ne bloque pas les sorties vélo
        try:
            import recovery
            recovery.run(api)
        except GarminConnectTooManyRequestsError:
            print("Récup : Garmin limite les requêtes (429), on réessaiera au prochain passage.")
        except Exception as e:
            print(f"Récup : erreur {type(e).__name__} : {e}")
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin limite les requêtes (429). Le prochain passage réessaiera.")
    finally:
        try:
            save_tokens(api)
        except Exception as e:
            print(f"Attention : jetons renouvelés non sauvegardés ({e})")

    changed = acts != old_acts or new_traces != traces
    dump(ACTIVITIES_FILE, acts)
    dump(TRACES_FILE, {str(k): v for k, v in new_traces.items()})
    if changed or full:
        dump(META_FILE, {
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "full_sync_on": today,
            "count": len(acts),
            "source": "garmin",
        })
    print(f"{'Synchro complète' if full else 'Synchro incrémentale'} : "
          f"{len(raw)} activités reçues, {len(acts)} au total, {sum(1 for v in new_traces.values() if v)} traces.")


if __name__ == "__main__":
    main()
