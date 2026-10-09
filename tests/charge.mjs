// Test de charge.js : même résultat que l'ancien code de recup.js / plan.js, au bit près.
// node tests/charge.mjs
// charge.ref.json a été généré avec l'ancien code (tssOf de recup.js et de plan.js, dayLoads et fitness de plan.js,
// dayLoad et loadPart de recup.js) sur data/activities.json, date figée au 2026-10-09 12:00 (Europe/Paris),
// pour trois jeux de seuils : profil Garmin, FTP saisie, valeurs par défaut.
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url);
const ref = JSON.parse(readFileSync(here("charge.ref.json"), "utf8"));
const parseLocal = s => { const [d, t = "00:00:00"] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi, se] = t.split(":").map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0, se || 0); };
const acts = JSON.parse(readFileSync(here("../data/activities.json"), "utf8")).map(a => ({ ...a, dt: parseLocal(a.d), km: a.m / 1000 }));
const NOW = new Date(2026, 9, 9, 12, 0, 0);
class FD extends Date { constructor(...a) { a.length ? super(...a) : super(NOW.getTime()); } static now() { return NOW.getTime(); } }
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const src = readFileSync(here("../charge.js"), "utf8");

function load(cfg) {
  const win = { Recup: { data: { profile: cfg.profile } } };
  const ctx = { window: win, S: { all: acts }, RIDE_TYPES: RIDE, Date: FD, localStorage: { getItem: k => k === "planFtp" && cfg.planFtp != null ? String(cfg.planFtp) : null } };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return win.Charge;
}
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);  // objets issus du vm : on compare en JSON (exact pour les doubles)

for (const [name, r] of Object.entries(ref.configs)) {
  const C = load(r), p = C.params();
  // seuils
  assert.equal(p.ftp, r.planFtp || r.profile.ftp || 250, `${name} : FTP`);
  assert.equal(p.lthr, (r.profile.hrZones && r.profile.hrZones.lthr) || 165, `${name} : LTHR`);
  // TSS de chaque activité (l'ancien code de recup.js et de plan.js donnait déjà la même valeur)
  for (const a of acts) {
    assert.equal(C.tssOf(a), r.tssRecup[a.id], `${name} : TSS ${a.id} (recup.js)`);
    assert.equal(C.tssOf(a), r.tssPlan[a.id], `${name} : TSS ${a.id} (plan.js)`);
  }
  // charge par jour
  same(C.dayLoads(), r.dayLoads, `${name} : charge par jour`);
  // fond / fatigue / forme sur 120 jours
  const f = C.fitness();
  assert.equal(f.ctl, r.fitness.ctl, `${name} : CTL`); assert.equal(f.atl, r.fitness.atl, `${name} : ATL`); assert.equal(f.tsb, r.fitness.tsb, `${name} : TSB`);
  const s = C.series(C.dayLoads(), NOW); assert.equal(s.days.length, 120); assert.equal(s.days.at(-1).d, "2026-10-08", "aujourd'hui exclu");
  // charge du jour et charge récente (loadPart de recup.js) pour chaque jour
  let n = 0;
  for (const [k, lp] of Object.entries(r.loadPart)) {
    const [y, m, d] = k.split("-").map(Number), dt = new Date(y, m - 1, d);
    assert.equal(C.dayLoad(dt), r.dayLoadRecup[k], `${name} : dayLoad ${k}`);
    same(C.loadPart(dt), lp, `${name} : loadPart ${k}`); n++;
  }
  // charge par jour et par sport : le total retombe sur la charge par jour
  const bs = C.dayLoadsBySport(), tot = C.dayLoads();
  same(Object.keys(bs), Object.keys(tot));
  for (const k of Object.keys(tot)) assert.ok(Math.abs(Object.values(bs[k]).reduce((x, y) => x + y, 0) - tot[k]) < 1e-9, `${name} : total par sport ${k}`);
  console.log(`ok ${name} : ${acts.length} activités, ${n} jours, CTL ${f.ctl.toFixed(1)} ATL ${f.atl.toFixed(1)} TSB ${f.tsb.toFixed(1)}`);
}

// classement des sports
const C = load(Object.values(ref.configs)[0]);
const t = x => C.sportOf({ t: x });
for (const x of RIDE) assert.equal(t(x), "bike");
for (const x of ["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]) assert.equal(t(x), "run");
assert.equal(t("strength_training"), "strength");
for (const x of ["walking", "lap_swimming", "breathwork", "indoor_cardio"]) assert.equal(t(x), "other");
const sp = C.dayLoadsBySport(); const sum = { bike: 0, run: 0, strength: 0, other: 0 };
for (const k of Object.keys(sp)) for (const s of Object.keys(sum)) sum[s] += sp[k][s];
assert.ok(sum.bike > 0 && sum.run > 0 && sum.strength > 0, "chaque sport a de la charge");
console.log("ok sports", Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v)])));
