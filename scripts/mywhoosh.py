"""MyWhoosh → Garmin Connect, présenté comme enregistré par ton Garmin Edge 540.

Pourquoi : Garmin ne calcule la charge, l'effet d'entraînement, la VO2max et le statut que pour
ses appareils et ses partenaires certifiés (Zwift, Rouvy…), pas pour MyWhoosh.

Ce que fait ce module, à chaque passage de la mise à jour :
  1. connexion à MyWhoosh (identifiants dans les secrets GitHub, jamais écrits ni affichés) ;
  2. liste des dernières séances, téléchargement du fichier FIT des nouvelles ;
  3. réécriture de l'en-tête du fichier : fabricant Garmin, modèle Edge 540, numéro de série et
     firmware de TON Edge 540 (lus sur ton compte Garmin) ; puissance, cardio, cadence intacts ;
  4. contrôle du fichier réécrit (mêmes points, même puissance), puis envoi sur Garmin Connect.

Sécurité : les identifiants restent dans les secrets GitHub ; le jeton MyWhoosh ne vit qu'en mémoire ;
le numéro de série n'est jamais affiché ni enregistré ; le dépôt public ne contient que des empreintes
(SHA-256 tronquées) des séances déjà traitées.
Au premier passage, les séances existantes sont seulement mémorisées : rien n'est renvoyé.

Logique de réécriture reprise de Fit-File-Faker (jat255, MIT) ; API MyWhoosh d'après
mywhoosh-to-garmin (marcelorodrigo, GPL-3.0).
"""
import hashlib
import json
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from garminconnect import GarminConnectTooManyRequestsError

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "data" / "mywhoosh_sync.json"
GARMIN, EDGE_540, EDGE_540_FW = 1, 4061, 2922   # identifiants FIT (FIT SDK 21.188)
SOURCES = {0, 255, 331, 260, 32, 289, 294, 307}  # fabricants « applis » à remplacer (dont MyWhoosh = 331)
API = "https://service14.mywhoosh.com/v2/rider/profile"
MAX_PER_RUN, MAX_BYTES = 5, 25 * 1024 * 1024


def _h(s):
    return hashlib.sha256(str(s).encode()).hexdigest()[:16]


# ------------------------------------------------------------------ MyWhoosh
def login(email, password):
    r = requests.post("https://services.mywhoosh.com/http-service/api/login", timeout=30, json={
        "Username": email, "Password": password, "Platform": "Android", "Action": 1001,
        "CorrelationId": str(uuid.uuid4()), "DeviceId": str(uuid.uuid4()), "Authorization": ""})
    r.raise_for_status()
    d = r.json()
    if not d.get("Success") or not d.get("AccessToken"):
        raise RuntimeError("connexion MyWhoosh refusée (vérifie les secrets MYWHOOSH_EMAIL / MYWHOOSH_PASSWORD)")
    return d["AccessToken"], d["WhooshId"]


def activities(token, limit=15):
    r = requests.post(f"{API}/activities", timeout=30, json={"page": 1, "limit": limit, "sortDate": "DESC"},
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    r.raise_for_status()
    d = r.json()
    if isinstance(d, dict):
        d = d.get("data", d)
        if isinstance(d, dict):
            d = d.get("results", [])
    return [a for a in (d if isinstance(d, list) else []) if isinstance(a, dict) and a.get("activityFileId")]


def download(token, whoosh_id, file_id, dest):
    r = requests.post(f"{API}/download-activity-file", timeout=30, json={"key": whoosh_id, "fileId": file_id},
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    r.raise_for_status()
    url = r.json().get("data")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("lien de téléchargement invalide")
    f = requests.get(url, timeout=60, stream=True)
    f.raise_for_status()
    data = b""
    for chunk in f.iter_content(65536):
        data += chunk
        if len(data) > MAX_BYTES:
            raise RuntimeError("fichier anormalement gros, ignoré")
    if len(data) < 14 or data[8:12] != b".FIT":
        raise RuntimeError("le fichier reçu n'est pas un FIT")
    dest.write_bytes(data)


# ------------------------------------------------------------------ Ton Edge 540 (numéro de série + firmware)
def edge540(api):
    try:
        devs = api.get_devices() or []
    except Exception as e:
        print(f"MyWhoosh : liste des appareils Garmin indisponible ({type(e).__name__})")
        devs = []
    for d in devs:
        name = " ".join(str(d.get(k) or "") for k in ("productDisplayName", "displayName", "deviceName", "partNumber"))
        if "540" not in name:
            continue
        serial = d.get("unitId") or d.get("serialNumber")
        try:
            serial = int(serial)
        except (TypeError, ValueError):
            continue
        fw = EDGE_540_FW
        for k in ("currentFirmwareVersion", "softwareVersion", "firmwareVersion"):
            v = d.get(k)
            try:
                fw = int(round(float(str(v).split()[0]) * 100)) if v else fw
                break
            except ValueError:
                pass
        if 1_000_000_000 <= serial <= 4_294_967_295:
            return serial, fw
    return None, EDGE_540_FW


# ------------------------------------------------------------------ Réécriture du fichier FIT
FIT_EPOCH = 631065600  # 31/12/1989 en secondes Unix
GAP = 5                # trou de plus de 5 s entre deux points = pause


def _np(powers):
    """Puissance normalisée (moyenne glissante 30 s, puissance 4)."""
    if len(powers) < 30:
        return None
    s, roll = sum(powers[:30]), []
    for i in range(30, len(powers) + 1):
        roll.append((s / 30) ** 4)
        if i < len(powers):
            s += powers[i] - powers[i - 30]
    return round((sum(roll) / len(roll)) ** 0.25)


def _summary(pts, t0, t1):
    """Résumé d'une portion de séance (points entre t0 inclus et t1 exclu, en ms)."""
    p = [r for r in pts if t0 <= r["t"] < t1]
    timer = moving = 0.0
    work = 0.0
    for a, b in zip(p, p[1:] + [None]):
        dt = 1.0 if b is None else (b["t"] - a["t"]) / 1000
        if dt > GAP:
            dt = 1.0
        timer += dt
        if (a["v"] or 0) > 0.5:
            moving += dt
        work += (a["w"] or 0) * dt
    before = [r["d"] for r in pts if r["t"] < t0 and r["d"] is not None]
    dist = max(0.0, (p[-1]["d"] or 0) - (before[-1] if before else 0)) if p else 0.0
    ws = [r["w"] for r in p if r["w"] is not None]
    hs = [r["h"] for r in p if r["h"]]
    cs = [r["c"] for r in p if r["c"]]
    vs = [r["v"] for r in p if r["v"] is not None]
    alt = [r["a"] for r in p if r["a"] is not None]
    up = sum(max(0, b - a) for a, b in zip(alt, alt[1:]))
    down = sum(max(0, a - b) for a, b in zip(alt, alt[1:]))
    return dict(n=len(p), timer=timer, moving=moving, elapsed=(t1 - t0) / 1000, dist=dist, work=work,
                avg_w=round(sum(ws) / len(ws)) if ws else None, max_w=max(ws) if ws else None, np=_np(ws),
                avg_h=round(sum(hs) / len(hs)) if hs else None, max_h=max(hs) if hs else None,
                avg_c=round(sum(cs) / len(cs)) if cs else None, max_c=max(cs) if cs else None,
                avg_v=dist / timer if timer else None, max_v=max(vs) if vs else None,
                up=round(up), down=round(down))


def disguise(src, dst, serial, fw):
    """Reconstruit la séance comme l'écrirait un Garmin Edge 540.

    Les points (puissance, cardio, cadence, vitesse, distance, position virtuelle) sont recopiés tels quels.
    Les résumés écrits par MyWhoosh sont souvent faux (un seul tour de 10 min, horodatages au départ,
    heure locale décalée de 20 ans) : tours, séance, évènements et activité sont donc recalculés à partir
    des points, sinon Garmin affiche un temps de déplacement et une vitesse moyenne absurdes.
    Retourne (début UTC en ms, nb de points, somme des watts).
    """
    from zoneinfo import ZoneInfo
    from fit_tool.definition_message import DefinitionMessage
    from fit_tool.fit_file import FitFile
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.activity_message import ActivityMessage
    from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
    from fit_tool.profile.messages.event_message import EventMessage
    from fit_tool.profile.messages.file_creator_message import FileCreatorMessage
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.hrv_message import HrvMessage
    from fit_tool.profile.messages.lap_message import LapMessage
    from fit_tool.profile.messages.record_message import RecordMessage
    from fit_tool.profile.messages.session_message import SessionMessage

    def put(m, **kw):  # n'écrit que les valeurs connues
        for k, v in kw.items():
            if v is not None:
                setattr(m, k, v)
        return m

    fit = FitFile.from_file(str(src))
    recs, hrv, laps0, sess0, fid0 = [], [], [], None, None
    for rec in fit.records:
        m = rec.message
        if isinstance(m, RecordMessage) and m.timestamp:
            recs.append(m)
        elif isinstance(m, HrvMessage):
            hrv.append(m)
        elif isinstance(m, LapMessage) and m.start_time:
            laps0.append(m)
        elif isinstance(m, SessionMessage) and sess0 is None:
            sess0 = m
        elif isinstance(m, FileIdMessage) and fid0 is None:
            fid0 = m
    if not recs:
        raise RuntimeError("séance sans données")
    recs.sort(key=lambda m: m.timestamp)
    # contournement d'un bug de fit_tool : les champs inconnus (propres à l'appli) corrompent la réécriture
    for m in recs + hrv:
        dm = getattr(m, "definition_message", None)
        if dm is not None and {fd.field_id for fd in dm.field_definitions} - {f.field_id for f in m.fields if f.is_valid()}:
            m.definition_message = None

    pts = [dict(t=m.timestamp, w=m.power, h=m.heart_rate, c=m.cadence, d=m.distance,
                v=m.enhanced_speed if m.enhanced_speed is not None else m.speed,
                a=m.enhanced_altitude if m.enhanced_altitude is not None else m.altitude) for m in recs]
    start, end = pts[0]["t"], pts[-1]["t"] + 1000
    sport, sub = (sess0.sport if sess0 and sess0.sport is not None else 2), (sess0.sub_sport if sess0 and sess0.sub_sport is not None else 58)

    # tours : on garde les débuts de tour de MyWhoosh, le dernier va jusqu'à la fin
    cuts = sorted({start} | {l.start_time for l in laps0 if start < l.start_time < end - 30_000})
    bounds = list(zip(cuts, cuts[1:] + [end]))
    S = _summary(pts, start, end)
    cal = sess0.total_calories if sess0 and sess0.total_calories else round(S["work"] / 1000 * 1.0)

    b = FitFileBuilder(auto_define=True, min_string_size=50)

    def add(m):
        b.add(DefinitionMessage.from_data_message(m))
        b.add(m)

    add(put(FileIdMessage(), type=4, manufacturer=GARMIN, product=EDGE_540, serial_number=serial,
            time_created=(fid0.time_created if fid0 and fid0.time_created else start)))
    add(put(FileCreatorMessage(), software_version=fw))
    add(put(EventMessage(), timestamp=start, event=0, event_type=0, event_group=0))           # chrono : départ
    add(put(DeviceInfoMessage(), timestamp=start, device_index=0, manufacturer=GARMIN, product=EDGE_540,
            serial_number=serial, software_version=fw / 100, source_type=5))                  # l'Edge lui-même
    prev = None
    for m in recs:
        if prev is not None and (m.timestamp - prev) / 1000 > GAP:                             # pause
            add(put(EventMessage(), timestamp=prev + 1000, event=0, event_type=4, event_group=0))
            add(put(EventMessage(), timestamp=m.timestamp, event=0, event_type=0, event_group=0))
        b.add(m)
        prev = m.timestamp
    for m in hrv:
        b.add(m)
    add(put(EventMessage(), timestamp=end, event=0, event_type=4, event_group=0))             # chrono : arrêt

    def fill(m, s, t0, t1):
        return put(m, timestamp=t1, start_time=t0, total_elapsed_time=s["elapsed"], total_timer_time=s["timer"],
                   total_moving_time=s["moving"], total_distance=s["dist"], total_work=round(s["work"]),
                   avg_speed=s["avg_v"], enhanced_avg_speed=s["avg_v"], max_speed=s["max_v"], enhanced_max_speed=s["max_v"],
                   avg_power=s["avg_w"], max_power=s["max_w"], normalized_power=s["np"],
                   avg_heart_rate=s["avg_h"], max_heart_rate=s["max_h"], avg_cadence=s["avg_c"], max_cadence=s["max_c"],
                   total_ascent=s["up"], total_descent=s["down"], sport=sport, sub_sport=sub, event=9, event_type=1)

    for i, (t0, t1) in enumerate(bounds):
        s = _summary(pts, t0, t1)
        lap = fill(LapMessage(), s, t0, t1)
        put(lap, message_index=i, lap_trigger=(7 if i == len(bounds) - 1 else 0),
            total_calories=round(cal * s["work"] / S["work"]) if S["work"] else None)
        add(lap)
    ses = fill(SessionMessage(), S, start, end)
    put(ses, message_index=0, first_lap_index=0, num_laps=len(bounds), trigger=0, total_calories=cal,
        total_ascent=(sess0.total_ascent if sess0 and sess0.total_ascent else S["up"]))
    add(ses)
    off = int(datetime.fromtimestamp(end / 1000, ZoneInfo("Europe/Paris")).utcoffset().total_seconds())
    add(put(ActivityMessage(), timestamp=end, total_timer_time=S["timer"], num_sessions=1, type=0, event=26,
            event_type=1, local_timestamp=int(end / 1000) + off - FIT_EPOCH))
    b.build().to_file(str(dst))

    # contrôle : mêmes points, mêmes watts, même cardio, en-tête Garmin Edge 540, séance cohérente
    f = FitFile.from_file(str(dst))
    out = [r.message for r in f.records if isinstance(r.message, RecordMessage)]
    fid = next((r.message for r in f.records if isinstance(r.message, FileIdMessage)), None)
    so = next((r.message for r in f.records if isinstance(r.message, SessionMessage)), None)
    if (len(out) != len(recs) or sum(m.power or 0 for m in out) != sum(m.power or 0 for m in recs)
            or sum(m.heart_rate or 0 for m in out) != sum(m.heart_rate or 0 for m in recs)
            or not fid or fid.manufacturer != GARMIN or fid.product != EDGE_540
            or not so or abs((so.total_timer_time or 0) - S["timer"]) > 2 or so.timestamp != end):
        raise RuntimeError("contrôle du fichier réécrit échoué, séance non envoyée")
    return start, len(recs), sum(m.power or 0 for m in recs)


# ------------------------------------------------------------------ Garmin : doublons
def on_garmin(api, start_ms):
    """Cherche une activité Garmin qui démarre à ±3 min : renvoie 'garmin', 'autre' ou None."""
    try:
        recent = api.get_activities(0, 30) or []
    except Exception:
        return None
    for g in recent:
        s = g.get("startTimeGMT")
        if not s:
            continue
        t = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp() * 1000
        if abs(t - start_ms) <= 180_000:
            man = str(g.get("manufacturer") or "").upper()
            return "garmin" if man == "GARMIN" else "autre"
    return None


# ------------------------------------------------------------------ Point d'entrée
def run(api):
    email, password = os.environ.get("MYWHOOSH_EMAIL", "").strip(), os.environ.get("MYWHOOSH_PASSWORD", "").strip()
    if not email or not password:
        return
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    done, fails = list(state.get("done", [])), dict(state.get("fails", {}))  # done : du plus ancien au plus récent
    token, wid = login(email, password)
    acts = activities(token)
    if not state.get("started"):
        state = {"started": True, "done": [_h(a["activityFileId"]) for a in reversed(acts)],
                 "last": {"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "msg": f"{len(acts)} séances existantes mémorisées"}}
        STATE.write_text(json.dumps(state, indent=1))
        print(f"MyWhoosh : {len(acts)} séances existantes mémorisées ; les prochaines partiront sur Garmin comme un Edge 540.")
        return
    new = [a for a in reversed(acts) if _h(a["activityFileId"]) not in done][:MAX_PER_RUN]
    if not new:
        print("MyWhoosh : rien de nouveau.")
        return
    serial, fw = edge540(api)
    if not serial:
        # pas d'Edge 540 trouvé sur le compte : numéro stable dérivé du compte MyWhoosh (jamais affiché)
        serial = 1_000_000_000 + int(_h(wid), 16) % 3_000_000_000
        print("MyWhoosh : Edge 540 introuvable sur ton compte Garmin, numéro de série de remplacement utilisé.")
    tmp = Path(tempfile.mkdtemp())
    msgs = []
    for a in new:
        key, name = _h(a["activityFileId"]), str(a.get("name") or a.get("title") or "séance")[:60]
        try:
            raw, fit = tmp / f"mw_{key}.fit", tmp / f"BreizhWatts_{key}.fit"
            download(token, wid, a["activityFileId"], raw)
            start, npts, watts = disguise(raw, fit, serial, fw)
            dup = on_garmin(api, start) if start else None
            if dup == "garmin":
                msgs.append(f"« {name} » déjà sur Garmin")
            elif dup == "autre":
                msgs.append(f"« {name} » ignorée : MyWhoosh l'a déjà envoyée sur Garmin (coupe la synchro MyWhoosh → Garmin)")
            else:
                try:
                    api.upload_activity(str(fit))
                    msgs.append(f"« {name} » envoyée sur Garmin comme Edge 540 ({npts} points)")
                except Exception as e:
                    if "409" not in str(e) and "uplicate" not in str(e):
                        raise
                    msgs.append(f"« {name} » refusée par Garmin (doublon)")
            done.append(key)
            fails.pop(key, None)
        except (GarminConnectTooManyRequestsError, requests.ConnectionError, requests.Timeout) as e:
            # limite Garmin ou coupure réseau : pas la faute du fichier, on ne compte pas l'essai et on arrête là
            msgs.append(f"« {name} » non envoyée ({type(e).__name__}), nouvel essai au prochain passage")
            break
        except Exception as e:
            fails[key] = fails.get(key, 0) + 1
            if fails[key] >= 3:  # on n'insiste pas indéfiniment sur un fichier qui pose problème
                done.append(key)
                fails.pop(key)
                msgs.append(f"« {name} » abandonnée après 3 essais ({e if isinstance(e, RuntimeError) else type(e).__name__})")
            else:
                msgs.append(f"« {name} » non envoyée ({type(e).__name__}), nouvel essai au prochain passage")
        finally:
            for p in tmp.glob(f"*{key}*"):
                p.unlink(missing_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    for m in msgs:
        print("MyWhoosh : " + m)
    state["done"], state["fails"] = done[-300:], fails
    state["last"] = {"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "msg": " · ".join(msgs)}
    STATE.write_text(json.dumps(state, indent=1, ensure_ascii=False))
