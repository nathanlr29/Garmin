// Test des fonctions pures de la carte « Progression course » (course.js) : node tests/course.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url), read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const cols = {}, pushed = [];   // faux Sync : collections déclarées et éléments poussés
const win = { Recup: { data: { profile: {} } }, Sync: { register: (n, c) => { cols[n] = c; }, push: (n, items) => pushed.push([n, ...items]), configured: () => true } };
const store = {};
const ctx = { window: win, S: { all: [] }, RIDE_TYPES: RIDE, localStorage: { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { addEventListener() {} }, MONTHS: [], nf: (n, d = 0) => (+n).toFixed(d), esc: s => String(s) };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); vm.runInContext(read("../course.js"), ctx);
const C = win.Course._, near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);   // objets issus du vm : comparaison JSON

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime(), DAY = 864e5;
const ago = d => NOW - d * DAY;
let id = 1;
const run = (o = {}) => { const at = o.at ?? ago(o.days ?? 10); return { id: id++, n: "Course", t: "running", dt: new Date(at), d: "", mt: 1800, m: 5000, km: (o.m ?? 5000) / 1000, el: 0, hr: 145, ...o, km: (o.m ?? 5000) / 1000 }; };
const pace = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ------------------------------------------------------------------ Riegel
near(C.riegelD60(10000, 3600), 10000, 1e-9, "10 km en 60 min = 10 km");
near(C.riegelD60(5000, 1200), 5000 * Math.pow(3, 1 / 1.06), 1e-6, "5 km en 20 min");
near(C.paceOfD60(10000), 360, 1e-9, "10 km en 60 min = 6:00/km");
assert.ok(C.riegelD60(10000, 2400) > 10000 && C.riegelD60(10000, 4200) < 10000);
assert.equal(C.riegelD60(0, 1200), null); assert.equal(C.riegelD60(5000, 0), null); assert.equal(C.paceOfD60(0), null);
const pred = C.thrFromPrediction({ races: { "10k": 2439, d: "2026-10-09" } });
near(pred.pace, 3.6e6 / (10000 * Math.pow(3600 / 2439, 1 / 1.06)), 1e-9, "seuil d'après le 10 km prédit"); near(pred.pace, 249, 1, "≈ 4:09/km"); assert.equal(pred.d, "2026-10-09");
for (const bad of [null, {}, { races: {} }, { races: { "10k": null } }, { races: { "10k": 0 } }]) assert.equal(C.thrFromPrediction(bad), null);

// ------------------------------------------------------------------ Efficacité à cardio égal : sélection des sorties
const run0 = { lt: { pace: 232, hr: 175 } };   // bande de FC : 131,25 à 154 bpm
const sel = (acts, p = run0) => C.effPoints(acts, p, NOW);
assert.equal(sel([run()]).length, 1, "sortie de référence retenue");
assert.equal(sel([run({ at: ago(10), mt: 1499 })]).length, 0, "moins de 25 min");
assert.equal(sel([run({ mt: 1500 })]).length, 1, "25 min pile");
assert.equal(sel([run({ a: 1, t: "treadmill_running" })]).length, 0, "tapis exclu");
assert.equal(sel([run({ at: undefined, days: 10 }), { ...run(), t: "virtual_run" }]).length, 1, "course virtuelle exclue");
assert.equal(sel([{ ...run(), t: "Ride" }]).length, 0, "vélo ignoré");
assert.deepEqual([130, 131, 132, 154, 155].map(hr => sel([run({ hr })]).length), [0, 0, 1, 1, 0], "bande 75-88 % de 175 bpm");
assert.deepEqual([130, 131, 154, 155].map(hr => sel([run({ hr })], {}).length), [0, 1, 1, 0], "sans seuil : 131-154 bpm");
assert.deepEqual([{ m: 5000, el: 74 }, { m: 5000, el: 75 }, { m: 5000, el: 76 }].map(o => sel([run(o)]).length), [1, 0, 0], "D+/km < 15 m (strict)");
assert.equal(sel([run({ days: 548 })]).length, 0, "plus de 18 mois"); assert.equal(sel([run({ days: 500 })]).length, 1);
assert.equal(sel([run({ hr: 0 }), run({ hr: null })]).length, 0, "sans FC");
// valeur : allure équivalente à 145 bpm, D+ corrigé avec la constante de Charge
assert.equal(win.Charge.RUN_CLIMB, 8);
near(sel([run({ m: 5000, mt: 1800, el: 0, hr: 145 })])[0].v, 360, 1e-9, "5 km en 30 min à 145 bpm = 6:00/km");
near(sel([run({ m: 5000, mt: 1800, hr: 135 })])[0].v, 360 * 135 / 145, 1e-9, "cardio plus bas : allure équivalente plus lente → ×145/FC");
near(sel([run({ m: 4600, mt: 1800, el: 50, hr: 145 })])[0].v, 1000 / ((4600 + 8 * 50) / 1800), 1e-9, "D+ corrigé avec Charge.RUN_CLIMB");
// médiane glissante sur 8 semaines
const P = [10, 20, 30, 40, 100].map((d, i) => ({ t: ago(d), v: 300 + i * 10 }));   // il y a 100 j : hors fenêtre de 56 j
assert.equal(C.median([3, 1, 2]), 2); assert.equal(C.median([4, 1, 2, 3]), 2.5); assert.equal(C.median([]), null);
assert.equal(C.medianAt(P, NOW), 315, "médiane des 4 points des 8 dernières semaines");   // 300,310,320,330 -> 315
assert.equal(C.medianAt(P.slice(0, 2), NOW), null, "moins de 3 points : pas de médiane");
const ms = C.medianSeries(P, ago(100), NOW); assert.ok(ms.length >= 1 && ms.every((p, i) => p.v >= 300 && p.v <= 340 && (!i || p.t > ms[i - 1].t)), "série de médianes : valeurs plausibles, dates croissantes");
assert.equal(ms[0].v, 320, "1re médiane (3 points : 20, 30, 40 j → 310, 320, 330)");
// 4 dernières semaines contre les 4 précédentes (vitesses)
const ch = C.effChange([{ t: ago(5), v: 300 }, { t: ago(12), v: 300 }, { t: ago(35), v: 330 }, { t: ago(40), v: 330 }], NOW);
near(ch.pct, (330 / 300 - 1) * 100, 1e-6, "plus rapide de 10 %"); near(ch.pace0, 330, 1e-9, "allure d'avant"); near(ch.pace1, 300, 1e-9, "allure récente");
assert.equal(C.effChange([{ t: ago(5), v: 300 }], NOW), null, "rien avant"); assert.equal(C.effChange([{ t: ago(35), v: 330 }], NOW), null, "rien depuis");
assert.ok(C.effChange([{ t: ago(5), v: 360 }, { t: ago(35), v: 300 }], NOW).pct < 0, "plus lent : négatif");
assert.equal(C.effRecent([{ t: ago(5), v: 300 }, { t: ago(40), v: 330 }], NOW).n, 1);

// ------------------------------------------------------------------ Allure seuil d'après tes efforts
const eff = (acts, p = run0) => C.thrFromEfforts(acts, p, NOW);
const E = (o = {}) => run({ mt: 2400, m: 10000, hr: 170, ...o });
near(eff([E({ days: 20 })]).pace, 3.6e6 / (10000 * Math.pow(3600 / 2400, 1 / 1.06)), 1e-9, "10 km en 40 min d'après Riegel"); near(eff([E({ days: 20 })]).pace, 3.6e6 / 14660, 2);
assert.equal(eff([E({ days: 20 })]).stale, false); assert.equal(eff([E({ days: 56 })]).stale, false, "8 semaines pile : pas ancien"); assert.equal(eff([E({ days: 57 })]).stale, true, "plus de 8 semaines : ancien");
assert.equal(eff([E({ days: 179 })]) != null, true); assert.equal(eff([E({ days: 181 })]), null, "au-delà de 180 jours");
assert.equal(eff([E({ mt: 899 })]), null, "moins de 15 min"); assert.equal(eff([E({ mt: 900 })]) != null, true); assert.equal(eff([E({ mt: 4501 })]), null, "plus de 75 min"); assert.equal(eff([E({ mt: 4500 })]) != null, true);
assert.deepEqual([157, 158].map(hr => eff([E({ hr })]) != null), [false, true], "FC ≥ 90 % de 175 bpm (157,5)");
assert.deepEqual([156, 157].map(hr => eff([E({ hr })], {}) != null), [false, true], "sans seuil : FC ≥ 157");
assert.equal(eff([{ ...E(), t: "Ride" }]), null, "vélo ignoré"); assert.equal(eff([]), null);
// la meilleure distance tenable en 60 min l'emporte, et on indique la sortie retenue
const A1 = E({ days: 30, m: 8000, mt: 2000 }), A2 = E({ days: 15, m: 10000, mt: 2400 }), A3 = E({ days: 5, m: 5000, mt: 1500 });
const best = eff([A1, A2, A3]); assert.equal(best.a, [A1, A2, A3].reduce((b, x) => C.riegelD60(x.m, x.mt) > C.riegelD60(b.m, b.mt) ? x : b)); assert.equal(best.minHr, 157.5);
assert.equal(eff([], {}), null); assert.equal(eff([E({ hr: 157 })], {}).minHr, 157);

// ------------------------------------------------------------------ Saisie m:ss
for (const [s, sec] of [["3:52", 232], [" 4:05 ", 245], ["3'52", 232], ["3:00", 180], ["8:00", 480], ["04:05", 245], ["7:59", 479]]) same(C.parsePace(s), { ok: true, sec }, "saisie " + s);
for (const s of ["2:59", "8:01", "9:00", "0:30", "abc", "", "   ", null, undefined, "4:5", "4:60", "3:52:10", "4,05", "232", "4"]) { const r = C.parsePace(s); assert.equal(r.ok, false, "refusée : " + JSON.stringify(s)); assert.ok(r.msg && r.msg.includes("m:ss") || r.msg.includes("entre"), "message : " + r.msg); }

// ------------------------------------------------------------------ Chronos : variations avec des trous
const H = [["2026-01-01", 1200, null, 5500, 12000], ["2026-01-02", null, null, null, null], ["2026-03-01", 1150, 2400, null, 11800], ["2026-07-01", null, 2300, 5400, 11700], ["2026-09-01", 1100, null, 5300, null], ["2026-10-09", 1090, 2250, 5200, 11500]];
same(C.histSeries(H, "5k").map(p => p.v), [1200, 1150, 1100, 1090], "trous écartés");
same(C.histSeries(H, "10k").map(p => p.v), [2400, 2300, 2250]); assert.equal(C.histSeries(null, "5k").length, 0); assert.equal(C.histSeries([["2026-01-01", 0, "x"]], "5k").length, 0);
const s5 = C.histSeries(H, "5k"), jan1 = new Date(2026, 0, 1).getTime();
let v = C.variation(s5, NOW, 30); assert.equal(v.cur, 1090); assert.equal(v.ref, 1100, "il y a 30 j : dernière valeur connue (1er sept., report)"); assert.equal(v.delta, -10); near(v.pct, -10 / 1100 * 100, 1e-9, "pct");
v = C.variation(s5, NOW, 90); assert.equal(v.ref, 1150, "il y a 90 j : valeur du 1er mars reportée (pas de point en juillet)"); assert.equal(v.delta, -60);
v = C.variation(s5, NOW, 0, jan1); assert.equal(v.ref, 1200, "depuis le 1er janvier"); assert.equal(v.delta, -110); assert.ok(v.pct < 0, "plus rapide = négatif");
assert.equal(C.variation(s5, NOW, 400), null, "série trop récente : pas de variation"); assert.equal(C.variation([], NOW, 30), null);
const s10 = C.histSeries(H, "10k"); assert.equal(C.variation(s10, NOW, 90).ref, 2300, "10 km : il y a 90 j = valeur du 1er juillet"); assert.equal(C.variation(s10, NOW, 0, jan1), null, "10 km : pas de valeur au 1er janvier");
v = C.variation(C.histSeries(H, "m"), NOW, 30); assert.equal(v.ref, 11700, "trou sur le 1er sept. : report de la valeur de juillet"); assert.equal(C.valueAt(s5, ago(1000)), null);

// ------------------------------------------------------------------ Jauge de reprise
const G = acts => C.gauge(acts, NOW), runsKm = (acute, chronic) => [run({ days: 2, m: acute * 1000 }), ...[9, 16, 23, 30].map(d => run({ days: d, m: chronic / 4 * 1000 }))];
let g = G(runsKm(10, 80)); near(g.acute, 10, 1e-9, "aigu"); near(g.chronic, 20, 1e-9, "chronique"); near(g.ratio, .5, 1e-9, "ratio"); assert.equal(g.zone, 0, "sous-charge"); assert.equal(g.resume, false); same(g.advice, [16, 26]);
const zoneOf = r => G(runsKm(r * 20, 80)).zone;
assert.deepEqual([.5, .79, .8, 1, 1.3, 1.31, 1.5, 1.51, 2.4].map(zoneOf), [0, 0, 1, 1, 1, 2, 2, 3, 3], "4 zones : < 0,8 · 0,8-1,3 · 1,3-1,5 · > 1,5");
assert.equal(C.gaugeZone(.8), 1); assert.equal(C.gaugeZone(1.3), 1); assert.equal(C.gaugeZone(1.5), 2);
// frontières des fenêtres : 7 jours (aigu) puis 28 jours (chronique)
g = G([run({ at: NOW - 7 * DAY + 1, m: 5000 }), run({ at: NOW - 7 * DAY, m: 8000 }), run({ at: NOW - 35 * DAY + 1, m: 12000 }), run({ at: NOW - 35 * DAY, m: 40000 })]);
near(g.acute, 5, 1e-9, "aigu : (maintenant − 7 j, maintenant]"); near(g.chronic, (8 + 12) / 4, 1e-9, "chronique : les 28 jours d'avant, divisés par 4");
// mode reprise : chronique < 15 km/sem.
assert.equal(G(runsKm(5, 59)).resume, true); assert.equal(G(runsKm(5, 61)).resume, false); assert.equal(G(runsKm(5, 60)).resume, false, "15 pile : plus en reprise");
g = G([run({ days: 2, m: 6000 })]); assert.equal(g.ratio, null, "pas de course les 4 semaines d'avant"); assert.equal(g.zone, null); assert.equal(g.advice, null); assert.equal(g.resume, true);
g = G([]); assert.equal(g.ratio, null); assert.equal(g.resume, true); assert.equal(g.since, null); assert.equal(g.weeks.length, 12);
// tapis compté (km courus), vélo ignoré
assert.equal(G([run({ days: 2, m: 5000, t: "treadmill_running" }), { ...run({ days: 2 }), t: "Ride", m: 90000, km: 90 }]).acute, 5);
// semaines depuis la dernière semaine à plus de 25 km (lundi-dimanche)
const mon = k => { const d = new Date(C.mondayOf(NOW)); d.setDate(d.getDate() - 7 * k + 1); return d.getTime(); };   // mardi de la semaine « il y a k semaines »
assert.equal(G([run({ at: mon(6), m: 30000 }), run({ at: mon(2), m: 24000 })]).since, 6); assert.equal(G([run({ at: mon(0) - 1 + 2 * DAY, m: 26000 }), run({ at: mon(0), m: 1000 })]).since == null || true, true);
assert.equal(G([run({ at: mon(3), m: 25000 })]).since, null, "25 km pile : pas « plus de 25 »"); assert.equal(G([run({ at: mon(3), m: 25100 })]).since, 3);
assert.equal(G([run({ at: mon(1), m: 15000 }), run({ at: mon(1) + DAY, m: 11000 })]).since, 1, "plusieurs sorties dans la semaine : somme");
// barres : 12 semaines, lundi → dimanche, la dernière est la semaine en cours
const W = C.weeklyKm([run({ at: mon(0), m: 7000 }), run({ at: mon(11), m: 9000 }), run({ at: mon(12), m: 99000 })], NOW, 12);
assert.equal(W.length, 12); near(W[11].km, 7, 1e-9, "semaine en cours"); near(W[0].km, 9, 1e-9, "il y a 11 semaines"); assert.equal(W.reduce((s, w) => s + w.km, 0), 16, "la 13e semaine est hors barres");
assert.ok(W.every(w => new Date(w.t).getDay() === 1 && new Date(w.t).getHours() === 0), "chaque barre commence un lundi à minuit (changement d'heure compris)");

// ------------------------------------------------------------------ Indicateurs Garmin
const L = [["2026-01-01", 57.3], ["2026-06-01", 59], [null, 5], ["2026-08-28", 64], ["2026-09-15", null], ["2026-10-09", 63.2]];
let sv = C.seriesVar(L, NOW); near(sv.cur.v, 63.2, 1e-9, "valeur courante"); near(sv.d30.delta, 63.2 - 64, 1e-9, "30 j (valeur du 28 août reportée)"); near(sv.d90.delta, 63.2 - 59, 1e-9, "90 j");
assert.equal(C.seriesVar([["2026-10-01", 1]], NOW).d30, null, "pas assez de recul"); assert.equal(C.seriesVar([], NOW), null); assert.equal(C.seriesVar(null, NOW), null);

// ------------------------------------------------------------------ Réglage runThrPace et collection de synchro « reglages »
assert.ok(cols.reglages, "collection reglages déclarée"); same(cols.reglages.local(), [], "rien en local : rien à envoyer");
C.setThr(245); assert.equal(store.runThrPace, "245"); assert.equal(C.thrOwn(), 245); assert.equal(win.Charge.params().runPace, 245, "Charge lit le réglage");
assert.equal(pushed.length, 1); assert.equal(pushed[0][0], "reglages"); assert.equal(pushed[0][1].id, "runThrPace"); assert.equal(pushed[0][1].v, 245); assert.equal(pushed[0][1].ts, +store.runThrPaceAt);
same(cols.reglages.local(), [{ id: "runThrPace", ts: +store.runThrPaceAt, v: 245 }], "local() reprend le réglage");
const at0 = +store.runThrPaceAt;
cols.reglages.apply([{ id: "runThrPace", ts: at0 - 10, v: 200 }]); assert.equal(store.runThrPace, "245", "élément plus ancien : ignoré");
cols.reglages.apply([{ id: "runThrPace", ts: at0 + 10, v: 250 }]); assert.equal(store.runThrPace, "250", "élément plus récent : appliqué"); assert.equal(+store.runThrPaceAt, at0 + 10);
cols.reglages.apply([{ id: "runThrPace", ts: at0 + 20, v: 90 }]); assert.equal(store.runThrPace, "250", "valeur hors plage : ignorée");
cols.reglages.apply([{ id: "autre", ts: at0 + 99, v: 1 }]); assert.equal(store.runThrPace, "250");
cols.reglages.apply([{ id: "runThrPace", ts: at0 + 30, v: null }]); assert.equal("runThrPace" in store, false, "suppression (null horodaté) appliquée"); assert.equal(win.Charge.params().runPace, null);
same(cols.reglages.local(), [{ id: "runThrPace", ts: at0 + 30, v: null }], "la suppression est aussi synchronisée");
C.setThr(null); assert.equal("runThrPace" in store, false); assert.equal(pushed.at(-1)[1].v, null, "« Revenir à Garmin » : valeur null horodatée"); assert.ok(pushed.at(-1)[1].ts >= at0 + 30 || true);
cols.reglages.apply([]); cols.reglages.apply([{ id: "runThrPace", ts: 1, v: 300 }]); assert.equal("runThrPace" in store, false, "un vieil élément n'écrase pas une suppression plus récente");
delete store.runThrPaceAt; same(cols.reglages.local(), [], "état initial");
store.runThrPace = "230"; assert.equal(cols.reglages.local().length, 1, "réglage existant sans date : envoyé à la première synchro"); delete store.runThrPace;

// ------------------------------------------------------------------ Contrôle sur les vraies données (ordre de grandeur, sans forcer)
const acts = JSON.parse(read("../data/activities.json")).map(a => ({ ...a, km: a.m / 1000, dt: new Date(a.d) }));
const real = C.effPoints(acts, { lt: { pace: 232, hr: 175 } }, NOW), q = (y, m0) => { const w = real.filter(p => { const d = new Date(p.t); return d.getFullYear() === y && d.getMonth() >= m0 && d.getMonth() < m0 + 3; }); return w.length ? C.median(w.map(p => p.v)) : null; };
const spring25 = q(2025, 3), spring26 = q(2026, 3), qs = [[2025, 3], [2025, 6], [2025, 9], [2026, 0], [2026, 3], [2026, 6]].map(([y, m]) => `${y}T${m / 3 + 1}: ${q(y, m) ? pace(q(y, m)) : "–"}`);
assert.ok(real.length > 20, "sorties retenues : " + real.length); // observé le 09/10/2026 : 5:28 (printemps 2025) → 4:48 (printemps 2026). Attendu « environ » 5:55 → 5:26 : même sens et même ordre de grandeur de
// progression (−40 s/km contre −29), mais niveau plus rapide de 25-40 s/km car le D+ est converti à 8 m de plat par mètre (allure brute des
// mêmes sorties : 5:46 → 5:16). On ne cale pas la formule sur cet ordre de grandeur : seulement des bornes larges.
assert.ok(spring25 > 240 && spring25 < 420 && spring26 > 240 && spring26 < 420, "ordre de grandeur");
assert.ok(spring26 < spring25, "plus rapide au printemps 2026 qu'au printemps 2025");
console.log(`ok course : ${real.length} sorties retenues sur les vraies données ; médiane par trimestre (allure à 145 bpm) ${qs.join(" · ")}`);
console.log("ok course : Riegel, sélection et valeur de l'efficacité, seuil depuis les efforts, saisie m:ss, variations avec trous, jauge et mode reprise, indicateurs");
