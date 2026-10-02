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
from datetime import datetime, timezone
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
META_FILE = DATA / "meta.json"
CONFIG_FILE = ROOT / "config.json"
TOKEN_FILE = ROOT / ".garmin" / "tokens.enc"

MAX_TRACES = 30
MAX_POINTS = 160
PAGE = 200

CYCLING = {
    "cycling", "road_biking", "gravel_cycling", "mountain_biking", "cyclocross",
    "track_cycling", "recumbent_cycling", "bmx", "downhill_biking", "e_bike_fitness",
    "e_bike_mountain", "e_enduro_mtb", "enduro_mtb", "handcycling", "bike_commuting",
}
INDOOR_CYCLING = {"indoor_cycling", "virtual_ride", "indoor_handcycling"}


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


def private_trace(pts, radius):
    """Retire les points proches du départ et de l'arrivée (ton domicile n'apparaît pas)."""
    pts = [p for p in pts if p[0] is not None and p[1] is not None]
    if len(pts) < 10:
        return None
    if radius > 0:
        s, e = pts[0], pts[-1]
        pts = [p for p in pts if dist_m(p, s) > radius and dist_m(p, e) > radius]
    if len(pts) < 10:
        return None
    step = max(1, math.ceil(len(pts) / MAX_POINTS))
    return [[round(p[0], 4), round(p[1], 4)] for p in pts[::step]]


def fetch_trace(api, act_id, radius):
    try:
        det = api.get_activity_details(str(act_id), maxchart=10, maxpoly=1500)
    except GarminConnectTooManyRequestsError:
        raise
    except Exception as e:  # une trace manquante n'empêche pas le reste
        print(f"  trace {act_id} indisponible : {e}")
        return None
    poly = ((det or {}).get("geoPolylineDTO") or {}).get("polyline") or []
    return private_trace([(p.get("lat"), p.get("lon")) for p in poly], radius)


# ---------------------------------------------------------------- Activités
def kind(type_key):
    if type_key in INDOOR_CYCLING:
        return "VirtualRide"
    if type_key in CYCLING:
        return "Ride"
    return type_key or "other"


def slim(a):
    tk = (a.get("activityType") or {}).get("typeKey") or ""
    num = lambda k: a.get(k) or 0
    return {
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
        raw = fetch_all(api, only_recent=not full)
        if full:
            known = {}
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
