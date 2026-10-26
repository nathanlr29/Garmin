#!/usr/bin/env python3
"""Points d'arrêt OpenStreetMap (eau, ravito, toilettes, réparation, lieux à voir) préparés à l'avance.

Le site interrogeait Overpass depuis le navigateur au moment de la sortie : souvent saturé, donc trop souvent
sans réponse. Ici le workflow télécharge la Bretagne par carreaux de 0,5° (data/poi/<lat>_<lon>.json),
quelques carreaux par passage, et les rafraîchit tous les 14 jours. Le site lit ces fichiers et
n'appelle Overpass que pour la partie d'une trace hors de la zone.
Aucune donnée personnelle : la grille est fixe et ne dépend pas du point de départ.
"""
import json
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "poi"
INDEX = OUT / "index.json"
TILE = 0.5
# shortcut: Bretagne et ses marges en dur (Brest → Laval, Nantes → Avranches), à élargir si les sorties vont plus loin
BBOX = (46.5, -5.5, 49.5, 0.5)  # sud, ouest, nord, est
PER_RUN, BUDGET_S, MAX_AGE = 6, 120, 14  # un carreau prend 30 à 50 s (mesuré le 18/10/2026) : 3 ou 4 par passage
URL = "https://overpass-api.de/api/interpreter"
UA = "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)"  # overpass-api.de refuse les agents anonymes (406 / 429)
# mêmes filtres que query() dans arrets.js (vérifié par tests/test_garmin.py), « À voir » compris
FILTERS = [
    '["amenity"~"^(drinking_water|water_point|toilets|cafe|bar|pub|fuel|bicycle_repair_station|grave_yard)$"]',
    '["shop"~"^(bakery|pastry|convenience|supermarket|general|greengrocer|farm|bicycle)$"]',
    '["landuse"="cemetery"]',
    '["historic"~"^(castle|manor|chateau|church|chapel|archaeological_site|megalith|menhir|dolmen|tumulus|mill|windmill|watermill|wayside_cross|wayside_shrine|calvary|monument|ruins)$"]["wikidata"]',
    '["amenity"="place_of_worship"]["wikidata"]',
    '["tourism"="viewpoint"]',
    '["man_made"~"^(windmill|watermill)$"]["wikidata"]',
    '["natural"~"^(peak|waterfall|cave_entrance|rock|stone|cliff|beach|valley|gorge)$"]["wikidata"]',
    '["leisure"="nature_reserve"]["wikidata"]',
]
# mêmes champs que KEEP_T dans arrets.js
KEEP_T = ["name", "brand", "amenity", "shop", "landuse", "opening_hours", "access", "drinking_water", "disused", "seasonal", "fee",
          "wikipedia", "wikidata", "historic", "tourism", "natural", "man_made", "leisure", "building", "site_type",
          "archaeological_site", "megalith_type", "addr:city", "addr:street", "addr:housenumber", "website", "contact:website",
          "phone", "contact:phone", "check_date:opening_hours", "check_date"]
# Version du format des carreaux, à incrémenter quand FILTERS ou KEEP_T changent : les carreaux d'un format plus ancien
# repassent en tête de file, au rythme normal (3 ou 4 par passage), sans tout retélécharger d'un coup.
# index.json : {"<carreau>": "AAAA-MM-JJ", …, "_v": {"<carreau>": version}} (sans entrée dans "_v" : version 1).
FORMAT_V = 2


def tiles():
    s, w, n, e = BBOX
    return [f"{s + i * TILE:.1f}_{w + j * TILE:.1f}" for i in range(round((n - s) / TILE)) for j in range(round((e - w) / TILE))]


def query(name):
    la, lo = map(float, name.split("_"))
    bb = f"{la:.1f},{lo:.1f},{la + TILE:.1f},{lo + TILE:.1f}"
    return f"[out:json][timeout:120][maxsize:134217728];({''.join(f'nwr{f}({bb});' for f in FILTERS)});out tags center qt;"


def compact(e):
    lat, lon = e.get("lat", (e.get("center") or {}).get("lat")), e.get("lon", (e.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    tags = e.get("tags") or {}
    if tags.get("tourism") == "viewpoint" and not (tags.get("wikidata") or tags.get("wikipedia")):
        return None  # le site ne garde que les points de vue qui ont une fiche
    return {"id": e["type"][0] + str(e["id"]), "lat": round(lat, 5), "lon": round(lon, 5),
            "t": {k: tags[k] for k in KEEP_T if k in tags}}


def fetch(name, tries=2):
    body = urllib.parse.urlencode({"data": query(name)}).encode()
    for n in range(tries):
        try:
            req = urllib.request.Request(URL, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.load(r)
            if "runtime error" in (j.get("remark") or ""):
                raise RuntimeError(j["remark"])  # délai dépassé : réponse incomplète, on ne la garde pas
            return [c for c in map(compact, j.get("elements", [])) if c]
        except Exception as ex:  # 429 / 504 fréquents : pause puis nouvel essai
            print(f"POI {name} : {ex}")
            if n < tries - 1:
                time.sleep(15)
    return None


def todo(idx, ver, today):
    """Carreaux à (re)télécharger : jamais faits, puis d'un ancien format, puis plus vieux que MAX_AGE (les plus anciens d'abord)."""
    old = (today - timedelta(days=MAX_AGE)).isoformat()
    stale = [t for t in tiles() if idx.get(t, "") < old or ver.get(t, 1) < FORMAT_V]
    return sorted(stale, key=lambda t: (t in idx, ver.get(t, 1) >= FORMAT_V, idx.get(t, "")))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        idx = json.loads(INDEX.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        idx = {}
    ver = idx.pop("_v", None)
    ver = ver if isinstance(ver, dict) else {}
    t0, done = time.time(), 0
    for t in todo(idx, ver, date.today())[:PER_RUN]:
        if time.time() - t0 > BUDGET_S:
            break
        els = fetch(t)
        if els is None:
            continue
        (OUT / f"{t}.json").write_text(json.dumps(els, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        idx[t] = date.today().isoformat()
        ver[t] = FORMAT_V
        done += 1
        time.sleep(2)
    out = dict(sorted(idx.items()))
    out["_v"] = {t: v for t, v in sorted(ver.items()) if t in idx}
    INDEX.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Points d'arrêt : {done} carreaux mis à jour, {len(idx)}/{len(tiles())} disponibles.")


if __name__ == "__main__":
    main()
