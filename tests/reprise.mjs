// Test du programme de reprise course (reprise.js) : node tests/reprise.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const read = f => readFileSync(new URL(f, import.meta.url), "utf8");
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {} } };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); vm.runInContext(read("../reprise.js"), ctx);
const R = ctx.window.Reprise, X = R._, same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const day = (s, h = 7) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, h); };
const run = (s, min, t = "running") => ({ t, dt: day(s), mt: min * 60, m: min * 60 / 5.6 * 1000 / 60 });
const sum = a => a.reduce((s, x) => s + x, 0);

// ------------------------------------------------------------------ Échelle
assert.equal(X.LADDER.length, 17);
X.LADDER.forEach((L, i) => { if (i && !X.LIGHT.has(i) && !X.LIGHT.has(i - 1)) assert.ok(Math.max(...L) - Math.max(...X.LADDER[i - 1]) <= 5, `palier ${i + 1} : la plus longue prend 5 min au plus`); });
X.LADDER.forEach((L, i) => { if (X.LIGHT.has(i)) assert.ok(sum(L) < sum(X.LADDER[i - 1]), `palier ${i + 1} allégé`); });
assert.ok(sum(X.LADDER[16]) * 60 / 340 > 45, "arrivée vers 47 km");

// ------------------------------------------------------------------ Progression (lundi 2 novembre 2026)
const P0 = X.progress([], day("2026-10-30"));
assert.equal(P0.started, false); assert.equal(P0.k, 0);
assert.match(X.answer(P0, X.week(0, [], 30), Date.now()), /démarre le lundi 2 novembre : 3 sorties de 25, 25 et 30 min/);
// semaine 1 réussie (80 min), semaine 2 à 70 % (même palier), semaine 3 réussie
let acts = [run("2026-11-03", 25), run("2026-11-05", 25), run("2026-11-08", 30),
  run("2026-11-10", 30), run("2026-11-14", 33),
  run("2026-11-17", 25), run("2026-11-19", 30), run("2026-11-22", 35)];
let P = X.progress(acts, day("2026-11-24", 12));
same(P.hist.map(h => h.res), ["up", "same", "up"]); assert.equal(P.k, 2, "palier 3");
// semaine vide → un palier en arrière ; deux semaines vides → deux paliers
P = X.progress(acts, day("2026-12-01", 12)); assert.equal(P.k, 1);
P = X.progress(acts, day("2026-12-08", 12)); assert.equal(P.k, 0);
assert.equal(X.progress([], day("2026-11-30")).k, 0, "jamais sous le palier 1");
// semaine allégée (palier 4) : 50 % suffisent
const light = [run("2026-11-03", 25), run("2026-11-05", 25), run("2026-11-08", 30), run("2026-11-10", 30), run("2026-11-12", 30), run("2026-11-15", 35),
  run("2026-11-17", 30), run("2026-11-19", 30), run("2026-11-22", 40), run("2026-11-24", 45)];
P = X.progress(light, day("2026-12-01", 12)); same(P.hist.map(h => h.res), ["up", "up", "up", "up"]); assert.equal(P.k, 4);
// les vélos et la muscu ne comptent pas
assert.equal(X.weekRuns([{ t: "Ride", dt: day("2026-11-03"), mt: 3600 }, { t: "strength_training", dt: day("2026-11-03"), mt: 3600 }], day("2026-11-02", 0)).length, 0);
assert.equal(X.weekRuns([run("2026-11-03", 30, "trail_running")], day("2026-11-02", 0)).length, 1, "trail compté");

// ------------------------------------------------------------------ Plus longue sortie plafonnée
assert.equal(X.longCap([run("2026-10-09", 32)], day("2026-11-02", 12)), 35, "32 min il y a 24 jours → 35 au plus");
assert.equal(X.longCap([], day("2026-11-02", 12)), 25, "rien sur 30 jours → 25 min");
const W = X.week(2, [], 35); same(W.rows.map(r => r.min), [35, 30, 30], "40 ramené à 35"); assert.equal(W.capped, true);

// ------------------------------------------------------------------ Semaine en cours
const W2 = X.week(2, [{ d: 0, min: 41 }], 45);
same(W2.rows.map(r => r.done), [41, null, null], "la course faite coche la plus longue"); same(W2.left, [30, 30]);
assert.match(X.answer({ started: true, k: 2, last: { res: "down", min: 30, T: 90 } }, W2, Date.now()), /Palier 3 sur 17 : 3 sorties de 30, 30 et 40 min.*33 % du prévu : un palier en arrière.*il reste 30 et 30 min/);

// ------------------------------------------------------------------ Créneaux
const hard = t => ["vo2r", "ss", "thr", "grp", "long", "test"].includes(t);
const items = [{ bike: { t: "end", st: "done" } }, { bike: { t: "ss", st: "plan" } }, { bike: { t: "tempo", st: "plan" } }, { muscu: { s: "legs", st: "plan" } }, {}, { bike: { t: "grp", st: "plan" } }, {}];
same(X.slots(items, 0, [0], 2, 0, hard).map(s => s.d), [4, 6], "ni clé, ni jambes, ni groupe ; jours sans vélo d'abord");
same(X.slots(items, 0, [0], 3, 0, hard).map(s => s.what), ["en plus du vélo facile", "pas de vélo", "pas de vélo"], "mercredi : endurance + tempo");
same(X.slots(items, 3, [0], 3, 0, hard).map(s => s.d), [4, 6], "à partir de jeudi");
const empty = Array.from({ length: 7 }, () => ({}));
same(X.slots(empty, 0, [5], 1, 0, hard).map(s => s.d), [0], "pas la veille ni le lendemain d'une course avant le palier 9");
same(X.slots(empty, 0, [5], 1, 9, hard).map(s => s.d), [6], "à partir du palier 9, deux jours de suite permis");
same(X.slots(items, 0, [], 0, 0, hard), []);

// ------------------------------------------------------------------ Rendu
const h = R.html({ acts, items, now: day("2026-11-24", 12).getTime() });
assert.match(h, /Ta reprise course/); assert.match(h, /Palier 3 sur 17/); assert.doesNotMatch(h, /undefined|NaN/);
assert.match(R.html({ acts: [], items, now: day("2026-10-23", 12).getTime() }), /démarre le lundi 2 novembre/);
console.log("reprise : ok");
