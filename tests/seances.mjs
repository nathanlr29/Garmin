// Test des séances clés course (seances.js) : node tests/seances.mjs
// Allures de Daniels, échelles de paliers, volume borné par les km de la semaine, durée tenue, version montre (spec, .fit, empreinte),
// envoi vers la collection `montre` (seulement ce qui change, jamais le passé), état côté Garmin, carte.
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const read = f => readFileSync(new URL(f, import.meta.url), "utf8");
const near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);
const ctx = { window: {}, addEventListener() {}, TextEncoder, localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; })() };
vm.createContext(ctx); vm.runInContext(read("../fitcourse.js"), ctx); vm.runInContext(read("../seances.js"), ctx);
const S = ctx.window.Seances, X = S._;
ctx.FitCourse = ctx.window.FitCourse;

// ------------------------------------------------------------------ 1. Allures (tables de Daniels)
// VDOT d'un 10 km en 43:35 ≈ 47 ; tables : seuil 4:28-4:29, I 4:07-4:08 /km
const P = S.paces(S.source({ races: { "10k": 2615, "5k": 1229 }, lt: { pace: 252 } }));
near(P.V, 47.0, .1, "VDOT 10 km 43:35"); near(P.T, 268, 2, "seuil"); near(P.I, 247, 2, "I"); near(P.k10, 2615, 2, "le 10 km prédit retrouve le chrono");
assert.ok(P.E[0] < P.E[1] && P.E[0] > P.HM && P.HM > P.T && P.T > P.I && P.I > P.VV, "footing > semi > seuil > I > vVO2max");
near(X.vdot(5000, 20 * 60), 49.8, .2, "VDOT d'un 5 km en 20:00 (table : 49,8)");
assert.equal(P.src.how, "10k", "le 10 km prédit d'abord (pas le 5 km, pas le seuil Garmin)");
assert.match(P.src.txt, /10 km prédit par Garmin \(43:35\)/);
// réglage à la main : c'est l'allure seuil
const Po = S.paces(S.source({ own: 255, races: { "10k": 2615 } })); near(Po.T, 255, 1, "allure seuil réglée"); assert.equal(Po.src.how, "own");
// repli : 5 km, puis seuil Garmin, puis repli ; valeurs absurdes ignorées
assert.equal(S.source({ races: { "10k": 99, "5k": 1229 } }).how, "5k");
assert.equal(S.source({ races: {}, lt: { pace: 252 } }).how, "lt"); near(S.paces(S.source({ lt: { pace: 252 } })).T, 252, 1, "seuil Garmin");
assert.equal(S.source({ fallback: 1 }).how, "fallback"); near(S.paces(S.source({})).T, 300, 1, "repli 5:00");

// ------------------------------------------------------------------ 2. Échelles
for (const [t, L] of Object.entries(S.LADDERS)) {
  assert.ok(L.length >= 7, t);
  const work = s => (s.sets || 1) * s.n * s.on;
  L.forEach((s, k) => { if (k) assert.ok(work(s) >= work(L[k - 1]) || s.on > L[k - 1].on, `${t} #${k + 1} : jamais moins de travail, sauf blocs plus longs`); });
}
assert.equal(S.stepL("rthr", 0), "#1 · 3 × 4' au seuil"); assert.equal(S.stepL("rvo2", 2), "#3 · 2 × 10 × 30/30"); assert.equal(S.stepL("rhill", 0), "#1 · 6 × 10\" en côte");

// ------------------------------------------------------------------ 3. Séances : durée, palier, volume
const B = (t, d, o = {}) => S.build(t, d, { P, ...o });
for (const t of ["rthr", "rvo2", "rhill", "rstrides", "rtempo"]) for (const d of [30, 35, 40, 45, 50, 60, 75, 90]) for (const k of [0, 2, 4, 6]) {
  const w = B(t, d, { k, wkKm: 30 }), sum = w.steps.reduce((a, s) => a + s.d, 0);
  const over = sum > d * 60 + 1;   // palier trop long même au minimum de répétitions : plus long que prévu, et la séance le dit
  assert.ok(over ? /trop courte : même réduite/.test(w.cut) : Math.abs(sum - d * 60) <= 1, `${t} ${d} min #${k + 1} : lignes = durée (${sum})`);
  if (t !== "rhill") assert.ok(Math.abs(X.total(w.spec.steps) - sum) <= 1, `${t} ${d} min : montre = lignes (${X.total(w.spec.steps)})`);
  if (d >= 40 && t !== "rhill") assert.ok(!over, `${t} ${d} min #${k + 1} : tient dans la durée`);
  assert.ok(w.spec.name.length <= 31 && w.title && w.goal && w.km > 3, t);
  w.spec.steps.forEach(st => (st.rep ? st.steps : [st]).forEach(x => assert.ok(new TextEncoder().encode(x.n).length <= 16, `nom de pas court (montre) : ${x.n}`)));
}
let w = B("rthr", 40, { k: 1 });
assert.equal(w.title, "Seuil #2 · 4 × 4'"); assert.equal(w.cut, null);
const rep = w.steps.find(s => s.n); assert.equal(rep.pace, P.T); assert.equal(rep.plo, P.T - 4); assert.equal(rep.phi, P.T + 4);
assert.deepEqual(JSON.parse(JSON.stringify(w.spec.steps[1].steps[0].p)), [P.T - 4, P.T + 4], "fourchette envoyée à la montre");
// règle de Daniels : 25 km par semaine → 2,7 km au seuil au plus (plancher) → 3 × 4' au lieu de 4 × 4'
w = B("rthr", 40, { k: 1, wkKm: 25 }); assert.equal(w.title, "Seuil #2 · 3 × 4'"); assert.match(w.cut, /limité à 10 % de tes km .*3 répétitions au lieu de 4/);
w = B("rthr", 40, { k: 1, wkKm: 40 }); assert.equal(w.title, "Seuil #2 · 4 × 4'", "40 km : palier complet");
// séance trop courte : moins de répétitions, jamais sous le minimum
w = B("rthr", 30, { k: 7 }); assert.equal(w.steps.find(s => s.n).n, 2, "minimum gardé"); assert.match(w.cut, /trop courte : même réduite à 2 répétitions, elle dure 47 min/);
w = B("rhill", 45, { k: 4 }); assert.match(w.cut, /trop courte .*il demande 50 min.*7 répétitions au lieu de 8/);
// 30/30 : vitesse VO2max ; blocs de 3-4 min : allure I ; séries : une récup entre les deux
assert.equal(B("rvo2", 40, { k: 0 }).steps.find(s => s.n).pace, P.VV);
assert.equal(B("rvo2", 50, { k: 4 }).steps.find(s => s.n).pace, P.I);
w = B("rvo2", 50, { k: 2 }); assert.equal(w.steps.filter(s => s.n).length, 2); assert.ok(w.steps.some(s => /entre les séries/.test(s.label)));
// côtes : pas d'allure (effort), échauffement jusqu'au bouton Lap ; lignes droites sans cible
w = B("rhill", 40, { k: 0 }); assert.equal(w.spec.steps[0].s, 0); assert.equal(w.spec.steps[1].steps[0].p, null); assert.match(w.goal, /périostite/);
assert.equal(B("rstrides", 40).spec.steps[1].rep, 6);
assert.equal(S.build("rfoot", 40, { P }), null, "footing : pas une séance clé");

// ------------------------------------------------------------------ 4. Montre : .fit, empreinte, fichier de test du workflow
const fit = S.fit(B("rthr", 40, { k: 1 }).spec, Date.UTC(2026, 10, 23));
assert.equal(String.fromCharCode(...fit.slice(8, 12)), ".FIT");
assert.equal(ctx.FitCourse._crc(fit.subarray(0, fit.length - 2)), fit[fit.length - 2] | fit[fit.length - 1] << 8, "CRC du fichier");
assert.equal(S.fileName(B("rthr", 40, { k: 1 }).spec, "2026-11-26"), "2026-11-26_Seuil-2-4x4.fit");
assert.equal(S.fileName(B("rhill", 40).spec), "Cotes-1-6x10.fit");
// tests/fixtures/montre_seances.json (lu par tests/test_garmin.py) : même contenu et même empreinte que seances.js aujourd'hui
const FX = JSON.parse(read("fixtures/montre_seances.json")), P10 = S.paces(S.source({ races: { "10k": 2615 } }));
[["rthr", 40, 1], ["rvo2", 50, 2], ["rhill", 40, 0]].forEach(([t, d, k], i) => {
  const v = { date: FX[i].date, ...S.build(t, d, { P: P10, k, wkKm: 40 }).spec };
  assert.equal(JSON.stringify({ ...v, sig: S.sig(v) }), JSON.stringify(FX[i]), `fixture ${t} à jour (sinon : la régénérer)`); });

// ------------------------------------------------------------------ 5. Envoi vers la Sheet : seulement ce qui change, dans la fenêtre
const today = "2026-11-24", v1 = { date: "2026-11-26", sig: "aaaa" }, v2 = { date: "2026-11-28", sig: "bbbb" };
let d = X.diff({ "2026-11-26": v1, "2026-11-28": v2 }, { "2026-11-26": "aaaa", "2026-11-27": "cccc", "2026-11-20": "dddd", "2026-12-09": "eeee" }, today, 5);
assert.deepEqual(JSON.parse(JSON.stringify(d)), [{ id: "run:2026-11-28", ts: 5, v: v2 }, { id: "run:2026-11-27", ts: 5, v: null }], "nouvelle, retirée ; ni le passé ni au-delà de 8 jours");
assert.equal(X.diff({ "2026-11-26": { ...v1, sig: "zzzz" } }, { "2026-11-26": "aaaa" }, today, 5, new Set(["2026-11-26"])).length, 0, "séance déjà faite : jamais renvoyée");
assert.equal(X.diff({ "2026-11-26": v1 }, null, today).length, 0, "Sheet jamais lue sur cet appareil : on attend");
assert.ok(X.inWin("2026-11-24", today) && X.inWin("2026-12-01", today) && !X.inWin("2026-12-02", today) && !X.inWin("2026-11-23", today));

// ------------------------------------------------------------------ 6. État côté Garmin et carte
const spec = B("rthr", 40, { k: 1 }).spec, sg = S.sig({ date: "2026-11-26", ...spec });
assert.equal(S.status("2026-11-26", spec).k, "nocfg", "sans synchro sur cet appareil");
ctx.window.Sync = { configured: () => true }; ctx.Sync = ctx.window.Sync;
assert.equal(S.status("2026-11-26", spec).k, "load");
let resolve; ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 1, cfg: true, w: { "2026-11-26": { id: 1, sid: 2, s: sg } } }) });
await S.loadState();
assert.equal(S.status("2026-11-26", spec).k, "ok"); assert.equal(S.status("2026-11-28", spec).k, "wait");
const html = S.cardHtml({ P, next: [{ date: "2026-11-26", t: "rthr", title: "Seuil #2 · 4 × 4'", spec, pace: P.T, when: "jeudi 26 novembre", whenShort: "jeu. 26" }],
  pal: { rthr: 1, rhill: 0, rvo2: 0 }, palDone: { rthr: new Set([0]) }, lt: { pace: 252 }, reprise: null });
assert.match(html, /Prochaine séance clé : Seuil #2 · 4 × 4' jeudi 26 novembre à 4:28 \/km\./);
assert.match(html, /✓ dans ton calendrier Garmin/); assert.match(html, /seuil 4:28/); assert.match(html, /Le seuil Garmin \(4:12 \/km\) reste celui de la charge ; il est plus rapide de 16 s/);
assert.match(html, /SYNC_LINK/); assert.ok(!/<script/i.test(html));
assert.match(X.answer({ next: [], reprise: { k: 3, light: true, nextKey: { k: 4, t: "rstrides" } } }), /palier 4 de ta reprise, semaine allégée\)\. La prochaine arrive au palier 5 : lignes droites/);
assert.match(X.answer({ next: [], mode: "entretien" }), /Progression/);

console.log("ok seances : allures de Daniels, paliers, volume (Daniels), durées, .fit, empreinte partagée avec le workflow, envoi, état, carte");
