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
def disguise(src, dst, serial, fw):
    """Réécrit l'appareil en Garmin Edge 540. Retourne (début UTC, nb de points, somme des watts)."""
    from fit_tool.definition_message import DefinitionMessage
    from fit_tool.fit_file import FitFile
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.activity_message import ActivityMessage
    from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
    from fit_tool.profile.messages.file_creator_message import FileCreatorMessage
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.record_message import RecordMessage
    from fit_tool.profile.messages.session_message import SessionMessage

    def put(m, field, value):  # un champ absent du fichier d'origine ne peut pas toujours être ajouté
        try:
            setattr(m, field, value)
        except Exception:
            pass

    fit = FitFile.from_file(str(src))
    # contournement d'un bug de fit_tool : les champs inconnus (propres à l'appli) corrompent la réécriture
    for rec in fit.records:
        m = rec.message
        dm = getattr(m, "definition_message", None)
        if dm is None or not hasattr(m, "fields"):
            continue
        have = {f.field_id for f in m.fields if f.is_valid()}
        if {fd.field_id for fd in dm.field_definitions} - have:
            m.definition_message = None

    b = FitFileBuilder(auto_define=True, min_string_size=50)
    deferred, skipped0, start = [], False, None
    for rec in fit.records:
        m = rec.message
        if isinstance(m, ActivityMessage):
            deferred.append(m)
            continue
        if m.global_id == FileIdMessage.ID:
            if isinstance(m, DefinitionMessage):
                continue
            if isinstance(m, FileIdMessage):
                n = FileIdMessage()
                n.time_created = m.time_created or int(datetime.now().timestamp() * 1000)
                if m.type:
                    n.type = m.type
                n.serial_number, n.manufacturer, n.product = serial, GARMIN, EDGE_540
                start = start or n.time_created
                b.add(DefinitionMessage.from_data_message(n)); b.add(n)
                c = FileCreatorMessage(); c.software_version = fw
                b.add(DefinitionMessage.from_data_message(c)); b.add(c)
                continue
        if m.global_id == FileCreatorMessage.ID:
            continue
        if m.global_id == DeviceInfoMessage.ID and isinstance(m, DeviceInfoMessage):
            if m.device_type == 0:          # même traitement que Fit-File-Faker
                skipped0 = True
                continue
            if skipped0 and m.device_index is not None:
                m.device_index = m.device_index - 1
            if m.manufacturer in SOURCES:
                put(m, "manufacturer", GARMIN)
                if m.product is not None:
                    put(m, "product", EDGE_540)
                if getattr(m, "garmin_product", None) is not None:
                    put(m, "garmin_product", EDGE_540)
                put(m, "product_name", "")
                if m.device_index in (0, None):
                    put(m, "serial_number", serial)
                    put(m, "software_version", fw / 100)
        if isinstance(m, SessionMessage) and m.start_time:
            start = m.start_time
        b.add(m)
    for m in deferred:
        b.add(m)
    b.build().to_file(str(dst))

    # contrôle : le fichier réécrit doit garder exactement les mêmes données
    def stats(path):
        f = FitFile.from_file(str(path))
        recs = [r.message for r in f.records if isinstance(r.message, RecordMessage)]
        fid = next((r.message for r in f.records if isinstance(r.message, FileIdMessage)), None)
        return len(recs), sum(m.power or 0 for m in recs), sum(m.heart_rate or 0 for m in recs), fid
    a, out = stats(src), stats(dst)
    if a[:3] != out[:3] or not out[3] or out[3].manufacturer != GARMIN or out[3].product != EDGE_540:
        raise RuntimeError("contrôle du fichier réécrit échoué, séance non envoyée")
    if not a[0]:
        raise RuntimeError("séance sans données")
    return start, a[0], a[1]


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
