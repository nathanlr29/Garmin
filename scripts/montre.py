"""Séances clés course → calendrier Garmin Connect → montre (demande de Nathan du 23/11/2026 : « les intégrer sur ma montre sans les retaper »).

Le site (seances.js) dépose les séances clés des 8 prochains jours dans la collection `montre` de la synchro
(Google Sheet + Apps Script, voir sync.js) : { id: "run:AAAA-MM-JJ", v: { date, v, name, steps, sig } }, v nul = plus de séance ce jour-là.
À chaque passage du workflow, ce module :
  1. lit la collection (secret GitHub SYNC_LINK = le lien « Copier le lien de configuration » de la synchro, jamais affiché ni écrit) ;
  2. pour chaque jour à venir dont la séance a changé : retire l'ancienne de Garmin Connect, crée la nouvelle (allures cibles, répétitions)
     et la place dans le calendrier, d'où la montre la reçoit à sa synchro ;
  3. retire les séances qui ne sont plus prévues, et celles de plus de 14 jours (bibliothèque Garmin propre) ;
  4. écrit data/montre.json : { cfg, err?, w: { date: { id, sid, s } } } (identifiants Garmin des séances créées et empreinte), que le site
     lit pour afficher « ✓ dans ton calendrier Garmin ». Rien n'est écrit si rien ne change (pas de commit ni de déploiement inutile).
Seules les séances créées par ce module (identifiants dans data/montre.json) sont modifiées ou supprimées.
Format des séances Garmin : celui de garminconnect.workout (RunningWorkout, ExecutableStepDTO, RepeatGroupDTO), vérifié par tests/test_garmin.py.
"""
import base64
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "data" / "montre.json"
COL = "montre"
AHEAD, KEEP = 8, 14            # jours à venir pris en compte ; jours gardés après la date
URL_RE = re.compile(r"^https://script\.google\.com/(a/macros/[\w.-]+|macros)/s/[\w-]+/exec$")
STEP = {"warmup": (1, "warmup", 1), "cooldown": (2, "cooldown", 2), "interval": (3, "interval", 3), "recovery": (4, "recovery", 4)}
SPORT = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}


def log(msg):
    print(f"Montre : {msg}")


# ------------------------------------------------------------------ Lecture de la synchro
def parse_link(raw, why=None):
    """Lien « …#sync=<base64> » (ou le code seul) → (url, clé), None si illisible ; why (liste) reçoit la raison, sans rien du secret.
    Tolérant : espaces, guillemets, « # » encodé (%23), texte autour du lien."""
    def no(r):
        if why is not None:
            why.append(r)
        return None
    raw = (raw or "").strip().strip("'\"<>").strip()
    if not raw:
        return no("vide")
    m = re.search(r"sync=([A-Za-z0-9_\-+/=]+)", raw)
    if m:
        code = m.group(1)
    elif re.fullmatch(r"[A-Za-z0-9_\-+/=]{20,}", raw):
        code = raw
    elif raw.startswith("https://script.google.com/"):
        return no("c'est l'adresse du script seule, sans la clé : il faut le lien « Copier le lien de configuration » (…#sync=…)")
    else:
        return no("pas de « #sync= » dans la valeur : il faut le lien « Copier le lien de configuration » des réglages de synchro")
    try:
        code = code.replace("-", "+").replace("_", "/").rstrip("=")
        o = json.loads(base64.b64decode(code + "=" * (-len(code) % 4)).decode("utf-8"))
    except Exception:
        return no("le code après « #sync= » est tronqué ou abîmé : recopie le lien en entier")
    if not isinstance(o, dict):
        return no("contenu inattendu")
    if not URL_RE.match(str(o.get("url", ""))):
        return no("l'adresse du script dans le lien n'est pas une adresse script.google.com/…/exec")
    if len(str(o.get("key", ""))) < 16:
        return no("la clé dans le lien fait moins de 16 caractères")
    return o["url"], o["key"]


def read_collection(url, key, post=requests.post):
    # même requête que le site : POST text/plain, la clé dans le corps ; Apps Script répond par une redirection suivie en GET
    r = post(url, data=json.dumps({"k": key, "op": "sync", "c": COL, "items": []}), timeout=40,
             headers={"Content-Type": "text/plain;charset=utf-8"}, allow_redirects=True)
    r.raise_for_status()
    j = r.json()
    if not j.get("ok"):
        raise RuntimeError(f"synchro refusée ({j.get('err')})")
    return j.get("items") or []


# ------------------------------------------------------------------ Séance : validation, empreinte, format Garmin
def sig(v):
    """FNV-1a 32 bits du JSON de la séance sans « sig » : même calcul que Seances.sig (seances.js)."""
    body = {k: x for k, x in v.items() if k != "sig"}
    h = 0x811C9DC5
    for b in json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _ok_step(s):
    if not isinstance(s, dict) or s.get("t") not in STEP:
        return False
    sec, p = s.get("s"), s.get("p")
    if not isinstance(sec, int) or isinstance(sec, bool) or not 0 <= sec <= 3 * 3600:
        return False
    if p is not None and not (isinstance(p, list) and len(p) == 2 and all(isinstance(x, int) and 150 <= x <= 600 for x in p) and p[0] <= p[1]):
        return False
    h = s.get("h")   # cardio plafond des footings (bpm)
    if h is not None and (p is not None or not (isinstance(h, list) and len(h) == 2 and all(isinstance(x, int) and not isinstance(x, bool) and 60 <= x <= 215 for x in h) and h[0] < h[1])):
        return False
    return isinstance(s.get("n", ""), str) and len(s.get("n", "")) <= 40


def valid(v, day):
    """Séance reçue de la Sheet : on refuse ce qui n'a pas la forme attendue plutôt que d'envoyer n'importe quoi à Garmin."""
    if not isinstance(v, dict) or v.get("date") != day or v.get("v") != 1:
        return False
    name, steps = v.get("name"), v.get("steps")
    if not isinstance(name, str) or not 0 < len(name) <= 60 or not isinstance(steps, list) or not 0 < len(steps) <= 20:
        return False
    n = 0
    for s in steps:
        if isinstance(s, dict) and "rep" in s:
            sub = s.get("steps")
            if not isinstance(s["rep"], int) or not 1 <= s["rep"] <= 40 or not isinstance(sub, list) or not 0 < len(sub) <= 4 or not all(_ok_step(x) for x in sub):
                return False
            n += len(sub) + 1
        elif _ok_step(s):
            n += 1
        else:
            return False
    return n <= 40


def total(steps):
    return sum(s["rep"] * total(s["steps"]) if "rep" in s else s["s"] for s in steps)


def garmin_json(v):
    """Séance (spec de seances.js) → JSON de l'API workout-service de Garmin Connect (allures en m/s, la plus lente en premier)."""
    order = [0]

    def nxt():
        order[0] += 1
        return order[0]

    def ex(s):
        tid, key, disp = STEP[s["t"]]
        st = {"type": "ExecutableStepDTO", "stepOrder": nxt(),
              "stepType": {"stepTypeId": tid, "stepTypeKey": key, "displayOrder": disp},
              "endCondition": ({"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True} if s["s"]
                               else {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}),
              "endConditionValue": float(s["s"]) if s["s"] else None,
              "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
              "description": s.get("n") or None}
        if s.get("p"):
            fast, slow = s["p"]
            st["targetType"] = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}
            st["targetValueOne"], st["targetValueTwo"] = round(1000 / slow, 4), round(1000 / fast, 4)
        elif s.get("h"):   # footing : fourchette de cardio en bpm
            st["targetType"] = {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4}
            st["targetValueOne"], st["targetValueTwo"] = float(s["h"][0]), float(s["h"][1])
        return {k: x for k, x in st.items() if x is not None}

    def rep(s):
        o = nxt()
        return {"type": "RepeatGroupDTO", "stepOrder": o, "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
                "numberOfIterations": s["rep"], "smartRepeat": False,
                "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
                "endConditionValue": float(s["rep"]), "workoutSteps": [ex(x) for x in s["steps"]]}

    steps = [rep(s) if "rep" in s else ex(s) for s in v["steps"]]
    return {"workoutName": v["name"], "description": "Breizh Watts · séance course du Plan", "sportType": SPORT, "author": {},
            "estimatedDurationInSecs": int(total(v["steps"])),
            "workoutSegments": [{"segmentOrder": 1, "sportType": SPORT, "workoutSteps": steps}]}


# ------------------------------------------------------------------ Garmin Connect
def _drop(api, e):
    """Retire une séance créée par ce module (calendrier puis bibliothèque) ; une séance déjà supprimée à la main n'est pas une erreur."""
    for fn, x in (("unschedule_workout", e.get("sid")), ("delete_workout", e.get("id"))):
        if not x:
            continue
        try:
            getattr(api, fn)(x)
        except Exception as err:   # 404 : supprimée à la main dans Garmin Connect
            log(f"{fn} {x} : {type(err).__name__}")


def _sched_id(r):
    if isinstance(r, dict):
        for k in ("workoutScheduleId", "scheduleId", "id"):
            if isinstance(r.get(k), int):
                return r[k]
    return None


def plan(items, state, today):
    """Ce qu'il faut faire : (à créer {date: v}, à retirer [date]). Pure, testée."""
    want, bad = {}, []
    for it in items:
        m = re.match(r"^run:(\d{4}-\d\d-\d\d)$", str(it.get("id", "")))
        if not m:
            continue
        d, v = m.group(1), it.get("v")
        if not today <= d < (date.fromisoformat(today) + timedelta(days=AHEAD)).isoformat():
            continue
        if v is None:
            want[d] = None
        elif valid(v, d) and v.get("sig") == sig(v):
            want[d] = v
        else:
            bad.append(d)
    W = state.get("w", {})
    create = {d: v for d, v in want.items() if v is not None and (d not in W or W[d].get("s") != v["sig"])}
    old = (date.fromisoformat(today) - timedelta(days=KEEP)).isoformat()
    drop = sorted(d for d in W if (d in want and (want[d] is None or d in create)) or d < old)
    return create, drop, bad


def sync_watch(api, items, state, today):
    """Applique le plan ; l'état suit chaque opération réussie (une erreur au milieu ne fait jamais créer deux fois la même séance)."""
    create, drop, bad = plan(items, state, today)
    for d in bad:
        log(f"séance du {d} illisible : ignorée")
    W, err = dict(state.get("w", {})), None
    for d in drop:
        _drop(api, W.pop(d))
    for d, v in sorted(create.items()):
        try:
            r = api.upload_workout(garmin_json(v))
            wid = r.get("workoutId") if isinstance(r, dict) else None
            if not isinstance(wid, int):
                raise RuntimeError("Garmin n'a pas rendu d'identifiant de séance")
            W[d] = {"id": wid, "sid": None, "s": None}       # créée : retirée au passage suivant si la mise au calendrier échoue
            W[d] = {"id": wid, "sid": _sched_id(api.schedule_workout(wid, d)), "s": v["sig"]}
            log(f"{d} : « {v['name']} » dans le calendrier Garmin")
        except Exception as e:
            log(f"{d} : erreur {type(e).__name__} : {e}")
            err = type(e).__name__
            break
    out = {**state, "cfg": True, "w": dict(sorted(W.items()))}
    if err:
        out["err"] = err
    return out


def run(api, today=None, env=os.environ, post=requests.post):
    today = today or datetime.now(ZoneInfo("Europe/Paris")).date().isoformat()
    old = json.loads(STATE.read_text()) if STATE.exists() else {"v": 1, "w": {}}
    st = {k: x for k, x in old.items() if k not in ("err", "at")}
    why = []
    cfg = parse_link(env.get("SYNC_LINK"), why)
    if not cfg:
        new = {**st, "v": 1, "cfg": False}
        if env.get("SYNC_LINK"):
            log(f"secret SYNC_LINK illisible ({len(env['SYNC_LINK'].strip())} caractères) : {why[0] if why else 'raison inconnue'}")
    else:
        try:
            new = sync_watch(api, read_collection(*cfg, post=post), {**st, "v": 1}, today)
        except Exception as e:
            log(f"erreur {type(e).__name__} : {e}")
            new = {**st, "v": 1, "cfg": True, "err": type(e).__name__}
    if {k: x for k, x in new.items() if k != "at"} != {k: x for k, x in old.items() if k != "at"}:
        new["at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        STATE.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n")
    return new
