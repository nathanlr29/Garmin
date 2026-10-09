// Test de charge.js : node tests/charge.mjs      (régénérer l'instantané : node tests/charge.mjs --regen)
//
// 1) charge.ref0.json = référence de l'étape 0, générée avec l'ANCIEN code de recup.js / plan.js (date figée 2026-10-09 12:00,
//    Europe/Paris, trois jeux de seuils). Sans profil de course, Charge doit la retrouver au bit près, course comprise.
//    Avec un profil de course, tout ce qui n'est pas de la course et tous les jours sans course doivent rester identiques.
// 2) charge.ref.json = instantané de l'étape 2 (course à l'allure seuil), régénéré avec --regen EN CONNAISSANCE DE CAUSE.
// 3) cas factices pour la formule course : allure seuil, D+, tapis, m = 0, seuil absent, FC seule, runThrPace.
process.env.TZ = "Europe/Paris";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url);
const ref0 = JSON.parse(readFileSync(here("charge.ref0.json"), "utf8"));
const parseLocal = s => { const [d, t = "00:00:00"] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi, se] = t.split(":").map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0, se || 0); };
// l'historique grossit à chaque passage du workflow : on ne garde que les activités connues de la référence
const known = new Set(Object.keys(Object.values(ref0.configs)[0].tssPlan));
const acts = JSON.parse(readFileSync(here("../data/activities.json"), "utf8")).filter(a => known.has(String(a.id))).map(a => ({ ...a, dt: parseLocal(a.d), km: a.m / 1000 }));
assert.equal(acts.length, known.size, "toutes les activités de la référence sont dans data/activities.json");
const NOW = new Date(2026, 9, 9, 12, 0, 0);
class FD extends Date { constructor(...a) { a.length ? super(...a) : super(NOW.getTime()); } static now() { return NOW.getTime(); } }
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const src = readFileSync(here("../charge.js"), "utf8");
const isRun = a => ["running", "trail_running", "treadmill_running", "track_running", "virtual_run"].includes(a.t);

function load(cfg, list = acts) {
  const win = { Recup: { data: { profile: cfg.profile } } };
  const ls = { planFtp: cfg.planFtp, runThrPace: cfg.runThrPace };
  const ctx = { window: win, S: { all: list }, RIDE_TYPES: RIDE, Date: FD, localStorage: { getItem: k => ls[k] != null ? String(ls[k]) : null } };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return win.Charge;
}
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);  // objets issus du vm : comparaison JSON (exacte pour les doubles)
const RUN_LT = { pace: 232, hr: 175, d: "2026-10-05" };   // seuil de course Garmin au 09/10/2026
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ------------------------------------------------------------------ 1) Référence de l'étape 0
for (const [name, r] of Object.entries(ref0.configs)) {
  const cfg = { planFtp: r.planFtp, profile: r.profile };
  // a) sans profil de course : identique à l'ancien code, course comprise
  const C = load(cfg), p = C.params();
  assert.equal(p.ftp, r.planFtp || r.profile.ftp || 250, `${name} : FTP`);
  assert.equal(p.lthr, (r.profile.hrZones && r.profile.hrZones.lthr) || 165, `${name} : LTHR`);
  assert.equal(p.runPace, null); assert.equal(p.runHr, null);
  for (const a of acts) assert.equal(C.tssOf(a), r.tssPlan[a.id], `${name} : TSS ${a.id}`);
  same(C.dayLoads(), r.dayLoads, `${name} : charge par jour`);
  const f = C.fitness();
  assert.equal(f.ctl, r.fitness.ctl); assert.equal(f.atl, r.fitness.atl); assert.equal(f.tsb, r.fitness.tsb);
  const s = C.series(C.dayLoads(), NOW); assert.equal(s.days.length, 120); assert.equal(s.days.at(-1).d, "2026-10-08", "aujourd'hui exclu");
  let n = 0;
  for (const [k, lp] of Object.entries(r.loadPart)) {
    const [y, m, d] = k.split("-").map(Number), dt = new Date(y, m - 1, d);
    assert.equal(C.dayLoad(dt), r.dayLoadRecup[k], `${name} : dayLoad ${k}`);
    same(C.loadPart(dt), lp, `${name} : loadPart ${k}`); n++;
  }
  // b) avec le profil de course : seule la course change
  const W = load({ ...cfg, profile: { ...r.profile, run: { lt: RUN_LT } } });
  let nonRun = 0, runs = 0, changed = 0;
  for (const a of acts) {
    if (isRun(a)) { runs++; if (W.tssOf(a) !== r.tssPlan[a.id]) changed++; } else { nonRun++; assert.equal(W.tssOf(a), r.tssPlan[a.id], `${name} : TSS non course ${a.id}`); }
  }
  const runDays = new Set(acts.filter(isRun).map(a => a.d.slice(0, 10))), dl = W.dayLoads();
  let calm = 0;
  for (const [k, v] of Object.entries(r.dayLoads)) if (!runDays.has(k)) { assert.equal(dl[k], v, `${name} : jour sans course ${k}`); calm++; }
  assert.ok(changed > runs * .9, "la charge de presque toutes les courses change");
  console.log(`ok ${name} : ancien code retrouvé (${acts.length} activités, ${n} jours) ; avec profil course : ${nonRun} non-course et ${calm} jours sans course identiques, ${changed}/${runs} courses recalculées`);
}

// ------------------------------------------------------------------ 3) Formule course sur cas factices
{
  const base = { profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: RUN_LT } } };
  const run = (o = {}) => ({ t: "running", d: "2026-10-01T10:00:00", m: 15517.24, mt: 3600, el: 0, hr: 150, w: 0, np: 0, ...o });
  const C = load(base, []), near = (x, y, msg, e = .02) => assert.ok(Math.abs(x - y) < e, `${msg} : ${x} ≠ ${y}`);
  const vThr = 1000 / 232;
  // allure seuil (3:52/km) = IF 1 : 1 h donne 100
  near(C.tssOf(run({ m: vThr * 3600 })), 100, "allure seuil pendant 1 h");
  near(C.tssOf(run({ m: vThr * 1800, mt: 1800 })), 50, "allure seuil pendant 30 min");
  near(C.tssOf(run({ m: vThr * 3600 * .75 })), 56.25, "IF 0,75");
  // D+ : 8 m de plat par mètre de montée
  near(C.tssOf(run({ m: 10000, el: 500 })), ((10000 + 8 * 500) / 3600 / vThr) ** 2 * 100, "D+ élevé");
  near(C.tssOf(run({ m: 10000, el: 500 })), C.tssOf(run({ m: 14000, el: 0 })), "500 m de D+ = 4 km de plat");
  assert.ok(C.tssOf(run({ m: 10000, el: 500 })) > C.tssOf(run({ m: 10000, el: 0 })));
  near(C.tssOf(run({ m: 10000, el: 5000 })), 1.2 ** 2 * 100, "IF plafonné à 1,2");
  near(C.tssOf(run({ m: 500, mt: 3600 })), .4 ** 2 * 100, "IF plancher à 0,4");
  // tapis : D+ nul, même formule
  near(C.tssOf(run({ t: "treadmill_running", m: 12000, el: 0 })), (12000 / 3600 / vThr) ** 2 * 100, "tapis");
  // la puissance de course et la FC ne comptent pas quand l'allure est connue
  near(C.tssOf(run({ w: 400, np: 420, hr: 190 })), C.tssOf(run({ w: 0, np: 0, hr: 0 })), "puissance et FC ignorées");
  // m = 0 : repli sur la FC de course ; sans FC de course : ancienne formule (FC / LTHR vélo)
  near(C.tssOf(run({ m: 0, hr: 175 })), 100, "m = 0, FC au seuil de course");
  near(C.tssOf(run({ m: 0, hr: 140 })), (140 / 175) ** 2 * 100, "m = 0, FC sous le seuil");
  const noHr = load({ profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: { pace: 232 } } } }, []);
  near(noHr.tssOf(run({ m: 0, hr: 168 })), 100, "m = 0 sans FC de course : FC / LTHR vélo");
  assert.equal(C.tssOf(run({ mt: 0 })), 0, "durée nulle");
  // seuil de course absent : ancienne formule, même avec d'autres champs vides
  for (const profile of [{ ftp: 260, hrZones: { lthr: 168 } }, { ftp: 260, hrZones: { lthr: 168 }, run: {} }, { ftp: 260, hrZones: { lthr: 168 }, run: { lt: {} } }, { ftp: 260, hrZones: { lthr: 168 }, run: { lt: { pace: "232", hr: null } } }, {}]) {
    const D = load({ profile }, []), l = (profile.hrZones && profile.hrZones.lthr) || 165;
    near(D.tssOf(run({ hr: 150 })), (150 / l) ** 2 * 100, "seuil absent : ancienne formule " + JSON.stringify(profile.run));
    near(D.tssOf(run({ hr: 0 })), .65 ** 2 * 100, "seuil absent, sans FC : .65");
  }
  // lt.hr seul (pas d'allure) : FC rapportée à la FC de course
  const hrOnly = load({ profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: { hr: 175 } } } }, []);
  near(hrOnly.tssOf(run({ hr: 175 })), 100, "lt.hr seul");
  near(hrOnly.tssOf(run({ hr: 150 })), (150 / 175) ** 2 * 100, "lt.hr seul, FC 150");
  // réglage de secours runThrPace : valide, il remplace l'allure Garmin ; invalide, il est ignoré
  near(load({ ...base, runThrPace: 250 }, []).tssOf(run({ m: 1000 / 250 * 3600 })), 100, "runThrPace 250");
  near(load({ ...base, runThrPace: 180 }, []).tssOf(run({ m: 1000 / 180 * 3600 })), 100, "runThrPace 180 (limite basse)");
  near(load({ ...base, runThrPace: 480 }, []).tssOf(run({ m: 1000 / 480 * 3600 })), 100, "runThrPace 480 (limite haute)");
  near(load({ profile: { ftp: 260 }, runThrPace: 250 }, []).tssOf(run({ m: 1000 / 250 * 3600 })), 100, "runThrPace sans seuil Garmin");
  for (const bad of [179, 481, 0, -250, "abc", "", "NaN"]) {
    const D = load({ ...base, runThrPace: bad }, []);
    assert.equal(D.params().runPace, 232, `runThrPace ${JSON.stringify(bad)} ignoré`);
  }
  assert.equal(load({ ...base, runThrPace: 250 }, []).params().runPace, 250);
  // le profil de course ne touche ni le vélo, ni la muscu, ni les autres sports
  const ride = { t: "Ride", d: "2026-10-01T10:00:00", m: 40000, mt: 5400, el: 300, hr: 140, w: 200, np: 215 }, ride0 = { ...ride, w: 0, np: 0 };
  const gym = { t: "strength_training", d: "2026-10-01T10:00:00", m: 0, mt: 2700, el: 0, hr: 100, w: 0, np: 0 }, walk = { t: "walking", d: "2026-10-01T10:00:00", m: 5000, mt: 3600, el: 50, hr: 110, w: 0, np: 0 };
  const P = load({ profile: { ftp: 260, hrZones: { lthr: 168 } } }, []);
  for (const a of [ride, ride0, gym, walk, { ...gym, hr: 0 }]) assert.equal(C.tssOf(a), P.tssOf(a), "non-course inchangé : " + a.t);
  near(C.tssOf(ride), 1.5 * (215 / 260) ** 2 * 100, "vélo : puissance / FTP");
  console.log("ok formule course : allure seuil, D+, tapis, m = 0, seuil absent, FC seule, runThrPace valide et invalide");
}

// ------------------------------------------------------------------ Classement des sports
{
  const C = load({ profile: {} }, []), t = x => C.sportOf({ t: x });
  for (const x of RIDE) assert.equal(t(x), "bike");
  for (const x of ["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]) assert.equal(t(x), "run");
  assert.equal(t("strength_training"), "strength");
  for (const x of ["walking", "lap_swimming", "breathwork", "indoor_cardio"]) assert.equal(t(x), "other");
  const sp = load(Object.values(ref0.configs)[0]).dayLoadsBySport(), tot = load(Object.values(ref0.configs)[0]).dayLoads();
  same(Object.keys(sp), Object.keys(tot));
  for (const k of Object.keys(tot)) assert.ok(Math.abs(Object.values(sp[k]).reduce((x, y) => x + y, 0) - tot[k]) < 1e-9, `total par sport ${k}`);
  console.log("ok sports");
}

// ------------------------------------------------------------------ 2) Instantané de l'étape 2 (course à l'allure seuil)
const SNAP = {
  garmin: { profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: RUN_LT } } },
  fcseule: { profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: { hr: 175 } } } },
  secours: { runThrPace: 250, profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: RUN_LT } } },
  sans: { profile: {} },
};
function snapshot() {
  const out = { source: "charge.js de l'étape 2 (course à l'allure seuil), date figée 2026-10-09 12:00 Europe/Paris", configs: {} };
  for (const [name, cfg] of Object.entries(SNAP)) {
    const C = load(cfg), f = C.fitness(), lp = {};
    for (let i = 0; i < 120; i++) { const d = new Date(2026, 9, 9 - i); lp[keyOf(d)] = C.loadPart(d); }
    out.configs[name] = { ...cfg, runTss: Object.fromEntries(acts.filter(isRun).map(a => [a.id, C.tssOf(a)])), dayLoads: C.dayLoads(), fitness: { ctl: f.ctl, atl: f.atl, tsb: f.tsb }, loadPart: lp };
  }
  return out;
}
if (process.argv.includes("--regen")) { writeFileSync(here("charge.ref.json"), JSON.stringify(snapshot())); console.log("charge.ref.json régénéré"); }
else {
  const ref = JSON.parse(readFileSync(here("charge.ref.json"), "utf8")), cur = snapshot();
  for (const name of Object.keys(SNAP)) {
    const a = cur.configs[name], b = ref.configs[name];
    same(a.runTss, b.runTss, `${name} : TSS des courses`); same(a.dayLoads, b.dayLoads, `${name} : charge par jour`);
    same(a.fitness, b.fitness, `${name} : CTL/ATL/TSB`); same(a.loadPart, b.loadPart, `${name} : loadPart`);
    console.log(`ok instantané ${name} : CTL ${a.fitness.ctl.toFixed(1)} ATL ${a.fitness.atl.toFixed(1)} TSB ${a.fitness.tsb.toFixed(1)}`);
  }
}
