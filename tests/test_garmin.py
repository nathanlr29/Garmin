"""Tests des scripts Garmin (course à pied) : python3 tests/test_garmin.py
Réponses factices (vides, None, champs manquants, échelles de vitesse), flux de course (build_stream)
et lecture d'un vrai FIT de course construit à la main (fitdecode requis, sinon ce test est sauté).
Le dossier tests/ n'est pas déployé."""
import io
import struct
import sys
import types
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
try:
    import garminconnect  # noqa: F401
except ImportError:  # les tests de lecture n'ont pas besoin de la vraie bibliothèque
    m = types.ModuleType("garminconnect")
    for n in ("Garmin", "GarminConnectAuthenticationError", "GarminConnectConnectionError", "GarminConnectTooManyRequestsError"):
        setattr(m, n, type(n, (Exception,), {}))
    sys.modules["garminconnect"] = m
import fetch_garmin as fg  # noqa: E402
import recovery as rc  # noqa: E402

rc.time.sleep = lambda s: None   # pas d'attente entre deux appels factices

try:
    import fitdecode  # noqa: F401
except ImportError:
    fitdecode = None


# ---------------------------------------------------------------- Seuil lactique
class LactateThreshold(unittest.TestCase):
    def test_echelles_de_vitesse(self):
        # 4:13/km = 3,953 m/s ; Garmin la rend parfois ÷ 10, ou en km/h
        for raw in (3.953, 0.3953, 14.23):
            self.assertAlmostEqual(rc.pace_from_speed(raw), 253, delta=2, msg=raw)
        self.assertIsNone(rc.pace_from_speed(0.05))   # 3 h/km : n'importe quoi
        self.assertIsNone(rc.pace_from_speed(30))     # 33 s/km
        for bad in (None, 0, -1, "3.9", True):
            self.assertIsNone(rc.pace_from_speed(bad))

    def test_reponse_de_la_bibliotheque(self):
        r = {"speed_and_heart_rate": {"speed": 0.39, "heartRate": 172, "calendarDate": "2026-02-18T08:00:00.0"}, "power": {"functionalThresholdPower": 320}}
        self.assertEqual(rc.read_lt(r), {"pace": 256, "hr": 172, "d": "2026-02-18"})
        self.assertEqual(rc.read_lt({"speed_and_heart_rate": {"speed": 3.9}}), {"pace": 256})  # FC et date absentes
        self.assertEqual(rc.read_lt({"x": {"speed": 3.9, "hearRate": 170}}).get("hr"), 170)     # coquille de Garmin
        self.assertIsNone(rc.read_lt({"speed_and_heart_rate": {"speed": 0.002}}))
        for empty in (None, {}, [], {"speed_and_heart_rate": {"speed": None, "heartRate": None}}, "x"):
            self.assertIsNone(rc.read_lt(empty))


# ---------------------------------------------------------------- Prédictions
class Races(unittest.TestCase):
    def test_latest_et_historique(self):
        latest = {"calendarDate": "2026-10-09", "time5K": 1200.0, "time10K": 2500, "timeHalfMarathon": 5500, "timeMarathon": 11700}
        h1 = [{"calendarDate": "2026-10-07", "time5K": 1210, "time10K": 2520, "timeHalfMarathon": 5520, "timeMarathon": 11800},
              {"calendarDate": "2026-10-08", "time5K": 1210, "time10K": 2520, "timeHalfMarathon": 5520, "timeMarathon": 11800},  # identique : sauté
              {"calendarDate": "2026-10-09", "time5K": 1200, "time10K": 2500, "timeHalfMarathon": 5500, "timeMarathon": 11700}]
        r = rc.read_races(latest, [h1, None, {}])
        self.assertEqual({k: r[k] for k in ("5k", "10k", "hm", "m", "d")}, {"5k": 1200, "10k": 2500, "hm": 5500, "m": 11700, "d": "2026-10-09"})
        self.assertEqual(r["hist"], [["2026-10-07", 1210, 2520, 5520, 11800], ["2026-10-09", 1200, 2500, 5500, 11700]])

    def test_champs_manquants_ou_aberrants(self):
        r = rc.read_races({"time5K": 1200, "time10K": 5}, [])      # 10 km en 5 s : écarté
        self.assertEqual(r, {"5k": 1200})
        self.assertIsNone(rc.read_races(None, []))
        self.assertIsNone(rc.read_races({}, [[], {}, None]))
        self.assertIsNone(rc.read_races({"time5K": None}, [[{"calendarDate": "2026-01-01"}]]))


# ---------------------------------------------------------------- Séries hebdo, tolérance, records, VO2max
class Series(unittest.TestCase):
    def test_une_valeur_par_semaine(self):
        r = {"groupMap": {"2026-10-05": {"groupAverage": 7000}, "2026-10-12": {"groupAverage": 7100}}}
        self.assertEqual(rc.read_series(r, ("overallScore", "groupAverage"), 0, 30000), [["2026-10-05", 7000], ["2026-10-12", 7100]])
        daily = [{"calendarDate": f"2026-10-0{d}", "overallScore": 40 + d} for d in range(5, 10)]   # lun 5 -> ven 9 : même semaine
        self.assertEqual(rc.read_series({"hillScoreDTOList": daily}, ("overallScore",), 0, 200), [["2026-10-09", 49]])
        for empty in (None, {}, [], [{"calendarDate": "2026-10-05"}], {"x": [{"calendarDate": "2026-10-05", "overallScore": "n/a"}]}):
            self.assertEqual(rc.read_series(empty, ("overallScore",), 0, 200), [])

    def test_tolerance(self):
        r = [{"startDate": "2026-10-05", "acuteLoad": 420.123, "chronicLoad": 380, "name": "x"}, {"startDate": "2026-10-12"}]
        self.assertEqual(rc.read_tol(r), [["2026-10-05", {"acuteLoad": 420.12, "chronicLoad": 380}]])
        for empty in (None, [], {}, [{}]):
            self.assertEqual(rc.read_tol(empty), [])

    def test_records_course_seulement(self):
        items = [
            {"typeId": 3, "activityType": "running", "value": 1185.4, "activityId": 11, "prStartTimeLocal": "2026-02-14T09:00:00.0"},
            {"typeId": 3, "activityType": "running", "value": 1300.0, "activityId": 10, "prStartTimeLocal": "2025-06-01T09:00:00.0"},  # ancien record
            {"typeId": 5, "activityType": "running", "value": 5460, "activityId": 12, "prStartTimeLocal": "2026-02-28T09:00:00.0"},
            {"typeId": 7, "activityType": "running", "value": 32100.5, "activityId": 13, "prStartTimeLocal": "2026-03-01T09:00:00.0"},
            {"typeId": 3, "activityType": "cycling", "value": 900, "activityId": 14},      # pas de la course
            {"typeId": 3, "activityType": "running", "value": 12, "activityId": 15},        # 5 km en 12 s
            {"typeId": 99, "activityType": "running", "value": 1000}, "x", None,
        ]
        r = rc.read_pr(items)
        self.assertEqual(r["5k"], [1185, "2026-02-14", 11])
        self.assertEqual(r["hm"][0], 5460)
        self.assertEqual(r["long"][0], 32100.5)
        self.assertEqual(sorted(r), ["5k", "hm", "long"])
        for empty in (None, [], {}, [{}], {"personalRecords": []}):
            self.assertIsNone(rc.read_pr(empty))
        self.assertEqual(rc.read_pr({"records": [items[0]]})["5k"][0], 1185)

    def test_vo2_course_seulement_generic(self):
        mm = [{"calendarDate": "2026-10-05", "generic": {"calendarDate": "2026-10-05", "vo2MaxPreciseValue": 63.7}, "cycling": {"calendarDate": "2026-10-05", "vo2MaxPreciseValue": 55.0}},
              {"generic": {"vo2MaxValue": 63}, "calendarDate": "2026-10-09"}, {"generic": None, "calendarDate": "2026-10-10"}]
        self.assertEqual(rc.read_vo2_run(mm), [("2026-10-05", 63.7), ("2026-10-09", 63.0)])
        for empty in (None, [], {}, [{"cycling": {"vo2MaxPreciseValue": 55}}]):
            self.assertEqual(rc.read_vo2_run(empty), [])


# ---------------------------------------------------------------- fetch_run_profile : appels indépendants
class FakeApi:
    def __init__(self, **resp):
        self.resp, self.calls = resp, []

    def _get(self, name, *a, **kw):
        self.calls.append(name)
        v = self.resp.get(name)
        if isinstance(v, Exception):
            raise v
        return v

    def __getattr__(self, name):
        if name.startswith("get_"):
            return lambda *a, **kw: self._get(name, *a, **kw)
        raise AttributeError(name)


TODAY = date(2026, 10, 9)


class RunProfile(unittest.TestCase):
    def test_tout_vide_ou_en_erreur(self):
        for api in (FakeApi(), FakeApi(get_lactate_threshold=RuntimeError("404"), get_personal_record=ValueError("x"),
                                        get_hill_score={}, get_endurance_score=[], get_running_tolerance=None)):
            run, raw = rc.fetch_run_profile(api, date(2026, 1, 1), TODAY)
            self.assertEqual(run, {"d": "2026-10-09"})
            self.assertTrue(set(raw) <= set(rc.RUN_RAW))

    def test_un_appel_en_erreur_ne_bloque_pas_les_autres(self):
        api = FakeApi(get_lactate_threshold=RuntimeError("boom"), get_race_predictions={"time5K": 1200},
                      get_personal_record=[{"typeId": 3, "activityType": "running", "value": 1190, "activityId": 1}])
        run, _ = rc.fetch_run_profile(api, date(2026, 1, 1), TODAY, mm=[{"generic": {"vo2MaxPreciseValue": 63.7}, "calendarDate": "2026-10-09"}])
        self.assertNotIn("lt", run)
        self.assertEqual(run["races"]["5k"], 1200)
        self.assertEqual(run["pr"]["5k"][0], 1190)
        self.assertEqual(run["vo2"], [("2026-10-09", 63.7)])

    def test_historique_decoupe_en_demandes_d_un_an(self):
        api = FakeApi()
        rc.fetch_run_profile(api, date(2026, 1, 1), TODAY)
        self.assertEqual(api.calls.count("get_race_predictions"), 1 + 2)   # du jour + 1er mars 2025 -> aujourd'hui en 2 fois

    def test_limite_429_interrompt_et_garde_l_ancien_bloc(self):
        api = FakeApi(get_race_predictions=type("GarminConnectTooManyRequestsError", (Exception,), {})("429"))
        self.assertIsNone(rc.fetch_run_profile(api, date(2026, 1, 1), TODAY))
        old = {"run": {"d": "2026-10-08", "lt": {"pace": 250}}, "raw": {"runLt": "x", "ftp": "y"}}
        prof = rc.fetch_profile(_ProfileApi(api), date(2026, 1, 1), TODAY, old)
        self.assertEqual(prof["run"], old["run"])
        self.assertEqual(prof["raw"]["runLt"], "x")

    def test_une_fois_par_jour(self):
        api = _ProfileApi(FakeApi())
        old = {"run": {"d": "2026-10-09", "lt": {"pace": 250}}, "raw": {"runLt": "x"}}
        prof = rc.fetch_profile(api, date(2026, 1, 1), TODAY, old)
        self.assertEqual(prof["run"], old["run"])                       # repris tel quel
        self.assertFalse([c for c in api.inner.calls if c in ("get_lactate_threshold", "get_race_predictions", "get_personal_record",
                                                              "get_running_tolerance", "get_endurance_score", "get_hill_score")])
        prof = rc.fetch_profile(_ProfileApi(FakeApi()), date(2026, 1, 1), TODAY, {"run": {"d": "2026-10-08"}})
        self.assertEqual(prof["run"]["d"], "2026-10-09")                # la veille : on rafraîchit


class _ProfileApi:
    """Les appels vélo de fetch_profile répondent vide ; les appels course sont ceux de l'API factice."""
    def __init__(self, inner):
        self.inner = inner

    def __getattr__(self, name):
        if name in ("get_cycling_ftp", "get_functional_threshold_power_range", "get_max_metrics_range", "get_heart_rate_zones"):
            return lambda *a, **kw: None
        return getattr(self.inner, name)


# ---------------------------------------------------------------- Flux de course
T0 = datetime(2026, 10, 9, 18, 0, 0, tzinfo=timezone.utc)


def run_recs(n=400, **extra):
    out = []
    for i in range(n):
        r = {"timestamp": T0 + timedelta(seconds=i), "heart_rate": 150 + i // 40, "cadence": 86, "fractional_cadence": 0.5,
             "enhanced_speed": 3.9, "power": 280, "step_length": 1125.0, "stance_time": 240.0, "vertical_oscillation": 85.0,
             "position_lat": int(48.1 / (180 / 2 ** 31)), "position_long": int(-1.7 / (180 / 2 ** 31))}
        r.update(extra)
        out.append(r)
    return out


class Streams(unittest.TestCase):
    def test_course(self):
        st = fg.build_stream(1, run_recs(), 400, run=True)
        self.assertEqual(st["c"][0], 173)             # (86 + 0,5) × 2 pas/min
        self.assertIn(st["sl"][0], (112, 113))     # 1 125 mm -> 112,5 cm
        self.assertEqual(st["gct"][0], 240)
        self.assertEqual(st["vo"][0], 8.5)            # 85 mm -> 8,5 cm
        self.assertEqual(st["p"][0], 280)
        self.assertEqual(st["v"][0], 140)             # 3,9 m/s = 14,04 km/h (× 10)

    def test_champs_optionnels_absents(self):
        recs = [{k: v for k, v in r.items() if k not in ("step_length", "stance_time", "vertical_oscillation", "fractional_cadence", "power")} for r in run_recs()]
        st = fg.build_stream(1, recs, 400, run=True)
        self.assertEqual(st["c"][0], 172)
        for k in ("sl", "gct", "vo", "p"):
            self.assertNotIn(k, st)

    def test_valeurs_aberrantes_ecartees(self):
        st = fg.build_stream(1, run_recs(step_length=65535.0, stance_time=0.0, vertical_oscillation=9000.0), 400, run=True)
        for k in ("sl", "gct", "vo"):
            self.assertNotIn(k, st)

    def test_velo_inchange(self):
        st = fg.build_stream(2, run_recs(), 400)       # run=False : cadence brute, pas de champs course
        self.assertEqual(st["c"][0], 86)
        for k in ("sl", "gct", "vo"):
            self.assertNotIn(k, st)

    def test_tapis_sans_gps(self):
        self.assertIn("g", fg.build_stream(3, run_recs(), 400, run=True))   # le retrait du GPS se fait dans update_streams
        self.assertTrue({"VirtualRide", "treadmill_running", "virtual_run"} <= fg.NO_GPS_TYPES)

    def test_sport(self):
        self.assertEqual([fg.sport_of({"t": t}) for t in ("Ride", "VirtualRide", "running", "trail_running", "treadmill_running", "track_running", "virtual_run", "walking", "strength_training")],
                         ["bike", "bike", "run", "run", "run", "run", "run", None, None])


# ---------------------------------------------------------------- Vrai FIT de course
def _crc(data, crc=0):
    tbl = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]
    for b in data:
        for nib in (b & 0xF, (b >> 4) & 0xF):
            crc = (((crc >> 4) & 0x0FFF) ^ tbl[crc & 0xF] ^ tbl[nib])
    return crc


def make_fit(n=400):
    """FIT minimal : un message record (timestamp, FC, cadence, vitesse, puissance, cadence fractionnaire, dynamique de course)."""
    fields = [(253, 4, 0x86), (3, 1, 0x02), (4, 1, 0x02), (6, 2, 0x84), (7, 2, 0x84), (53, 1, 0x02), (39, 2, 0x84), (41, 2, 0x84), (85, 2, 0x84)]
    body = bytes([0x40, 0, 0]) + struct.pack("<HB", 20, len(fields)) + b"".join(struct.pack("BBB", *f) for f in fields)
    ts0 = int((T0 - datetime(1989, 12, 31, tzinfo=timezone.utc)).total_seconds())
    for i in range(n):
        # vitesse 1 000 / m·s⁻¹ ; fractional_cadence ×128 ; oscillation et longueur de pas ×10 ; temps de contact ×10
        body += bytes([0x00]) + struct.pack("<IBBHHBHHH", ts0 + i, 155, 86, 3900, 280, 64, 850, 2405, 11250)
    head = struct.pack("<BBHI4s", 14, 0x20, 2132, len(body), b".FIT") + b"\x00\x00"
    blob = head + body
    return blob + struct.pack("<H", _crc(blob))


@unittest.skipUnless(fitdecode, "fitdecode non installé")
class RealFit(unittest.TestCase):
    def test_fit_records_puis_flux(self):
        recs = fg.fit_records(make_fit())
        self.assertEqual(len(recs), 400)
        st = fg.build_stream(9, recs, 400, run=True)
        self.assertEqual(st["c"][0], 173)
        self.assertEqual(st["p"][0], 280)
        self.assertIn(st["sl"][0], (112, 113))
        self.assertEqual(st["vo"][0], 8.5)
        self.assertEqual(st["gct"][0], 240)    # 240,5 ms
        self.assertAlmostEqual(st["v"][0], 140, delta=1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
