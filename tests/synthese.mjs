// Test des fonctions pures de l'onglet Synthèse (synthese.js) : node tests/synthese.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url), read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const profile = JSON.parse(read("../data/recovery.json")).profile;
const win = { Recup: { data: { profile } } };
const NOW = new Date(2026, 9, 9, 12, 0, 0);
const parseLocal = s => { const [d, t = "00:00:00"] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi, se] = t.split(":").map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0, se || 0); };
const acts = JSON.parse(read("../data/activities.json")).filter(a => parseLocal(a.d) <= NOW).map(a => ({ ...a, km: a.m / 1000, dt: parseLocal(a.d) }));
class FD extends Date { constructor(...a) { a.length ? super(...a) : super(NOW.getTime()); } static now() { return NOW.getTime(); } }
const ctx = { window: win, S: { all: acts }, RIDE_TYPES: RIDE, Date: FD, localStorage: { getItem: () => null }, document: { addEventListener() {}, getElementById: () => null }, addEventListener() {}, innerWidth: 1280, MONTHS: [], nf: n => String(n) };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); vm.runInContext(read("../synthese.js"), ctx);
const Y = win.Synthese._, Ch = win.Charge, near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

// ---- fond / fatigue / forme : EXACTEMENT ceux de la carte Forme du Plan (Charge.fitness, 120 jours)
const loads = Ch.dayLoads(acts), f0 = Ch.fitness(NOW);
const fa = Y.fitAt(loads, NOW); assert.equal(fa.ctl, f0.ctl); assert.equal(fa.atl, f0.atl); assert.equal(fa.tsb, f0.tsb);
const ser = Y.fitSeries(loads, NOW, 365); assert.equal(ser.length, 365);
const last = ser[ser.length - 1]; assert.equal(last.ctl, f0.ctl, "dernier point = fond du Plan"); assert.equal(last.tsb, f0.tsb); assert.equal(last.atl, f0.atl);
assert.ok(ser.every((p, i) => !i || p.t > ser[i - 1].t), "dates croissantes, un point par jour"); assert.equal(new Date(last.t).getDate(), 9);
for (const k of [1, 30, 200]) { const d = new Date(NOW); d.setDate(d.getDate() - k); const f = Ch.fitness(d); assert.equal(ser[364 - k].ctl, f.ctl, `point à J-${k} = ce que le Plan aurait affiché ce jour-là`); }
// le Plan calcule sur 120 jours : une série de 365 jours donnerait un autre fond (documenté dans synthese.js)
assert.ok(Math.abs(Ch.series(loads, NOW, 365).ctl - f0.ctl) > 1, "série 365 j ≠ série 120 j");
assert.equal(Y.FIT_DAYS, 120);
// libellé : identique à celui de la carte Forme du Plan (extrait du code de plan.js)
const planLabel = new Function("form", read("../plan.js").match(/const tsbTxt = (form\.tsb[^;]+);/)[0].replace(/^const tsbTxt = /, "return ") );
for (const tsb of [-60, -25.01, -25, -24.9, -10.01, -10, -9.9, 0, 5, 5.01, 14.4, 40]) assert.equal(Y.formLabel(tsb), planLabel({ tsb }), `libellé à ${tsb}`);
// variations
const V = [{ ctl: 50 }, { ctl: 52 }, { ctl: 55 }, { ctl: 60 }];
let v = Y.variation(V, 1, "ctl"); assert.equal(v.delta, 5); near(v.pct, 5 / 55 * 100, 1e-9, "pct sur la valeur de départ"); v = Y.variation(V, 3, "ctl"); assert.equal(v.delta, 10); near(v.pct, 20, 1e-9, "+20 %");
assert.equal(Y.variation(V, 4, "ctl"), null, "pas assez de recul"); assert.equal(Y.variation([], 7, "ctl"), null); assert.equal(Y.variation([{ ctl: 0 }, { ctl: 5 }], 1, "ctl").pct, null, "départ nul : pas de %");
const v7 = Y.variation(ser, 7, "ctl"), v30 = Y.variation(ser, 30, "ctl"); near(v7.delta, f0.ctl - ser[364 - 7].ctl, 1e-12, "7 j"); near(v30.cur, f0.ctl, 1e-12, "30 j");

// ---- répartition par sport
const daily = Ch.dayLoadsBySport(acts), sh = Y.sportShare(daily, NOW, 30);
near(Object.values(sh.pct).reduce((a, b) => a + b, 0), 100, 1e-9, "les % font 100"); near(sh.bike + sh.run + sh.strength + sh.other, sh.total, 1e-9, "le total est la somme");
let tot30 = 0; for (let i = 0; i < 30; i++) { const d = new Date(NOW); d.setDate(d.getDate() - i); const e = daily[Ch.ymd(d)]; if (e) tot30 += e.bike + e.run + e.strength + e.other; } near(sh.total, tot30, 1e-9, "30 jours, aujourd'hui compris");
const d1 = { "2026-10-09": { bike: 60, run: 40, strength: 0, other: 0 }, "2026-09-10": { bike: 100, run: 0, strength: 0, other: 0 }, "2026-09-09": { bike: 999, run: 0, strength: 0, other: 0 } };
const s1 = Y.sportShare(d1, NOW, 30); assert.equal(s1.total, 200, "J-29 inclus, J-30 exclu"); assert.equal(s1.pct.bike, 80); assert.equal(s1.pct.run, 20);
const s0 = Y.sportShare({}, NOW, 30); assert.equal(s0.total, 0); assert.equal(s0.pct.bike, 0, "aucune séance : pas de division par zéro");
// semaines (lundi-dimanche), la dernière = semaine en cours ; le futur est ignoré
const W = Y.weeklyBySport({ "2026-10-05": { bike: 10, run: 0, strength: 0, other: 0 }, "2026-10-09": { bike: 0, run: 5, strength: 0, other: 0 }, "2026-10-10": { bike: 0, run: 77, strength: 0, other: 0 }, "2026-10-04": { bike: 0, run: 0, strength: 20, other: 0 }, "2025-01-01": { bike: 50, run: 0, strength: 0, other: 0 } }, NOW, 12);
assert.equal(W.length, 12); assert.equal(W[11].total, 15, "semaine en cours : lundi 5 + vendredi 9, pas le samedi à venir"); assert.equal(W[10].strength, 20, "dimanche 4 : semaine d'avant"); assert.equal(W.reduce((s, w) => s + w.total, 0), 35, "au-delà de 12 semaines : ignoré");
assert.ok(W.every(w => new Date(w.t).getDay() === 1 && new Date(w.t).getHours() === 0), "chaque semaine commence un lundi à minuit");
const Wr = Y.weeklyBySport(daily, NOW, 12); near(Wr.reduce((s, w) => s + w.total, 0), Object.entries(daily).filter(([k]) => new Date(k + "T12:00") >= new Date(Wr[0].t) && new Date(k + "T12:00") <= NOW).reduce((s, [, e]) => s + e.bike + e.run + e.strength + e.other, 0), 1e-6, "somme des semaines = somme des jours");

// ---- Ta semaine : semaine en cours contre la moyenne des 4 semaines complètes d'avant
const mk = (daysAgo, o = {}) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); return { t: "Ride", mt: 3600, dt: d, d: "", ...o }; };   // aujourd'hui = vendredi 9 oct.
const tss = a => a.mt / 36;   // 100 TSS par heure
const acts2 = [mk(0), mk(1, { t: "running", mt: 1800 }), mk(4, { mt: 599 }),                      // cette semaine (lun 5 → ven 9) : 2 séances ; la 3e (4 j = lundi) fait moins de 10 min
  mk(7), mk(8, { t: "strength_training", mt: 1200 }), mk(14), mk(15), mk(21), mk(28, { mt: 7200 }), mk(35), mk(50), mk(-1)];   // 7 j = vendredi d'avant ; mk(35) = 5 semaines : hors moyenne ; mk(-1) = demain : futur
const ws = Y.weekStats(acts2, NOW, tss);
assert.equal(ws.cur.n, 2); near(ws.cur.hours, 1.5, 1e-9, "1 h + 0,5 h"); near(ws.cur.tss, 150, 1e-9); assert.equal(ws.cur.bike, 1); assert.equal(ws.cur.run, 1);
near(ws.avg.n, (2 + 2 + 1 + 1) / 4, 1e-9, "séances moyennes sur 4 semaines complètes (mk(35) et mk(50) : hors fenêtre)"); near(ws.avg.hours, (1 + 1 / 3 + 2 + 1 + 2) / 4, 1e-9, "heures moyennes"); near(ws.avg.tss, (100 + 100 / 3 + 200 + 100 + 200) / 4, 1e-9, "charge moyenne");
assert.equal(ws.prev.length, 4); near(ws.avg.strength, .25, 1e-9); assert.equal(ws.avg.run, 0);
near(Y.vsAvg(6, 4), 50, 1e-9, "+50 %"); assert.equal(Y.vsAvg(3, 0), null, "moyenne nulle : pas de %"); near(Y.vsAvg(1, 4), -75, 1e-9);
const wz = Y.weekStats([], NOW, tss); assert.equal(wz.cur.n, 0); assert.equal(wz.avg.n, 0);

// ---- Indicateurs
const L = [["2026-01-01", 280], ["2026-08-01", 292], [null, 5], ["2026-09-15", null], ["2026-10-03", 260]], ls = Y.listSeries(L);
assert.equal(ls.length, 3, "valeurs nulles et dates absentes écartées"); v = Y.listVariation(ls, NOW.getTime(), 30, 260); assert.equal(v.ref, 292, "valeur du 1er août reportée"); assert.equal(v.delta, -32);
v = Y.listVariation(ls, NOW.getTime(), 30); assert.equal(v.cur, 260); assert.equal(Y.listVariation(ls, NOW.getTime(), 400), null, "pas assez de recul"); assert.equal(Y.listVariation([], NOW.getTime(), 30), null);
// couleur du score de récup : mêmes seuils (75 / 50 / 25) que Recup.scoreColor
assert.match(read("../recup.js"), /function scoreColor\(s\) \{ return s >= 75 \? "var\(--teal\)" : s >= 50 \? "var\(--accent-2\)" : s >= 25 \? "var\(--amber\)" : "var\(--rose\)"; \}/);
assert.deepEqual([100, 75, 74, 50, 49, 25, 24, 0].map(Y.recupColor), ["#3cc9b4", "#3cc9b4", "#5aa9f2", "#5aa9f2", "#f2a93b", "#f2a93b", "#f2708a", "#f2708a"]);
const night = read("../recup.css"); for (const c of ["--teal:#3cc9b4", "--accent-2:#5aa9f2", "--amber:#f2a93b", "--rose:#f2708a"]) assert.ok(night.includes(c), "couleur du thème nuit : " + c);

console.log(`ok synthese : fond ${f0.ctl.toFixed(2)} · fatigue ${f0.atl.toFixed(2)} · forme ${f0.tsb.toFixed(2)} identiques au Plan ; variations, répartition, semaines, indicateurs`);
