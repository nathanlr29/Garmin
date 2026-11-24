"""Séance clé course de la semaine → calendrier Garmin Connect → montre (demandes de Nathan des 23 et 24/11/2026 : « les intégrer sur ma montre
sans les retaper », puis « plus de jours de course »).

Le site (seances.js) dépose, pour la semaine en cours et la suivante, la séance clé dans la collection `montre` de la synchro
(Google Sheet + Apps Script, voir sync.js) : { id: "key:<lundi>", v: { mon, days, done, v, name, steps, sig } } ; days = jours conseillés,
done = validée sur le site, v nul = pas de séance clé cette semaine. À chaque passage du workflow, ce module :
  1. lit la collection (secret GitHub SYNC_LINK = le lien « Copier le lien de configuration » de la synchro, jamais affiché ni écrit) ;
  2. crée la séance dans Garmin Connect (allures cibles, répétitions) et la met au calendrier le premier jour conseillé à partir
     d'aujourd'hui : c'est la « séance du jour » de la montre. Pas faite ce jour-là : le lendemain, elle passe au jour conseillé suivant ;
  3. faite en la suivant sur la montre (Garmin relie l'activité : associatedActivityId) ou validée sur le site : elle ne bouge plus ;
  4. séance changée (palier, allures) : l'ancienne est retirée, la nouvelle créée ; plus de séance : retirée ; après 14 jours : supprimée ;
  5. écrit data/montre.json : { cfg, err?, probe, w: { lundi: { id, sid, s, date, done? } } } (identifiants Garmin, empreinte, jour prévu), que le
     site lit pour afficher « sur ta montre comme séance du jour, jeudi 26 ». Rien n'est écrit si rien ne change.
Seules les séances créées par ce module (identifiants dans data/montre.json) sont modifiées ou supprimées.
Format des séances Garmin : celui de garminconnect.workout (RunningWorkout, ExecutableStepDTO, RepeatGroupDTO), vérifié par tests/test_garmin.py
et par un essai réel sur le compte de Nathan le 24/11/2026 (probe).
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
KEEP = 14                      # jours gardés après la semaine
URL_RE = re.compile(r"^https://script\.google\.com/(a/macros/[\w.-]+|macros)/s/[\w-]+/exec$")
STEP = {"warmup": (1, "warmup", 1), "cooldown": (2, "cooldown", 2), "interval": (3, "interval", 3), "recovery": (4, "recovery", 4)}
SPORT = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}


def log(msg):
    print(f"Montre : {msg}")


def why(x):
    """Erreur → texte sûr pour le journal public : type et code HTTP seulement (le message d'une erreur réseau contient l'adresse du
    script de synchro, qui ne doit jamais être publiée)."""
    code = getattr(getattr(x, "response", None), "status_code", None) or getattr(x, "status_code", None)
    return f"{type(x).__name__}{f' (HTTP {code})' if isinstance(code, int) else ''}"


def gone(x):
    """Garmin répond « introuvable » (séance retirée à la main) : seul cas où l'on oublie ce qu'on avait mis au calendrier."""
    code = getattr(getattr(x, "response", None), "status_code", None) or getattr(x, "status_code", None)
    return code == 404 or type(x).__name__ == "GarminConnectNotFoundError" or bool(re.search(r"\b404\b", str(x)))


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
    """FNV-1a 32 bits du JSON de la séance { v, name, steps } : même calcul que Seances.sig (seances.js) ; les jours n'en font pas partie
    (changer de jour ne recrée pas la séance chez Garmin)."""
    body = {"v": v.get("v"), "name": v.get("name"), "steps": v.get("steps")}
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
    return isinstance(s.get("n", ""), str) and len(s.get("n", "")) <= 40


DATE_RE = re.compile(r"^\d{4}-\d\d-\d\d$")


def valid(v, mon):
    """Séance reçue de la Sheet : on refuse ce qui n'a pas la forme attendue plutôt que d'envoyer n'importe quoi à Garmin."""
    if not isinstance(v, dict) or v.get("mon") != mon or v.get("v") != 1 or not isinstance(v.get("done", False), bool):
        return False
    days, sun = v.get("days"), (date.fromisoformat(mon) + timedelta(days=6)).isoformat()
    if not isinstance(days, list) or len(days) > 7 or not all(isinstance(d, str) and DATE_RE.match(d) and mon <= d <= sun for d in days) or days != sorted(set(days)):
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
        return {k: x for k, x in st.items() if x is not None}

    def rep(s):
        o = nxt()
        return {"type": "RepeatGroupDTO", "stepOrder": o, "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
                "numberOfIterations": s["rep"], "smartRepeat": False,
                "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
                "endConditionValue": float(s["rep"]), "workoutSteps": [ex(x) for x in s["steps"]]}

    steps = [rep(s) if "rep" in s else ex(s) for s in v["steps"]]
    return {"workoutName": v["name"], "description": "Breizh Watts · séance clé course", "sportType": SPORT, "author": {},
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


def wanted(items):
    """Séances de la Sheet par semaine : { lundi: v | None } ; les illisibles à part. Pure, testée."""
    want, bad = {}, []
    for it in items:
        m = re.match(r"^key:(\d{4}-\d\d-\d\d)$", str(it.get("id", "")))
        if not m:
            continue
        mon, v = m.group(1), it.get("v")
        if v is None:
            want[mon] = None
        elif valid(v, mon) and v.get("sig") == sig(v):
            want[mon] = v
        else:
            bad.append(mon)
    return want, bad


def sync_watch(api, items, state, today):
    """Met Garmin en accord avec la Sheet, semaine par semaine. L'état suit chaque opération réussie : une erreur au milieu ne fait
    jamais créer deux fois la même séance (elle est retirée puis recréée au passage suivant)."""
    want, bad = wanted(items)
    for m in bad:
        log(f"séance de la semaine du {m} illisible : ignorée")
    W, err, acts = {k: dict(x) for k, x in state.get("w", {}).items()}, None, []
    old = (date.fromisoformat(today) - timedelta(days=KEEP)).isoformat()
    try:
        for mon in sorted(set(W) | set(want)):
            sun = (date.fromisoformat(mon) + timedelta(days=6)).isoformat()
            e = W.get(mon)
            if sun < old:                                   # vieille semaine : la séance quitte la bibliothèque Garmin
                if e:
                    _drop(api, e)
                    W.pop(mon)
                    acts.append(f"{mon} supprimée (ancienne)")
                continue
            if sun < today or mon not in want:              # semaine passée, ou dont le site n'a rien dit : on n'y touche pas
                continue
            # faite en suivant la séance de la montre : Garmin a relié une activité à la séance prévue
            if e and not e.get("done") and e.get("sid") and e.get("date") and e["date"] <= today:
                try:
                    r = api.get_scheduled_workout_by_id(e["sid"])
                except Exception as x:
                    log(f"get_scheduled_workout_by_id {e['sid']} : {why(x)}")
                    if not gone(x):                         # panne passagère : on ne touche à rien cette semaine (sinon doublon)
                        continue
                    r, e["sid"], e["date"] = None, None, None   # retirée à la main du calendrier Garmin : on la remettra
                act = r.get("associatedActivityId") if isinstance(r, dict) else None
                if act:
                    e["done"] = act if isinstance(act, int) else True
                    acts.append(f"{mon} faite le {e['date']} (suivie sur la montre)")
            v = want[mon]
            if e and e.get("site") and v is not None and not v.get("done"):   # validation annulée sur le site : elle revient
                W.pop(mon)
                e = None
                acts.append(f"{mon} validation annulée sur le site")
            if e and e.get("done"):
                continue
            if v is None or v.get("done"):                  # plus de séance clé, ou validée sur le site sans la montre
                if e:
                    _drop(api, e)
                W.pop(mon, None)
                if v is not None:
                    W[mon] = {"s": v["sig"], "done": True, "site": True}
                if e or v is not None:
                    acts.append(f"{mon} {'validée sur le site' if v else 'retirée'}")
                continue
            if e and e.get("s") != v["sig"]:                # autre palier, autres allures : on la recrée
                _drop(api, e)
                W.pop(mon)
                e = None
                acts.append(f"{mon} remplacée")
            target = next((d for d in v["days"] if d >= today), None)
            if not e:
                if not target:
                    continue
                r = api.upload_workout(garmin_json(v))
                wid = r.get("workoutId") if isinstance(r, dict) else None
                if not isinstance(wid, int):
                    raise RuntimeError("Garmin n'a pas rendu d'identifiant de séance")
                e = W[mon] = {"id": wid, "sid": None, "s": v["sig"], "date": None}
                acts.append(f"{mon} « {v['name']} » créée")
            if e.get("date") != target:
                if e.get("sid"):
                    try:
                        api.unschedule_workout(e["sid"])
                    except Exception as x:
                        log(f"unschedule_workout {e['sid']} : {type(x).__name__}")
                e["sid"], e["date"] = None, None
                if target:
                    e["sid"], e["date"] = _sched_id(api.schedule_workout(e["id"], target)), target
                    acts.append(f"{mon} séance du jour le {target}")
    except Exception as x:
        log(f"erreur {why(x)}")
        err = type(x).__name__
    log(f"{len(items)} élément(s) dans la synchro, {sum(1 for v in want.values() if v)} séance(s) clé(s) ; " + ("; ".join(acts) if acts else "rien à changer"))
    out = {**state, "cfg": True, "w": dict(sorted(W.items()))}
    out.pop("err", None)
    if err:
        out["err"] = err
    return out


# Essai réel, une fois (puis une fois par jour tant qu'il échoue) : une séance d'essai est créée, mise au calendrier dans 60 jours,
# retirée du calendrier puis supprimée. Vérifie le format et les droits côté Garmin avant la première vraie séance, sans rien laisser.
PROBE = {"v": 1, "name": "Breizh Watts essai", "steps": [
    {"t": "warmup", "s": 600, "p": None, "n": "Échauffement"},
    {"rep": 2, "steps": [{"t": "interval", "s": 240, "p": [264, 272], "n": "Seuil 4:28"}, {"t": "recovery", "s": 60, "p": None, "n": "Trot"}]},
    {"t": "cooldown", "s": 300, "p": None, "n": "Retour au calme"}]}


def probe(api, today):
    wid = sid = None
    try:
        r = api.upload_workout(garmin_json(PROBE))
        wid = r.get("workoutId") if isinstance(r, dict) else None
        if not isinstance(wid, int):
            raise RuntimeError("pas d'identifiant de séance dans la réponse de Garmin")
        sr = api.schedule_workout(wid, (date.fromisoformat(today) + timedelta(days=60)).isoformat())
        sid = _sched_id(sr)
        log(f"essai : séance créée et mise au calendrier (champs de la réponse : {sorted(sr) if isinstance(sr, dict) else type(sr).__name__})")
        out = {"ok": True, "d": today}
    except Exception as e:
        log(f"essai refusé par Garmin : {why(e)}")
        out = {"ok": False, "d": today, "err": type(e).__name__}
    finally:
        if wid:
            _drop(api, {"id": wid, "sid": sid})
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
        pr = st.get("probe") or {}
        if api is not None and not pr.get("ok") and pr.get("d") != today:
            st["probe"] = probe(api, today)
        try:
            new = sync_watch(api, read_collection(*cfg, post=post), {**st, "v": 1}, today)
        except Exception as e:
            log(f"erreur {why(e)}")
            new = {**st, "v": 1, "cfg": True, "err": type(e).__name__}
    if {k: x for k, x in new.items() if k != "at"} != {k: x for k, x in old.items() if k != "at"}:
        new["at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        STATE.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n")
    return new
