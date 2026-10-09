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

// ======================================================================= 4b : projection, détecteurs, relevé
const NOWT = NOW.getTime(), DAYMS = 864e5, daysAgo = n => NOWT - n * DAYMS;
// ---- Theil-Sen
let ts = Y.theilSen([0, 1, 2, 3, 4].map(x => ({ x, y: 10 + 2 * x }))); near(ts.slope, 2, 1e-12, "droite exacte"); near(ts.intercept, 10, 1e-12);
assert.equal(Y.theilSen([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null, "moins de 3 points"); assert.equal(Y.theilSen([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]), null, "mêmes dates : pas de pente");
// un point aberrant ne la fait pas basculer (la moindre-carrés, si)
const clean = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(x => ({ x, y: 100 + x })), dirty = clean.concat([{ x: 10, y: 20 }]);
near(Y.theilSen(dirty).slope, 1, .1, "Theil-Sen : un test raté (100 → 20) ne change presque pas la pente");
const ols = p => { const n = p.length, mx = p.reduce((s, q) => s + q.x, 0) / n, my = p.reduce((s, q) => s + q.y, 0) / n; return p.reduce((s, q) => s + (q.x - mx) * (q.y - my), 0) / p.reduce((s, q) => s + (q.x - mx) ** 2, 0); };
assert.ok(ols(dirty) < -2, "(moindres carrés : la même série bascule à " + ols(dirty).toFixed(1) + ")");
// ---- projection : verdicts (objectif 300 W au 31/12, 82,5 jours = 11,8 semaines, FTP actuelle 260 W : 3,4 W/semaine nécessaires)
const lineSer = (perWeek, n = 15, v0 = 260) => Array.from({ length: n }, (_, i) => ({ t: daysAgo((n - 1 - i) * 7), v: v0 - perWeek * (n - 1 - i) }));
const proj = (ser, cur = 260, goal = 300, dec = 0) => Y.projection(ser, goal, "2026-12-31", NOWT, cur, dec);
let pr = proj(lineSer(4)); assert.equal(pr.verdict, "dans les temps"); near(pr.rate, 4, 1e-9, "pente en W/semaine"); near(pr.need, 40 / (82.5 / 7), .02, "rythme nécessaire (le changement d'heure du 25/10 ajoute 1 h)"); near(pr.projected, 260 + 4 * 82.5 / 7, .1, "valeur projetée au 31/12"); assert.equal(pr.text.projected, 307);
pr = proj(lineSer(2.5)); assert.equal(pr.verdict, "un peu juste", "74 % du rythme nécessaire"); pr = proj(lineSer(1)); assert.equal(pr.verdict, "hors de portée au rythme actuel"); pr = proj(lineSer(-2)); assert.equal(pr.verdict, "hors de portée au rythme actuel"); assert.ok(pr.projected < 260);
assert.equal(proj(lineSer(2.05)).verdict, "un peu juste", "au-dessus de 60 % du rythme nécessaire (2,04 W/semaine)"); assert.equal(proj(lineSer(2.02)).verdict, "hors de portée au rythme actuel", "juste en dessous de 60 %");
assert.equal(proj(lineSer(0), 300).verdict, "atteint"); assert.equal(proj(lineSer(0), 305).verdict, "atteint");
assert.equal(Y.projection(lineSer(4), 300, "2026-10-01", NOWT, 260, 0).verdict, "hors de portée au rythme actuel", "date dépassée"); assert.equal(Y.projection(lineSer(4, 2), 300, "2026-12-31", NOWT, 260, 0), null, "moins de 3 mesures");
assert.equal(Y.projection([], 300, "2026-12-31", NOWT, 260, 0), null); assert.ok(Y.projection(lineSer(4), 300, "2026-12-31", NOWT, null, 0).cur > 250, "sans valeur actuelle : dernière mesure");
// seules les 120 derniers jours comptent
const old = Array.from({ length: 10 }, (_, i) => ({ t: daysAgo(300 - i * 7), v: 100 + i * 20 })); assert.equal(proj(old.concat(lineSer(0, 4))).n, 4, "mesures plus anciennes que 120 j écartées"); near(proj(old.concat(lineSer(0, 5))).rate, 0, 1e-9);
// le cas réel : 292 → 260 début octobre ne fait pas basculer la tendance
const ftpHist = [["2026-06-20", 282], ["2026-07-11", 264], ["2026-08-22", 264], ["2026-08-29", 264], ["2026-09-05", 264], ["2026-09-12", 292], ["2026-09-19", 292], ["2026-09-26", 292], ["2026-10-03", 260]];
const real = proj(Y.listSeries(ftpHist)); const without = proj(Y.listSeries(ftpHist.slice(0, -1)));
assert.ok(Math.abs(real.rate - without.rate) < 1, `un test isolé (292 → 260) ne bouge pas la tendance : ${real.rate.toFixed(2)} contre ${without.rate.toFixed(2)} W/semaine`); assert.ok(real.rate > -1.5, "pas de bascule vers une pente fortement négative");
// arrondis : FTP au watt, VO2max au dixième
pr = Y.projection([0, 1, 2, 3, 4].map(i => ({ t: daysAgo(30 - i * 7), v: 63 + .037 * i })), 65, "2026-12-31", NOWT, 63.2, 1); assert.equal(pr.text.cur, 63.2); assert.equal(pr.text.projected, Math.round(pr.projected * 10) / 10); assert.equal(Math.round(proj(lineSer(4)).text.projected), proj(lineSer(4)).text.projected, "FTP entière");
// tests de rampe : 75 % de la meilleure minute
const ramps = Y.rampPoints([{ n: "MyWhoosh Ramp Test", pc: { "60": 400 }, dt: new Date(daysAgo(10)) }, { n: "Ramp", pc: { "60": 400 }, dt: new Date(daysAgo(10)) }, { n: "Ramp Test", pc: {}, dt: new Date(daysAgo(10)) }, { n: "ramp test", pc: { "60": 360 }, dt: new Date(daysAgo(-5)) }], NOWT);
same(ramps.map(r => r.v), [300], "FTP de test = 75 % de la meilleure minute ; seulement les séances « Ramp Test » passées avec puissance");
same(Y.rampPoints([{ n: "Zwift - FTP Ramp Test [Lite]", pc: { "60": 192 }, dt: new Date(daysAgo(20)) }, { n: "Zwift - FTP Ramp Test", pc: { "60": 347 }, dt: new Date(daysAgo(20)) }], NOWT).map(r => r.v), [260], "deux tests le même jour (Lite interrompu) : on garde le meilleur");
assert.deepEqual(Y.GOALS && JSON.parse(JSON.stringify(Y.GOALS)), { ftp: 300, vo2: 65, date: "2026-12-31" });

// ---- détecteurs
const D0 = new Date(2026, 9, 9, 12);
const ride = (daysBack, o = {}) => ({ t: "Ride", mt: 3600, dt: new Date(daysAgo(daysBack)), pz: [600, 600, 1200, 600, 600, 0, 0], ...o });   // 33 % en zone 3
const rn = (daysBack, o = {}) => ({ t: "running", mt: 1800, dt: new Date(daysAgo(daysBack)), hz: [300, 400, 600, 300, 200], m: 5000, el: 0, hr: 150, ...o });  // 33 % en zone 3
const ctxOf = (o = {}) => ({ acts: [], loads: {}, days: [], hardRide: a => !!a.hard, tssOf: a => a.t === "running" ? a.mt / 3600 * .7 ** 2 * 100 : a.mt / 36, ...o });   // course à IF 0,7 ; vélo : 100 TSS par heure
let g = Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(9)] }), D0); assert.equal(g.active, true); assert.equal(g.count, 3);
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5)] }), D0).active, false, "2 séances : pas assez");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(9, { hard: true })] }), D0).active, false, "séance dure : exclue");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(15)] }), D0).active, false, "plus de 14 jours : exclue");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(9, { pz: [600, 600, 720, 1000, 680, 0, 0] })] }), D0).active, false, "exactement 20 % en zone 3 : pas plus de 20 %");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(9, { pz: undefined })] }), D0).active, false, "sans zones de puissance : non évaluable"); assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), ride(9, { mt: 1199 })] }), D0).active, false, "moins de 20 min : exclue");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), rn(3), rn(6)] }), D0).active, true, "course à IF < 0,85 et FC en zone 3 : comptée");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), rn(3), rn(6, { mt: 1800 })], tssOf: a => a.t === "running" ? a.mt / 3600 * .9 ** 2 * 100 : a.mt / 36 }), D0).active, false, "course à IF 0,9 : dure, exclue");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), rn(3), rn(6, { hz: [900, 900, 0, 0, 0] })] }), D0).active, false, "course sans zone 3");
assert.equal(Y.detGray(ctxOf({ acts: [ride(1), ride(5), { ...ride(2), t: "strength_training" }] }), D0).active, false, "muscu ignorée");
// charge qui monte trop vite
const loadsOf = (acute, chronic) => { const L = {}; for (let i = 0; i < 7; i++) L[win.Charge.ymd(new Date(daysAgo(i)))] = acute / 7; for (let i = 7; i < 35; i++) L[win.Charge.ymd(new Date(daysAgo(i)))] = chronic * 4 / 28; return L; };   // chronic = charge hebdo des 28 jours d'avant
let l = Y.detLoad(ctxOf({ loads: loadsOf(450, 300) }), D0); assert.equal(l.status, "ok"); near(l.ratio, 1.5, 1e-9); assert.equal(l.active, false, "exactement 1,5 : pas au-dessus");
l = Y.detLoad(ctxOf({ loads: loadsOf(452, 300) }), D0); assert.equal(l.active, true); assert.equal(l.status, "actif"); near(l.chronic, 300, 1e-9, "moyenne hebdo des 28 jours d'avant");
assert.equal(Y.detLoad(ctxOf({ loads: {} }), D0).status, "nodata", "sans charge d'avant : données manquantes"); assert.equal(Y.detLoad(ctxOf({ loads: loadsOf(100, 0) }), D0).active, false);
// VFC sous la normale 3 jours de suite
const hrvDays = (vals, lo = 80) => vals.map((h, i) => ({ d: win.Charge.ymd(new Date(daysAgo(vals.length - 1 - i))), hrv: h, hrvLo: lo }));
assert.equal(Y.detHrv(ctxOf({ days: hrvDays([90, 70, 75, 60]) }), D0).active, true); assert.equal(Y.detHrv(ctxOf({ days: hrvDays([90, 70, 75, 80]) }), D0).active, false, "80 = normale : pas en dessous");
assert.equal(Y.detHrv(ctxOf({ days: hrvDays([70, 70]) }), D0).status, "nodata", "2 jours seulement"); assert.equal(Y.detHrv(ctxOf({ days: hrvDays([70, 90, 70]) }), D0).active, false, "pas 3 jours de suite");
const gap = hrvDays([70, 70, 70, 70]).filter((_, i) => i !== 2); assert.equal(Y.detHrv(ctxOf({ days: gap }), D0).status, "nodata", "un jour manquant"); assert.equal(Y.detHrv(ctxOf({ days: [] }), D0).status, "nodata");
assert.equal(Y.detHrv(ctxOf({ days: hrvDays([70, 70, 70]).map(d => ({ ...d, hrvLo: undefined })) }), D0).status, "nodata", "sans normale Garmin");
// dette de sommeil
const nights = (base, last, n0 = 60) => Array.from({ length: n0 + last.length }, (_, i) => ({ d: win.Charge.ymd(new Date(daysAgo(n0 + last.length - 1 - i))), sl: i < n0 ? base : last[i - n0] }));
const H = 3600; let sl = Y.detSleep(ctxOf({ days: nights(8 * H, [6, 6, 6, 6, 6, 6, 6].map(h => h * H)) }), D0); assert.equal(sl.active, true); near(sl.debt, 14 * H, 1e-6, "14 h de dette"); assert.equal(sl.med, 8 * H);
sl = Y.detSleep(ctxOf({ days: nights(8 * H, [7, 7, 7, 8, 8, 8, 8].map(h => h * H)) }), D0); near(sl.debt, 3 * H, 1e-6); assert.equal(sl.active, false, "exactement 3 h : pas plus de 3 h");
assert.equal(Y.detSleep(ctxOf({ days: nights(8 * H, [9, 9, 9, 9, 9, 9, 9].map(h => h * H)) }), D0).debt, 0, "nuits plus longues : pas de dette négative");
assert.equal(Y.detSleep(ctxOf({ days: nights(8 * H, [6, 6, 6].map(h => h * H), 0) }), D0).status, "nodata", "moins de 7 nuits enregistrées"); assert.equal(Y.detSleep(ctxOf({ days: nights(8 * H, [6, 6, 6, 6, 6, 6, 6].map(h => h * H), 10) }), D0).status, "nodata", "moins de 20 nuits de référence");
assert.equal(Y.detSleep(ctxOf({ days: [] }), D0).status, "nodata"); assert.equal(Y.detSleep(ctxOf({ days: nights(8 * H, [6, 6, 6, 6, 6, 6, 6].map(h => h * H)) }), new Date(daysAgo(-20))).status, "nodata", "dernières nuits trop anciennes");
// historique sur 90 jours : dernière alerte et nombre de jours
const hrvLow = hrvDays(Array(100).fill(90)).map(d => (d.d >= win.Charge.ymd(new Date(daysAgo(40))) && d.d <= win.Charge.ymd(new Date(daysAgo(30)))) ? { ...d, hrv: 60 } : d);
const ah = Y.alertHistory(Y.detHrv, ctxOf({ days: hrvLow }), D0, 90); assert.equal(ah.n, 90); assert.equal(new Date(ah.last).getDate(), new Date(daysAgo(30)).getDate(), "dernière alerte : le dernier jour bas (J-30)"); assert.equal(ah.count, 9, "J-38 à J-30 en alerte (il faut 3 jours bas de suite, donc pas J-40 ni J-39)");
assert.equal(Y.alertHistory(Y.detHrv, ctxOf({ days: hrvDays(Array(100).fill(90)) }), D0).last, null, "jamais d'alerte");
const all = Y.detectAll(ctxOf({ acts: [ride(1), ride(5), ride(9)] }), D0); assert.deepEqual(Object.keys(all), ["gray", "load", "hrv", "sleep"]); assert.equal(all.gray.active, true); assert.equal(all.hrv.status, "nodata");
assert.equal(Y.DET.loadRatio, 1.5); assert.equal(Y.DET.sleepDebtSec, 10800); assert.equal(Y.DET.grayShare, .2);

// ---- relevé de la semaine (le lundi)
const MON = new Date(2026, 9, 12, 9), TUE = new Date(2026, 9, 13, 9), WED = new Date(2026, 9, 14, 9);
assert.deepEqual([MON, TUE, WED, new Date(2026, 9, 11), new Date(2026, 9, 9)].map(Y.showReleve), [true, true, false, false, false], "lundi et mardi seulement");
const at = (d, h = 18) => new Date(2026, 9, d, h);   // semaine dernière : lun 5 → dim 11 oct.
const wacts = [{ t: "Ride", mt: 3600, km: 30, dt: at(5), hard: true }, { t: "Ride", mt: 7200, km: 60, dt: at(7) }, { t: "running", mt: 1800, km: 5, dt: at(8) }, { t: "strength_training", mt: 1200, km: 0, dt: at(9, 7) }, { t: "Ride", mt: 400, km: 3, dt: at(9) },
  { t: "Ride", mt: 3600, km: 99, dt: at(4) }, { t: "Ride", mt: 3600, km: 99, dt: at(12) }];   // dimanche 4 et lundi 12 : hors semaine
const planned = { "2026-10-05": { t: "vo2" }, "2026-10-07": { t: "end" }, "2026-10-09": { t: "thr" } };
const plan = { plannedFor: k => planned[k] || null, isKey: t => ["vo2", "thr", "ss"].includes(t), hardRide: a => !!a.hard };
const wr = Y.weekReport(ctxOf({ acts: wacts, loads: Ch.dayLoads(acts) }), MON, plan);
assert.equal(wr.n, 4, "séances de 10 min et plus, de la semaine dernière seulement"); near(wr.hours, 1 + 2 + .5 + 1 / 3, 1e-9, "heures"); near(wr.tss, 100 + 200 + 24.5 + 33.33333333, 1e-6, "charge"); assert.equal(wr.per.bike.km, 90); assert.equal(wr.per.bike.n, 2); assert.equal(wr.per.run.km, 5); assert.equal(wr.per.strength.n, 1);
assert.deepEqual({ ...wr.keys }, { planned: 2, done: 1, hasPlan: true }, "séances clés : 2 prévues (vo2, thr), 1 faite"); assert.equal(wr.m0.getDay(), 1); assert.equal(wr.end.getDay(), 0);
const f0r = Y.fitAt(Ch.dayLoads(acts), wr.m0), f1r = Y.fitAt(Ch.dayLoads(acts), new Date(2026, 9, 12)); near(wr.niveau.delta, f1r.ctl - f0r.ctl, 1e-12, "variation du niveau sur la semaine");
assert.equal(Y.weekReport(ctxOf({ acts: wacts, loads: {} }), MON, null).keys.hasPlan, false, "sans plan : pas de séances clés"); assert.equal(Y.weekReport(ctxOf({ acts: wacts, loads: {} }), MON, { ...plan, plannedFor: () => null }).keys.hasPlan, false);
const wal = Y.weekReport(ctxOf({ acts: [], loads: {}, days: hrvDays(Array(30).fill(60)) }), MON, plan); assert.ok(wal.alerts.some(a => a.k === "hrv"), "alertes de la semaine : la VFC basse est signalée"); assert.equal(Y.weekReport(ctxOf({ acts: [] }), MON, plan).alerts.length, 0);
console.log("ok synthese 4b : Theil-Sen, projection et verdicts, détecteurs (actif / inactif / sans données), historique 90 j, relevé du lundi");

// ======================================================================= 4-bis : phrases-réponses, amorce, barres d'objectif
// ---- amorce : un point n'est gardé que si ses 120 jours précédents sont dans l'historique ; aujourd'hui est toujours gardé et = carte Forme du Plan
const firstT = Math.min(...acts.map(a => a.dt.getTime()));
const sw = Y.fitSeries(loads, NOW, 365, firstT), lim = new Date(firstT); lim.setHours(0, 0, 0, 0);
assert.ok(sw.length > 200 && sw.length <= 365, "historique de 18 mois : presque toute la courbe est gardée");
assert.ok(sw.every((p, i) => i === sw.length - 1 || p.t - 120 * 864e5 >= lim.getTime()), "aucun point sans ses 120 jours d'amorce");
assert.equal(sw[sw.length - 1].ctl, f0.ctl, "aujourd'hui = Charge.fitness (carte Forme du Plan)");
const young = acts.filter(a => a.dt >= new Date(2026, 6, 1)), yl = Ch.dayLoads(young), ys = Y.fitSeries(yl, NOW, 365, Math.min(...young.map(a => a.dt.getTime())));
assert.ok(ys.length < 100, "historique court : la courbe est tronquée au lieu de partir de 0"); assert.equal(ys[ys.length - 1].t, dayStart0(NOW), "mais aujourd'hui est gardé");
function dayStart0(d) { const t = new Date(d); t.setHours(0, 0, 0, 0); return t.getTime(); }
assert.equal(Y.fitSeries(loads, NOW, 365).length, 365, "sans date de départ : tous les points");
// la courbe du niveau ne démarre pas de zéro : le premier point affiché est proche de ce que donnerait un calcul sur tout l'historique
const fullS = Ch.series(loads, new Date(NOW.getTime() + 864e5), 700).days, firstPt = sw[0], ref0 = fullS.find(p => p.d === Ch.ymd(new Date(firstPt.t - 864e5)));
assert.ok(Math.abs(firstPt.ctl - ref0.ctl) / ref0.ctl < .08, `premier point (${firstPt.ctl.toFixed(1)}) à moins de 8 % du calcul sur tout l'historique (${ref0.ctl.toFixed(1)})`);

// ---- 1. « Est-ce que je progresse ? » : mot selon la variation sur 30 jours, repère = pic
const mkSer = (vals, step = 1) => vals.map((v, i) => ({ t: NOWT - (vals.length - 1 - i) * step * 864e5, ctl: v, atl: 0, tsb: 0 }));
const flat = (a, b, n = 61) => Array.from({ length: n }, (_, i) => i < n - 31 ? a : a + (b - a) * (i - (n - 31)) / 30);
assert.equal(Y.trendWord({ delta: 5, pct: 5 }), "en hausse"); assert.equal(Y.trendWord({ delta: -5, pct: -5 }), "en baisse"); assert.equal(Y.trendWord({ delta: 1, pct: 3 }), "stable", "±3 % : stable"); assert.equal(Y.trendWord({ delta: -1, pct: -3 }), "stable"); assert.equal(Y.trendWord(null), null);
let pg = Y.progress(mkSer(flat(70, 71)).map((p, i, A) => i === 5 ? { ...p, ctl: 97 } : p));   // pic de 97, niveau 71 stable
assert.equal(pg.word, "stable"); assert.match(pg.text, /^Ton niveau d'entraînement est de 71, stable sur 30 jours, à 73 % de ton pic de l'année \(97, le \d+(er)? \p{L}+\)\.$/u);
pg = Y.progress(mkSer(flat(60, 66).map((v, i) => i === 3 ? 90 : v))); assert.equal(pg.word, "en hausse"); assert.match(pg.text, /est de 66, en hausse sur 30 jours \(\+6\), à 73 % de ton pic de l'année \(90,/);
pg = Y.progress(mkSer(flat(80, 60).map((v, i) => i === 3 ? 90 : v))); assert.equal(pg.word, "en baisse"); assert.match(pg.text, /est de 60, en baisse sur 30 jours \(−20\), à 67 % de ton pic/);
pg = Y.progress(mkSer(flat(60, 90))); assert.equal(pg.atPeak, true); assert.match(pg.text, /en hausse sur 30 jours \(\+30\), à ton plus haut de l'année\.$/);
pg = Y.progress(mkSer([50, 51, 52])); assert.equal(pg.word, null, "moins de 30 jours : pas de mot de tendance"); assert.ok(!/30 jours/.test(pg.text));
assert.ok(!/CTL|ATL|TSB|TSS/.test(pg.text), "pas de sigle");
const realP = Y.progress(Y.fitSeries(loads, NOW, 365, firstT)); assert.equal(realP.cur, f0.ctl, "chiffre en grand = niveau du Plan");

// ---- 2. « Que faire aujourd'hui ? » : seuils du Plan (frais > 5, équilibré > −10, chargé > −25 ; récup < 45)
const hardPl = { label: "Seuil", dur: 60, hard: true }, easyPl = { label: "Endurance", dur: 90, hard: false };
let ad = Y.advice({ tsb: 14, reco: 73, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "good"); assert.equal(ad.text, "Tu es frais et bien récupéré : bon jour pour ta séance « Seuil » de 60 min prévue ce soir.");
ad = Y.advice({ tsb: 14, reco: 73, hrvLow: false, planned: null }); assert.match(ad.text, /^Tu es frais et bien récupéré : bon jour pour une séance intense/);
ad = Y.advice({ tsb: 14, reco: null, hrvLow: false, planned: easyPl }); assert.equal(ad.text, "Tu es frais : ta séance « Endurance » de 90 min prévue ce soir se fait sans souci.", "sans récup du jour : pas de « bien récupéré »");
ad = Y.advice({ tsb: 0, reco: 70, hrvLow: false, planned: null }); assert.equal(ad.tone, "good"); assert.match(ad.text, /^Ta fraîcheur est correcte et bien récupéré/);
ad = Y.advice({ tsb: -15, reco: 70, hrvLow: true, planned: easyPl }); assert.equal(ad.tone, "bad"); assert.match(ad.text, /^Fatigue récente élevée et VFC basse : /); assert.match(ad.text, /sans chercher|garde|repos|passe/, "chargé + VFC basse : mauvais jour");
ad = Y.advice({ tsb: -15, reco: 70, hrvLow: true, planned: null }); assert.equal(ad.text, "Fatigue récente élevée et VFC basse : garde la séance facile, ou prends un jour de repos.");
ad = Y.advice({ tsb: -15, reco: 70, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "mid"); assert.match(ad.text, /^Fatigue récente élevée : ta séance « Seuil » de 60 min prévue ce soir reste jouable/);
ad = Y.advice({ tsb: -30, reco: 70, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "bad"); assert.match(ad.text, /^Fatigue récente très élevée : ta séance « Seuil » .* à alléger ou à décaler\.$/);
ad = Y.advice({ tsb: 10, reco: 44, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "bad", "récup < 45 (seuil du Plan)"); assert.match(ad.text, /^Récup basse : /);
ad = Y.advice({ tsb: 10, reco: 45, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "mid", "récup 45 : pas basse, mais moyenne"); assert.match(ad.text, /^Récup moyenne : /);
ad = Y.advice({ tsb: 10, reco: 65, hrvLow: false, planned: hardPl }); assert.equal(ad.tone, "good", "65 et plus : bien récupéré (libellé « Plutôt en forme »)");
for (const tsb of [-60, -25.01, -25, -10, 5, 5.01, 40]) assert.equal(Y.advice({ tsb, reco: 70, hrvLow: false, planned: null }).label, planLabel({ tsb }), `étiquette de fraîcheur à ${tsb} = celle du Plan`);
assert.equal(Y.READY_LOW, 45); assert.match(read("../plan.js"), /ready\.today < 45/, "le seuil 45 est bien celui du Plan");

// ---- 3. « Où j'en suis de mes objectifs ? » : départ au 1er janvier, aujourd'hui, objectif, part du chemin
const hist = Y.listSeries([["2025-11-01", 190], ["2026-01-24", 209], ["2026-04-25", 245], ["2026-10-03", 260]]);
let ob = Y.objective(hist, 260, 300, NOWT); assert.equal(ob.start, 190, "valeur connue au 1er janvier reportée (190), pas la première de l'année"); near(ob.pct, 70 / 110 * 100, 1e-9);
ob = Y.objective(hist.slice(1), 260, 300, NOWT); assert.equal(ob.start, 209, "pas de valeur avant le 1er janvier : première de l'année"); near(ob.pct, 51 / 91 * 100, 1e-9); near(ob.bar, ob.pct, 1e-9);
assert.equal(Y.objective(hist.slice(1), 200, 300, NOWT).bar, 0, "sous le départ : barre à 0 (pct négatif gardé)"); assert.ok(Y.objective(hist.slice(1), 200, 300, NOWT).pct < 0);
ob = Y.objective(hist.slice(1), 310, 300, NOWT); assert.equal(ob.bar, 100); assert.equal(ob.reached, true);
assert.equal(Y.objective([], 260, 300, NOWT), null); assert.equal(Y.objective(hist, null, 300, NOWT), null); assert.equal(Y.objective(Y.listSeries([["2027-01-01", 5]]), 6, 300, NOWT), null, "mesure future ignorée");
const realFtp = Y.objective(Y.listSeries(profile.ftpHist), win.Recup.data.profile.ftp, 300, NOWT); assert.equal(realFtp.start, 209, "FTP de départ réel : 209 W");
const real2 = Y.objective(Y.listSeries(profile.vo2), 63.2, 65, NOWT); assert.equal(real2.start, 57.3);
// phrase sous la barre
let pj = proj(lineSer(1)); assert.match(Y.objLine(pj, "W", 0), /^Au rythme actuel : ~\d+ W au 31\/12\. Il faudrait \+3,4 W\/semaine \(tu fais \+1,0\)\.$/);
assert.equal(Y.objLine(proj(lineSer(0), 305), "W", 0), "Objectif atteint."); assert.match(Y.objLine(null, "W", 0), /Pas assez de mesures/);
assert.match(Y.objLine(proj(lineSer(-2)), "W", 0), /tu fais −2,0\)\.$/, "rythme négatif : signe moins");
assert.equal(Y.objLine(Y.projection([0, 1, 2, 3, 4].map(i => ({ t: daysAgo(30 - i * 7), v: 63 + .037 * i })), 65, "2026-12-31", NOWT, 63.2, 1), "", 1).startsWith("Au rythme actuel : ~63,"), true);
// phrase-réponse du bloc
assert.equal(Y.objectivesAnswer([{ name: "FTP", verdict: "hors de portée au rythme actuel" }, { name: "VO2max", verdict: "hors de portée au rythme actuel" }]), "Tes deux objectifs sont hors de portée au rythme actuel.");
assert.equal(Y.objectivesAnswer([{ name: "FTP", verdict: "dans les temps" }, { name: "VO2max", verdict: "dans les temps" }]), "Tes deux objectifs sont dans les temps.");
assert.equal(Y.objectivesAnswer([{ name: "FTP", verdict: "dans les temps" }, { name: "VO2max", verdict: "hors de portée au rythme actuel" }]), "L'objectif FTP est dans les temps et l'objectif VO2max est hors de portée au rythme actuel.");
assert.equal(Y.objectivesAnswer([{ name: "FTP", verdict: "un peu juste" }, { name: "VO2max", verdict: null }]), "L'objectif FTP est un peu juste."); assert.match(Y.objectivesAnswer([{ name: "FTP", verdict: null }]), /Pas assez de mesures/);

// ---- 4. « Quelque chose cloche ? »
const resOf = (o = {}) => ({ gray: { active: false, status: "ok" }, load: { active: false, status: "ok" }, hrv: { active: false, status: "ok" }, sleep: { active: false, status: "ok" }, ...o });
assert.equal(Y.detAnswer(resOf()), "Rien à signaler aujourd'hui.");
assert.equal(Y.detAnswer(resOf({ sleep: { active: false, status: "nodata" } })), "Rien à signaler aujourd'hui (pas assez de données pour : dette de sommeil).");
assert.equal(Y.detAnswer(resOf({ hrv: { active: true, status: "actif" } })), "1 point d'attention : VFC basse.");
assert.equal(Y.detAnswer(resOf({ hrv: { active: true }, load: { active: true } })), "2 points d'attention : charge qui monte trop vite et VFC basse.");
assert.match(Y.detAnswer(resOf({ gray: { status: "nodata" }, load: { status: "nodata" }, hrv: { status: "nodata" }, sleep: { status: "nodata" } })), /^Pas assez de données/);
assert.ok(!/TSS|CTL|ATL|TSB/.test(JSON.stringify(Object.values(Y.DET_TXT).map((f, i) => f({ count: 3, acute: 400, chronic: 250, ratio: 1.6, vals: [{ hrv: 50, lo: 60 }], debt: 4 * 3600, nights: 7, med: 8 * 3600 })))), "pas de sigle dans les explications des alertes");

// ---- 5. Ma semaine
const ws2 = (cur, avgTo) => ({ cur: { hours: 0, n: 0, bike: 0, run: 0, strength: 0, other: 0, ...cur }, avgTo: { hours: 0, ...avgTo } });
assert.equal(Y.weekAnswer(ws2({ hours: 4.5, n: 3, bike: 2, run: 1 }, { hours: 3 + 50 / 60 })), "Depuis lundi : 4 h 30, 3 séances (2 vélo, 1 course) : plus que d'habitude (3 h 50 à ce stade de la semaine).");
assert.match(Y.weekAnswer(ws2({ hours: 2, n: 1, bike: 1 }, { hours: 4 })), /1 séance \(1 vélo\) : moins que d'habitude/);
assert.match(Y.weekAnswer(ws2({ hours: 4, n: 2, bike: 2 }, { hours: 4.2 })), /: comme d'habitude/);
assert.equal(Y.weekAnswer(ws2({}, { hours: 3.5 })), "Aucune séance depuis lundi (d'habitude 3 h 30 à ce stade de la semaine).");
assert.equal(Y.weekAnswer(ws2({ hours: 1, n: 1, bike: 1 }, { hours: 0 })), "Depuis lundi : 1 h 00, 1 séance (1 vélo).", "sans historique : pas de comparaison");
assert.equal(Y.hmTxt(0.75), "45 min"); assert.equal(Y.hmTxt(2), "2 h 00"); assert.equal(Y.hmTxt(1.999), "2 h 00", "59,94 min arrondi à l'heure");
// « à ce stade de la semaine » : la moyenne ne compte que les jours jusqu'au même jour de la semaine (vendredi 9 oct. = lun-ven)
const wsd = Y.weekStats([mk(0), mk(7), mk(7 + 4, { mt: 7200 }), mk(7 + 5, { mt: 3600 }), mk(7 + 6, { mt: 3600 })], NOW, tss);   // d'avant : ven, lun, sam, dim
near(wsd.avgTo.hours, (1 + 2) / 4, 1e-9, "moyenne à ce stade : ven + lun seulement (samedi et dimanche exclus)"); near(wsd.avg.hours, (1 + 2 + 1 + 1) / 4, 1e-9, "semaine complète inchangée");
assert.match(Y.shareAnswer({ total: 100, bike: 62, run: 30, strength: 8, other: 0, pct: { bike: 62, run: 30, strength: 8, other: 0 } }), /^Sur 30 jours : 62 % vélo · 30 % course · 8 % muscu\.$/); assert.match(Y.shareAnswer({ total: 0 }), /^Aucune séance/);

// ---- Détails : titres qui disent quoi regarder
const curve = (vals, step = 1) => vals.map((v, i) => ({ t: NOWT - (vals.length - 1 - i) * step * 864e5, ctl: v }));
const peakDay = new Date(2026, 7, 4).getTime(), cv = Array.from({ length: 120 }, (_, i) => { const t = NOWT - (119 - i) * 864e5; return { t, ctl: t <= peakDay ? 40 + (t - (NOWT - 119 * 864e5)) / (peakDay - (NOWT - 119 * 864e5)) * 57 : 92 } });   // monte à 97 le 4 août puis palier à 92
assert.equal(Y.curveTitle(cv), "Ton niveau a culminé début août, puis s'est stabilisé, 5 % plus bas."); assert.equal(Y.partOfMonth(new Date(2026, 7, 15)), "mi-août"); assert.equal(Y.partOfMonth(new Date(2026, 7, 28)), "fin août");
assert.match(Y.curveTitle(curve(Array.from({ length: 90 }, (_, i) => 50 + i))), /plus haut de la période \(139\)/);
const drop = Array.from({ length: 90 }, (_, i) => ({ t: NOWT - (89 - i) * 864e5, ctl: i < 20 ? 50 + i * 2 : 88 - (i - 20) * .5 })); assert.match(Y.curveTitle(drop), /^Ton niveau a culminé .*, puis a baissé de \d+ %\.$/); assert.equal(Y.curveTitle(curve([1, 2, 3])), "");
assert.match(Y.projTitle("FTP", proj(lineSer(1)), "W", 0), /^FTP : la tendance mène à ~\d+ W au 31\/12, pour un objectif de 300 W\.$/); assert.match(Y.projTitle("FTP", null, "W", 0), /pas assez de mesures/); assert.match(Y.weeksTitle(Y.weeklyBySport(daily, NOW, 12)), /semaine la plus chargée/);
// vocabulaire : le texte de la page n'utilise jamais les sigles (hors commentaires)
const src = read("../synthese.js").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n").replace(/\/\/ .*$/gm, "");
const visible = [...src.matchAll(/`([^`]*)`|"([^"\n]*)"/g)].map(m => m[1] || m[2] || "").filter(t => /[a-zé] [a-zé]/i.test(t) && !/^(#|\.|var\(|M\d|<svg)/.test(t)).join("\n");
assert.ok(!/\b(CTL|ATL|TSB|TSS)\b/.test(visible), "aucun sigle dans les textes affichés : " + (visible.match(/.{0,30}\b(CTL|ATL|TSB|TSS)\b.{0,30}/) || [""])[0]);
for (const k in Y.HELP) assert.ok(Y.HELP[k].split(/[.!?]\s/).length <= 3, "explication « ? » de 1 à 2 phrases : " + k);
console.log("ok synthese 4-bis : amorce de la courbe, phrases (progression, aujourd'hui, objectifs, alertes, semaine), barres d'objectif, titres des détails, pas de sigle");
