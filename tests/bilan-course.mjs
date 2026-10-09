// Test des fonctions pures du bilan de course (bilan.js) : node tests/bilan-course.mjs
// Flux réels : tests/fixtures/run-stream-*.json = copies de data/streams/<id>.json (s: "run", sans le GPS).
// data/streams est purgé au bout de 120 jours : les fixtures gardent le test stable.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url);
const read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const acts = JSON.parse(read("../data/activities.json")).map(a => ({ ...a, km: a.m / 1000, dt: new Date(a.d) }));
const win = { Recup: { data: { profile: { ftp: 260, hrZones: { lthr: 168 }, run: { lt: { pace: 232, hr: 175 } } } } } };
const ctx = { window: win, S: { all: acts }, RIDE_TYPES: RIDE, localStorage: { getItem: () => null }, document: { addEventListener() {}, getElementById: () => null },
  nf: (n, d = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n), esc: s => String(s), isIndoor: a => a.t === "VirtualRide" || a.tr === 1 };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); ctx.Charge = win.Charge;   // dans le navigateur window est le global : Charge est accessible tel quel
vm.runInContext(read("../bilan.js"), ctx);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);   // objets issus du vm : comparaison JSON
const R = win.Bilan._run, near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);

// ---- allure
assert.equal(R.paceTxt(232), "3:52"); assert.equal(R.paceTxt(253), "4:13"); assert.equal(R.paceTxt(59.6), "1:00"); assert.equal(R.paceTxt(3600 / 12), "5:00");
for (const bad of [0, -3, NaN, Infinity, null, undefined]) assert.equal(R.paceTxt(bad), "–", `allure ${bad}`);
assert.equal(R.pace({ km: 10, mt: 2400 }), 240); assert.equal(R.pace({ km: 0, mt: 2400 }), null); assert.equal(R.pace({ km: 5, mt: 0 }), null);

// ---- zones d'allure : 5 zones autour de la vitesse seuil (232 s/km = 15,517 km/h), bornes 78 / 88 / 95 / 102 %
const vThr = 3600 / 232, z = f => R.zoneOf(f * vThr, 232);
assert.equal(R.zones.length, 5); same(R.zones.map(x => x[0]).slice(0, 4), [.78, .88, .95, 1.02]);
same([.5, .779, .78, .879, .88, .949, .95, 1.019, 1.02, 1.3].map(z), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
assert.equal(R.zoneOf(12, 232), 0); assert.equal(R.zoneOf(14, 232), 2); assert.equal(R.zoneOf(16.5, 232), 4);

// ---- flux réels
for (const id of ["24617053367", "24664940965"]) {
  const st = JSON.parse(read(`fixtures/run-stream-${id}.json`)), an = R.analyze(st, 232), a = acts.find(x => String(x.id) === id);
  assert.ok(a && ["running", "trail_running"].includes(a.t), "activité course trouvée dans activities.json");
  assert.equal(st.dt, 5); assert.ok(st.v && st.h && st.c && st.sl && st.gct && st.vo, "champs course présents");
  // durée en mouvement ≤ durée totale, zones d'allure = temps en mouvement
  assert.ok(an.moving > 0 && an.moving <= st.n * st.dt);
  near(an.rz.reduce((s, x) => s + x, 0), an.moving, 1e-9, id + " : zones d'allure = temps en mouvement");
  // cadence en pas/min (× 2), pas de 100-130 cm, contact 200-350 ms, oscillation 5-15 cm
  assert.ok(an.cad > 140 && an.cad < 190, "cadence " + an.cad); assert.ok(an.sl > 90 && an.sl < 140, "longueur de pas " + an.sl);
  assert.ok(an.gct > 200 && an.gct < 350, "contact " + an.gct); assert.ok(an.vo > 5 && an.vo < 15, "oscillation " + an.vo);
  // cohérence physique : longueur de pas ≈ vitesse ÷ cadence
  near(an.sl, an.avgKmh / 3.6 / (an.cad / 60) * 100, 4, id + " : longueur de pas = vitesse / cadence");
  // la FC max du flux est celle du mouvement ; l'allure moyenne du flux est proche de celle de Garmin (hors arrêts)
  assert.ok(an.maxH >= an.avgH); near(3600 / an.avgKmh, R.pace(a), 25, id + " : allure du flux ≈ allure Garmin");
  assert.ok(an.ef > .5 && an.ef < 2.5, "efficacité m/battement " + an.ef);
  // tuiles et verdict : rien de propre au vélo
  const tiles = R.tiles(a, an), verdict = R.verdict(a, an);
  for (const w of ["Durée", "Distance", "Allure moyenne", "Dénivelé", "Charge", "Cardio", "Cadence", "Longueur de pas", "Contact au sol", "Oscillation verticale", "Puissance Garmin"]) assert.ok(tiles.includes(w), `tuile ${w}`);
  assert.ok(tiles.includes("rTSS") && tiles.includes("seuil 3:52 /km"));
  for (const w of ["FTP", "vent", "Coggan", "km/h", "TSS prévu"]) assert.ok(!tiles.includes(w) && !verdict.includes(w), `rien de vélo : ${w}`);
  const n = (verdict.match(/<p>/g) || []).length; assert.ok(n >= 2 && n <= 4, "verdict de 2 à 4 phrases : " + n);
  assert.ok(verdict.includes("/km") && verdict.includes("rTSS"));
}
// le grand flux a un découplage ; le petit (28 min) est trop court pour en avoir
const big = R.analyze(JSON.parse(read("fixtures/run-stream-24664940965.json")), 232), small = R.analyze(JSON.parse(read("fixtures/run-stream-24617053367.json")), 232);
assert.ok(Number.isFinite(big.dec) && big.dec > -5 && big.dec < 15, "découplage " + big.dec); near(big.dec, 6.5, .3, "découplage du 09/10");
assert.equal(small.dec, undefined, "28 min : pas de découplage");
// sans allure seuil : pas de zones d'allure
assert.equal(R.analyze(JSON.parse(read("fixtures/run-stream-24664940965.json")), null).rz, undefined);

// ---- flux synthétique : découplage connu
const mk = (n, f = {}) => ({ dt: 5, n, v: Array(n).fill(120), h: Array.from({ length: n }, (_, i) => i < 240 ? 140 : 147), c: Array(n).fill(170), ...f });
const syn = R.analyze(mk(360), 232);
near(syn.dec, (1 - 140 / 147) * 100, 1e-9, "découplage synthétique"); assert.equal(syn.steady, true);
near(syn.avgKmh, 12, 1e-9, "vitesse moyenne"); assert.equal(syn.moving, 1800); assert.equal(syn.cad, 170); assert.equal(syn.sl, null);
near(syn.ef, 12 / 3.6 * 60 / syn.avgH, 1e-9, "efficacité");
assert.equal(R.analyze(mk(200), 232).dec, undefined, "séance trop courte : pas de découplage");
// arrêts : sous 3 km/h on ne compte pas
const stops = R.analyze(mk(360, { v: Array.from({ length: 360 }, (_, i) => i % 4 === 0 ? 10 : 120) }), 232);
assert.equal(stops.moving, 270 * 5); near(stops.avgKmh, 12, 1e-9, "arrêts exclus");
// allure irrégulière : découplage donné mais pas « steady »
const irr = R.analyze(mk(360, { v: Array.from({ length: 360 }, (_, i) => i % 2 ? 80 : 200) }), 232); assert.equal(irr.steady, false);
// verdict : cadence signalée seulement sous 160 pas/min, rien sans flux
const a0 = acts.find(x => String(x.id) === "24664940965");
assert.ok(!R.verdict(a0, R.analyze(mk(360), 232)).includes("sous les 160"), "170 pas/min : pas de remarque");
assert.ok(R.verdict(a0, R.analyze(mk(360, { c: Array(360).fill(150) }), 232)).includes("sous les 160"), "150 pas/min : remarque");
const noStream = R.verdict(a0, null); assert.equal((noStream.match(/<p>/g) || []).length, 2); assert.ok(!R.tiles(a0, null).includes("Cadence"));
// pas d'allure seuil connue : charge estimée à la FC
win.Recup.data.profile.run = {}; assert.ok(R.verdict(a0, null).includes("estimée à la fréquence cardiaque")); assert.ok(R.tiles(a0, null).includes("estimée à la FC"));

console.log("ok bilan course : allure, zones d'allure, découplage, tuiles et verdict (2 flux réels + cas synthétiques)");
