// Test des fonctions pures de la carte « Tes performances » (perf.js) : node tests/perf.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url), read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const store = {};
const win = {};
const ctx = { window: win, RIDE_TYPES: RIDE, S: { all: [] }, localStorage: { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  nf: (n, d = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n), esc: s => String(s) };
vm.createContext(ctx); vm.runInContext(read("../perf.js"), ctx);
const P = win.Perf._, near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);
const NOW = new Date(2026, 9, 16, 12).getTime(), DAY = 864e5, ago = d => new Date(NOW - d * DAY);
let id = 1;
const ride = (o = {}) => ({ id: id++, n: "Séance", t: "VirtualRide", tr: 1, dt: ago(o.days ?? 10), m: 30000, mt: 3600, ...o });
const pc = (a, b, c, d) => ({ "5": a, "60": b, "300": c, "1200": d });

// ------------------------------------------------------------------ records par fenêtre
const A = [ride({ days: 10, pc: pc(700, 330, 290, 240) }), ride({ days: 50, pc: pc(650, 340, 280, 230) }),
  ride({ days: 100, pc: pc(800, 320, 270, 220) }), ride({ days: 170, pc: pc(600, 300, 260, 215) }),
  ride({ days: 300, pc: pc(900, 310, 300, 250) }), ride({ days: 400, pc: pc(1000, 400, 350, 300) }),   // > 12 mois : ignoré
  { id: 99, t: "running", dt: ago(5), pc: pc(2000, 2000, 2000, 2000) }];                               // pas du vélo
const R = P.records(A, NOW), r = k => R.find(x => x.k === k);
assert.equal(R.length, 4, "4 durées avec des valeurs (pas de 1 h)");
assert.equal(r("5").cur.v, 700); assert.equal(r("5").prev.v, 800); assert.equal(r("5").year.v, 900, "record 12 mois sans la sortie de 400 j");
assert.equal(r("60").cur.v, 340, "meilleur des 90 j"); assert.equal(r("60").prev.v, 320); assert.equal(r("60").d, 20); near(r("60").pct, 6.25, 1e-9, "Δ %");
assert.equal(r("300").d, 20); assert.equal(r("1200").d, 20); assert.equal(r("60").rec, "battu", "340 W = record des 12 mois"); assert.equal(r("5").rec, "");
assert.equal(P.records([ride({ days: 10, pc: pc(500) }), ride({ days: 200, pc: pc(500) })], NOW)[0].rec, "égalé", "même valeur qu'avant : égalé");
assert.equal(P.bestIn(P.rides(A), "5", NOW - 90 * DAY, NOW + 1).id, A[0].id, "id de la séance du record");
// bornes : 90 j pile appartient aux 90 j récents
assert.equal(P.records([ride({ days: 89.99, pc: pc(500) }), ride({ days: 90.01, pc: pc(400) })], NOW)[0].cur.v, 500);
assert.equal(P.records([ride({ days: 90.01, pc: pc(400) })], NOW)[0].cur, null, "rien en 90 j");
assert.equal(P.records([], NOW).length, 0); assert.equal(P.records([ride()], NOW).length, 0, "sorties sans puissance");

// ------------------------------------------------------------------ tendance et phrase
const T = P.trend(R); assert.equal(T.dir, "up", "médiane des Δ : +6 à +9 %"); assert.equal(T.pick.k, "300", "durée la plus proche de la médiane (+6,8 %) : 5 min (+7,4 %)");
const up = P.headline(R, 250, 76.7, { ftp: 300 });
assert.match(up, /^Tes records de puissance montent : \+7 % sur 5 min en 90 jours \(290 W contre 270\)\./); assert.match(up, /FTP de travail \(250 W\) te place à 3,26 W\/kg, à 50 W de ton objectif\./);
const flat = P.records([ride({ days: 10, pc: pc(700, 330, 290, 240) }), ride({ days: 120, pc: pc(690, 335, 285, 239) })], NOW);
assert.equal(P.trend(flat).dir, "flat"); assert.match(P.headline(flat, 250, 0, {}), /^Tes records de puissance sont stables sur 90 jours \(20 min : 240 W contre 239\)\. Ta FTP de travail est de 250 W\.$/);
const dn = P.records([ride({ days: 10, pc: pc(600, 300, 270, 220) }), ride({ days: 120, pc: pc(800, 380, 290, 225) })], NOW);
assert.equal(P.trend(dn).dir, "down"); assert.match(P.headline(dn, 250, 0, { ftp: 240 }), /baissent : −7 % sur 5 min en 90 jours \(270 W contre 290\)\. .*objectif atteint\./);
assert.match(P.headline([], 250, 0, {}), /^Pas encore de record de puissance/, "sans données");
const only = P.records([ride({ days: 10, pc: pc(600) })], NOW);
assert.equal(P.trend(only), null); assert.match(P.headline(only, 0, 0, {}), /^Pas assez de séances avec puissance/);

// ------------------------------------------------------------------ tuiles
const f = P.ftpTile(250, 76.7, { ftp: 300 }); near(f.wkg, 3.2595, 1e-3, "W/kg"); assert.equal(f.gap, 50); near(f.gwkg, 3.911, 1e-3);
assert.equal(P.ftpTile(250, 0, {}).wkg, null); assert.equal(P.ftpTile(0, 70, {}), null);
const v = P.vo2Tile({ vo2: [["2026-06-01", 60], ["2026-07-10", 61.5], ["2026-10-15", 64]] }, NOW, { vo2: 65 });
assert.equal(v.v, 64); near(v.d90, 2.5, 1e-9, "valeur reportée au 18 juillet = 61,5"); assert.equal(v.gap, 1);
assert.equal(P.vo2Tile({ vo2: [["2026-10-01", 63]] }, NOW, {}).d90, null, "pas de recul"); assert.equal(P.vo2Tile({}, NOW, {}), null);
const vol = P.volume([ride({ days: 3, mt: 7200, m: 60000 }), ride({ days: 20, mt: 7200, m: 60000 }), ride({ days: 60, mt: 3600 * 8, m: 240000 })], NOW);
assert.equal(vol.h, 4); assert.equal(vol.km, 120); assert.equal(vol.wk4, 1); near(vol.wk12, 12 / 12, 1e-9, "12 h en 12 sem."); near(vol.pct, 0, 1e-9);
assert.equal(P.volume([], NOW), null);
const out = o => ride({ t: "Ride", tr: 0, ...o });
const sp = P.outSpeed([out({ days: 10, m: 60000, mt: 7200 }), out({ days: 30, m: 45000, mt: 5400 }), out({ days: 200, m: 50000, mt: 7200 }),
  out({ days: 5, m: 30000, mt: 3000 }), ride({ days: 5, m: 80000, mt: 7200 })], NOW);   // < 40 km et home trainer exclus
near(sp.v8, 30, 1e-9, "105 km en 3 h 30"); assert.equal(sp.n8, 2); near(sp.vy, 155 / (19800 / 3600), 1e-9); assert.equal(sp.ny, 3);
assert.equal(P.outSpeed([out({ days: 100, m: 50000, mt: 7200 })], NOW).v8, null, "aucune sortie en 8 semaines");
const lg = P.longest([out({ dt: new Date(2026, 4, 3), m: 150000 }), out({ dt: new Date(2026, 7, 1), m: 182000 }), out({ dt: new Date(2025, 6, 1), m: 160000 })], NOW);
assert.equal(lg.km, 182); assert.equal(lg.prevKm, 160); assert.equal(lg.y, 2026);

// ------------------------------------------------------------------ repère de classement (tables reprises de l'ancienne carte « Ton niveau » ; AFY reste aussi dans plan.js pour valider les liens)
const planSrc = read("../plan.js");
assert.ok(planSrc.includes("const AFY = "), "AFY toujours dans plan.js");
const rk = P.rank(250, 76.7, "<30"); assert.equal(rk.zwift, 55, "3,26 W/kg : 42 + 43 × 0,06/0,8 ≈ 45 % → top 55 %"); assert.ok(rk.lab > 90); assert.equal(P.rank(250, 0, "<30"), null);
assert.equal(P.rank(250, 76.7, "??").age, "30-39", "âge inconnu");

// ------------------------------------------------------------------ html : champs obligatoires
store.bwWeight = "76.7"; store.bwAge = JSON.stringify("<30");
const H = win.Perf.html({ profile: { vo2: [["2026-10-15", 64]] }, ftp: 250, goal: { ftp: 300, vo2: 65 }, acts: A, now: NOW });
assert.match(H, /^<section class="card span12 rank perf">/); assert.match(H, /<input id="pKg"[^>]*value="76.7"/);
assert.ok(["<30", "30-39", "40-49", "50-59", "60+"].every(k => H.includes(`<option ${k === "<30" ? "selected" : ""}>${k}</option>`)), "options d'âge");
assert.match(H, /<select id="pAge">/); assert.match(H, /restent uniquement sur cet appareil/); assert.match(H, /data-pfb="/);
assert.ok(!/\bTSS|CTL|ATL|TSB\b/.test(H), "pas de sigles");
delete store.bwWeight;
const H0 = win.Perf.html({ profile: {}, ftp: 250, goal: {}, acts: [], now: NOW });
assert.match(H0, /Indique ton poids/); assert.match(H0, /Pas encore de record/); assert.ok(!H0.includes("Repère :"), "pas de classement sans poids");

// ------------------------------------------------------------------ contrôle sur les vraies données
const acts = JSON.parse(read("../data/activities.json")).map(a => ({ ...a, dt: new Date(a.d) }));
const prof = JSON.parse(read("../data/recovery.json")).profile;
const RR = P.records(acts, NOW), TT = P.trend(RR);
console.log("records réels :", RR.map(x => `${x.l} ${x.cur ? x.cur.v : "–"} (avant ${x.prev ? x.prev.v : "–"}, 12 mois ${x.year.v} le ${new Date(x.year.t).toLocaleDateString("fr-FR")})`).join(" · "));
console.log("phrase :", P.headline(RR, 250, 76.7, { ftp: 300 }));
console.log("VO2 :", JSON.stringify(P.vo2Tile(prof, NOW, { vo2: 65 })), "volume :", JSON.stringify(P.volume(acts, NOW)), "vitesse :", JSON.stringify(P.outSpeed(acts, NOW)), "plus longue :", JSON.stringify(P.longest(acts, NOW)));
assert.ok(RR.length >= 4 && RR.every(x => x.year.v >= (x.cur ? x.cur.v : 0) && x.year.v >= (x.prev ? x.prev.v : 0)), "record 12 mois ≥ fenêtres");
assert.ok(TT && ["up", "flat", "down"].includes(TT.dir));
const v2 = P.vo2Tile(prof, NOW, { vo2: 65 }); assert.ok(v2.v > 40 && v2.v < 90);
const sp2 = P.outSpeed(acts, NOW); assert.ok(sp2.vy > 20 && sp2.vy < 40, "vitesse dehors plausible");
console.log("perf : tous les tests passent");
