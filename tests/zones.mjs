// Test des fonctions pures de la carte « Zones cardio » (zones.js) : node tests/zones.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url), read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const store = {};
const ctx = { window: {}, RIDE_TYPES: RIDE, localStorage: { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { addEventListener() {} }, nf: (n, d = 0) => (+n).toFixed(d).replace(".", ","), esc: s => String(s) };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); vm.runInContext(read("../zones.js"), ctx);
const Z = ctx.window.Zones._, same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime(), DAY = 864e5, ago = d => new Date(NOW - d * DAY);
const act = (t, days, hz) => ({ t, dt: ago(days), mt: hz.reduce((s, v) => s + v, 0), hz });

// ------------------------------------------------------------------ Zones depuis le profil (méthode Garmin)
const G = Z.zonesFrom({ hrZones: { floors: [98, 117, 137, 156, 176], max: 195, rest: 43, method: "HR_MAX" } });
assert.equal(G.method, "garmin");
same(G.z, [{ lo: 98, hi: 116 }, { lo: 117, hi: 136 }, { lo: 137, hi: 155 }, { lo: 156, hi: 175 }, { lo: 176, hi: 195 }], "planchers Garmin, haut = plancher suivant − 1, Z5 jusqu'à la FC max");
assert.equal(Z.zonesFrom({ hrZones: { floors: [98, 117, 137, 156, 176] } }).max, 191, "sans FC max : dernier plancher + 15");
assert.match(Z.methodNote(G), /montre Garmin \(FC max 195 bpm\)/);
// planchers invalides → repli
assert.equal(Z.zonesFrom({ hrZones: { floors: [98, null, 137, 156, 176], max: 195, rest: 43 } }).method, "karvonen", "plancher manquant");
assert.equal(Z.zonesFrom({ hrZones: { floors: [98, 140, 137, 156, 176], max: 195, rest: 43 } }).method, "karvonen", "planchers pas croissants");

// ------------------------------------------------------------------ Repli Karvonen, puis % de la FC max, puis 220 − âge
const K = Z.zonesFrom({ hrZones: { max: 195, rest: 45 } });
assert.equal(K.method, "karvonen");
same(K.z.map(r => r.lo), [120, 135, 150, 165, 180], "réserve 150 bpm : 45 + 50/60/70/80/90 %");
same(K.z.map(r => r.hi), [134, 149, 164, 179, 195]);
assert.match(Z.methodNote(K), /Karvonen/); assert.match(Z.methodNote(K), /repos 45/);
assert.equal(Z.zonesFrom({ hrZones: { max: 190 } }, { rest: 50 }).z[0].lo, 120, "FC de repos passée en option");
const M = Z.zonesFrom({ hrZones: { max: 200 } });
assert.equal(M.method, "max"); same(M.z.map(r => r.lo), [100, 120, 140, 160, 180], "sans repos : 50-90 % de la FC max");
const A = Z.zonesFrom({});
assert.equal(A.max, 195, "sans rien : 220 − 25 ans"); assert.equal(A.method, "max"); assert.match(Z.methodNote(A), /220 − âge \(25 ans\)/);
assert.equal(Z.zonesFrom(null, { age: '"30-39"' }).max, 185, "âge depuis bwAge (JSON)");
assert.equal(Z.zonesFrom(null, { age: "40-49" }).max, 175, "âge depuis bwAge (brut)");
assert.equal(Z.zonesFrom({ hrZones: { rest: 50 } }, { age: "<30" }).method, "karvonen", "repos connu, FC max estimée");
assert.deepEqual([null, "", "?", '"60+"', "33"].map(Z.ageOf), [25, 25, 25, 65, 33]);

// ------------------------------------------------------------------ Agrégation hz par fenêtre et par sport
const acts = [
  act("Ride", 1, [600, 3000, 600, 300, 100]), act("VirtualRide", 10, [1200, 1800, 0, 600, 0]), act("running", 5, [0, 1200, 600, 0, 0]),
  act("strength_training", 2, [900, 0, 0, 0, 0]), act("walking", 3, [1800, 0, 0, 0, 0]),
  act("Ride", 27.9, [0, 3600, 0, 0, 0]), act("Ride", 28.1, [0, 0, 3600, 0, 0]),    // de part et d'autre de la limite de 28 jours
  { t: "Ride", dt: ago(4), mt: 3600, hz: null }, { t: "Ride", dt: ago(4), mt: 3600, hz: [0, 0, 0, 0, 0] }, act("Ride", -1, [0, 0, 0, 0, 3600]),   // sans cardio, futur
];
const from = NOW - 28 * DAY;
const bk = Z.agg(acts, "bike", from, NOW);
same(bk.sec, [1800, 8400, 600, 900, 100], "vélo : 3 sorties dans la fenêtre"); assert.equal(bk.n, 3); assert.equal(bk.total, 11800);
same(Z.agg(acts, "run", from, NOW).sec, [0, 1200, 600, 0, 0], "course seule");
same(Z.agg(acts, "all", from, NOW).sec, [1800, 9600, 1200, 900, 100], "Tout = vélo + course, sans muscu ni marche");
same(Z.agg(acts, "bike", NOW - 56 * DAY, from).sec, [0, 0, 3600, 0, 0], "4 semaines d'avant");
const sh = Z.shares(bk); assert.ok(Math.abs(sh.easy - 10200 / 11800) < 1e-12 && Math.abs(sh.gray - 600 / 11800) < 1e-12 && Math.abs(sh.hard - 1000 / 11800) < 1e-12);
same(Z.shares({ sec: [0, 0, 0, 0, 0], total: 0 }).p, [0, 0, 0, 0, 0], "rien : parts nulles");
// semaines lundi-dimanche (le 16/10/2026 est un vendredi)
const W = Z.weeks(acts, "bike", NOW);
assert.equal(W.length, 8); assert.equal(W[7].cur, true); assert.equal(W[7].mon.getDay(), 1); assert.equal(W[7].mon.getDate(), 12, "semaine en cours : lundi 12 octobre");
assert.equal(W[7].total, 4600, "semaine en cours : la sortie d'hier, pas celle de demain");
assert.equal(W.reduce((s, w) => s + w.total, 0), 11800 + 3600, "toutes les sorties vélo passées sur 8 semaines");
assert.match(Z.tipHtml(W[7]), /Semaine du 12\/10 \(en cours\)/);

// ------------------------------------------------------------------ Phrase-verdict par cas
const g = (sec, n = 5) => ({ sec, n, total: sec.reduce((s, v) => s + v, 0) });
const H = 3600;
assert.equal(Z.verdict(g([2 * H, 6 * H, .8 * H, .8 * H, .4 * H])).k, "polar", "80 % facile, 8 % de Z3, 12 % dur");
assert.equal(Z.answer(g([2 * H, 6 * H, .8 * H, .8 * H, .4 * H]), "bike"), "Ces 4 semaines, 80 % de ton temps vélo est en zones 1-2 et 8 % en zone 3 : bonne répartition polarisée.");
assert.equal(Z.verdict(g([4 * H, 5.5 * H, .3 * H, .2 * H, 0])).k, "easy", "tout en facile");
assert.equal(Z.verdict(g([2 * H, 3 * H, 3 * H, 1 * H, 1 * H])).k, "gray", "30 % en zone 3 : zone grise");
assert.equal(Z.verdict(g([2 * H, 5 * H, 2 * H, 1 * H, 0])).k, "ok", "20 % pile en zone 3 : pas zone grise (seuil strict, comme la Synthèse)");
assert.equal(Z.verdict(g([1 * H, 4 * H, 1.5 * H, 2.5 * H, 1 * H])).k, "hard", "50 % facile, 15 % de Z3");
assert.equal(Z.verdict(g([2 * H, 5 * H, 1.5 * H, 1.5 * H, 0])).k, "ok", "70 % facile, 15 % de Z3");
assert.equal(Z.verdict(g([2 * H, 6 * H, 0, 0, 0], 2)).k, "nodata", "moins de 3 séances");
assert.equal(Z.verdict(g([1000, 5000, 0, 0, 0], 4)).k, "nodata", "moins de 2 h");
assert.match(Z.answer(g([1000, 2000, 0, 0, 0], 2), "run"), /trop peu de temps course avec cardio \(50 min, 2 séances\)/);
assert.match(Z.answer(g([0, 0, 0, 0, 0], 0), "all"), /aucune séance vélo et course avec cardio/);
assert.match(Z.compare(g([2 * H, 6 * H, .8 * H, .8 * H, .4 * H]), g([2 * H, 4 * H, 2 * H, 1 * H, 1 * H])), /^Les 4 semaines d'avant : 60 % en zones 1-2, 20 % en zone 3, 10 h \(↑ 20 pts de facile\)\. Repère : environ 80 %/);
assert.match(Z.compare(g([2 * H, 6 * H, 1 * H, 1 * H, 0]), g([0, 0, 0, 0, 0], 0)), /trop peu de données pour comparer/);
// titres du graphe
const wk = sec => ({ sec, n: 1, total: sec.reduce((s, v) => s + v, 0) });
assert.equal(Z.weeksTitle(Array(8).fill(wk([0, 0, 0, 0, 0]))), "Pas encore de temps en zones ces 8 semaines.");
assert.match(Z.weeksTitle([...Array(4).fill(wk([H, 3 * H, .5 * H, .5 * H, 0])), ...Array(4).fill(wk([H, 2 * H, 1.5 * H, .5 * H, 0]))]), /zone 3 monte \(10 % → 30 %/);
assert.match(Z.weeksTitle([...Array(4).fill(wk([H, 2 * H, 1.5 * H, .5 * H, 0])), ...Array(4).fill(wk([H, 3 * H, .5 * H, .5 * H, 0]))]), /zone 3 baisse \(30 % → 10 %\) : tes séances faciles/);
assert.match(Z.weeksTitle([...Array(4).fill(wk([0, 2 * H, 2 * H, 0, 0])), ...Array(4).fill(wk([0, 2.5 * H, 1.5 * H, 0, 0]))]), /baisse \(50 % → 38 % .*mais reste au-dessus de 20 %/);
assert.match(Z.weeksTitle([...Array(4).fill(wk([H, 3 * H, .5 * H, .5 * H, 0])), ...Array(4).fill(wk([2 * H, 6 * H, H, H, 0]))]), /volume avec cardio monte : 5,0 h → 10,0 h/);
assert.match(Z.weeksTitle(Array(8).fill(wk([H, 3 * H, .5 * H, .5 * H, 0]))), /^Répartition stable sur 8 semaines : environ 80 % en zones 1-2 et 10 % en zone 3\.$/);
assert.match(Z.weeksTitle(Array(8).fill(wk([0, 2 * H, 2 * H, 0, 0]))), /50 % en zone 3, c.est beaucoup de zone grise\.$/);
// repères pratiques
assert.match(Z.practical(G), /endurance \(zone 2, les 67 % de FTP du Plan\) = 117-136 bpm, seuil \(zone 4\) = 156-175 bpm/);
assert.equal(Z.hm(59 * 60), "59 min"); assert.equal(Z.hm(3600), "1 h"); assert.equal(Z.hm(3600 + 5 * 60), "1 h 05");

// ------------------------------------------------------------------ Rendu (sans DOM) : section, puces, choix gardé
const H0 = ctx.window.Zones.html({ profile: { hrZones: G.z && { floors: [98, 117, 137, 156, 176], max: 195 } }, acts, now: NOW });
assert.match(H0, /^<section class="card span12 hrz"><h2>Zones cardio <small>/); assert.match(H0, /data-hrz="bike" aria-pressed="true"/);
assert.ok(!/#[0-9a-f]{3,6}\b/i.test(H0), "aucune couleur en dur"); assert.ok(!/\b(CTL|ATL|TSB|TSS)\b/.test(H0), "aucun sigle");
store.hrzSport = "run"; assert.match(ctx.window.Zones.html({ profile: {}, acts, now: NOW }), /data-hrz="run" aria-pressed="true"/, "choix hrzSport relu");
store.hrzSport = "nimporte"; assert.match(ctx.window.Zones.html({ profile: {}, acts, now: NOW }), /data-hrz="bike" aria-pressed="true"/, "valeur inconnue : vélo");
delete store.hrzSport;

// ------------------------------------------------------------------ Contrôle sur les vraies données
const prof = JSON.parse(read("../data/recovery.json")).profile;
const real = JSON.parse(read("../data/activities.json")).map(a => ({ ...a, dt: new Date(a.d) }));
const last = Math.max(...real.map(a => +a.dt)), RN = last + 3600e3;
const ZR = Z.zonesFrom(prof);
if (prof.hrZones && prof.hrZones.floors) {
  assert.equal(ZR.method, "garmin"); assert.equal(ZR.z[0].lo, prof.hrZones.floors[0]); assert.equal(ZR.z[4].hi, prof.hrZones.max);
  ZR.z.forEach((r, i) => { assert.ok(r.lo <= r.hi, `zone ${i + 1} : bornes dans l'ordre`); if (i) assert.equal(r.lo, ZR.z[i - 1].hi + 1, "zones contiguës"); });
}
for (const sp of ["bike", "run", "all"]) {
  const c = Z.agg(real, sp, RN - 28 * DAY, RN), wks = Z.weeks(real, sp, RN);
  assert.ok(c.sec.every(v => v >= 0) && Math.abs(Z.shares(c).p.reduce((s, v) => s + v, 0) - (c.total ? 1 : 0)) < 1e-9, `${sp} : parts cohérentes`);
  const exp = real.filter(a => +a.dt > RN - 28 * DAY && +a.dt <= RN && Z.sportOk(a, sp) && a.hz && a.hz.some(v => v > 0)).reduce((s, a) => s + a.hz.reduce((x, y) => x + y, 0), 0);
  assert.equal(c.total, exp, `${sp} : total identique à un calcul direct`);
  assert.equal(wks.length, 8);
  console.log(`  ${sp} : ${c.n} séances, ${Z.hm(c.total)} — ${Z.answer(c, sp)}\n    ${Z.weeksTitle(wks)}`);
}
const bAll = Z.agg(real, "bike", RN - 28 * DAY, RN), rAll = Z.agg(real, "run", RN - 28 * DAY, RN), aAll = Z.agg(real, "all", RN - 28 * DAY, RN);
same(aAll.sec, bAll.sec.map((v, i) => v + rAll.sec[i]), "Tout = vélo + course sur les vraies données");
console.log(`  ${Z.practical(ZR)}`);
console.log("zones : tous les tests passent");
