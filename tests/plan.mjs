// Test du moteur du Plan (plan.js) : node tests/plan.mjs   (régénérer la référence : node tests/plan.mjs --regen)
// Garde-fou n°1 : sans aucun jour de course, la semaine générée (Plan._gen) et la semaine ajustée (Plan._eff) doivent rester
// IDENTIQUES à tests/plan.ref.json (empreintes), et la génération ne doit pas devenir plus lente.
process.env.TZ = "Europe/Paris";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url), read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const REGEN = process.argv.includes("--regen");
const DAY = 864e5, pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sha = o => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

// ---- Plan.js chargé dans un contexte vm avec de faux objets (date figée, localStorage en mémoire)
function load({ hash = "", acts = [], course = null, extra = {} } = {}) {
  const store = new Map(), clock = { t: new Date(2026, 9, 12, 12, 0, 0).getTime() }, calls = { replace: [], toasts: [] };
  class FD extends Date { constructor(...a) { a.length ? super(...a) : super(clock.t); } static now() { return clock.t; } }
  const win = { Recup: { data: { profile: { ftp: 250 } }, days: [] } };
  const ctx = { window: win, Recup: win.Recup, S: { all: acts }, RIDE_TYPES: RIDE, Date: FD, setTimeout() {}, clearTimeout() {}, innerWidth: 1280, addEventListener() {}, dispatchEvent() {}, HashChangeEvent: class {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } },
    location: { hash, origin: "https://exemple.test", pathname: "/" }, history: { replaceState: (a, b, u) => calls.replace.push(u) },
    Nav: { curTab: () => "velo" }, atob, btoa, isIndoor: a => a.t === "VirtualRide" || a.tr === 1, nf: n => String(n), esc: s => String(s), ...extra };
  vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); ctx.Charge = win.Charge;   // dans le navigateur window est l'objet global
  if (course) { win.Course = course; ctx.Course = course; }
  vm.runInContext(read("../plan.js"), ctx);
  return { Plan: win.Plan, ctx, store, clock, calls, win };
}

// ---- jeu de cas
const MON0 = new Date(2026, 10, 2);                             // lundi 2 novembre 2026 : 8 semaines consécutives
const monday = i => { const d = new Date(MON0); d.setDate(d.getDate() + 7 * i); return d; };
const dayCfg = (bike, dur, muscu) => ({ bike, dur, muscu });
const CFGS = {
  defaut: null,   // config par défaut du moteur (aucune activité, rien en localStorage) : remplie après le premier chargement
  cinq: { v: 2, goal: { ftp: 300, vo2: 65.5, date: "2026-12-31" }, start: "2026-10-05", days: [dayCfg("none", 60, true), dayCfg("mw", 60, true), dayCfg("mw", 75, false), dayCfg("mw", 90, true), dayCfg("none", 60, false), dayCfg("out", 180, true), dayCfg("out", 210, true)] },
  six: { v: 2, goal: { ftp: 280, vo2: 64, date: "2026-11-16" }, start: "2026-10-05", days: [dayCfg("mw", 60, false), dayCfg("mw", 75, true), dayCfg("out", 90, false), dayCfg("mw", 60, true), dayCfg("any", 90, false), dayCfg("any", 120, false), dayCfg("mw", 60, false)] },
  trois: { v: 2, goal: { ftp: 310, vo2: 66, date: "2027-01-31" }, start: "2026-10-19", days: [dayCfg("none", 60, true), dayCfg("any", 60, true), dayCfg("none", 60, true), dayCfg("any", 90, true), dayCfg("none", 60, true), dayCfg("any", 150, true), dayCfg("none", 60, true)] },
};
const SIT = {
  frais: { form: { ctl: 70, atl: 55, tsb: 15, lastHard: 3, km7: 120, h7: 6, n7: 4, c7: 0 }, ready: { today: 82, last: 80, avg3: 78 } },
  fatigue: { form: { ctl: 70, atl: 100, tsb: -30, lastHard: 1, km7: 220, h7: 10, n7: 6, c7: 0 }, ready: { today: 60, last: 60, avg3: 40 } },
  rdy44: { form: { ctl: 70, atl: 70, tsb: 0, lastHard: 2, km7: 150, h7: 7, n7: 5, c7: 0 }, ready: { today: 40, last: 40, avg3: 50 } },
  rdy34: { form: { ctl: 70, atl: 75, tsb: -5, lastHard: 2, km7: 150, h7: 7, n7: 5, c7: 0 }, ready: { today: 30, last: 30, avg3: 35 } },
};
const PREV = [{ legsSun: false, musSun: null, hardSun: false }, { legsSun: true, musSun: "legs", hardSun: true }];
// séances « faites » factices : une clé le lundi, de la muscu, de l'endurance, une sortie longue, un trajet
let aid = 1;
const mk = (mon, di, h, o) => { const dt = new Date(mon); dt.setDate(dt.getDate() + di); dt.setHours(h, 0, 0, 0); return { id: aid++, n: "Séance", t: "Ride", dt, d: `${ymd(dt)}T${pad(h)}:00:00`, mt: 3600, km: 30, np: 0, w: 0, te: 2, hr: 140, ...o }; };
function fakeActs() {
  const out = [];
  for (let i = -1; i < 9; i++) { const m = monday(i);
    out.push(mk(m, 0, 18, { np: 230, w: 220, te: 4 }), mk(m, 1, 7, { t: "strength_training", mt: 3000, km: 0 }), mk(m, 2, 18, { t: "VirtualRide", np: 150, w: 148 }),
      mk(m, 3, 7, { t: "strength_training", mt: 3000, km: 0 }), mk(m, 4, 8, { mt: 900, km: 5 }), mk(m, 5, 9, { mt: 10800, km: 80, np: 170, w: 165, te: 3 })); }
  return out;
}
// instants figés : aperçu (3 j avant), mercredi matin, jeudi soir, dimanche tard, une semaine passée
const NOWS = [[-3, 12], [2, 9], [3, 19], [6, 23], [10, 12]];

function runAll(Plan, clock, store, cfgs, acts) {
  const out = {};
  for (let w = 0; w < 8; w++) for (const [cn, cfg] of Object.entries(cfgs)) for (const [sn, s] of Object.entries(SIT)) {
    const mon = monday(w), key = `${w}|${cn}|${sn}`;
    // génération directe (deux contextes de « semaine d'avant »), sans jours passés puis avec des jours passés figés
    PREV.forEach((prev, pi) => { const g = Plan._gen(mon, cfg, { ...s, prev }); out[`gen|${key}|p${pi}`] = sha(g);
      if (pi === 0) { const f = Plan._gen(mon, cfg, { ...s, prev }, { upto: 3, items: g.items }); out[`genfix|${key}`] = sha(f); } });
    // semaine ajustée : aux instants figés, sans puis avec des séances faites
    for (const withActs of [false, true]) for (const [off, h] of NOWS) {
      store.clear(); const A = withActs ? acts : [];
      clock.t = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + off, h, 0, 0).getTime();
      Plan._setActs(A);
      out[`eff|${key}|${withActs ? "faites" : "rien"}|${off}`] = sha(Plan._eff(mon, cfg, { ...s, prev: PREV[0] }));
    }
  }
  return out;
}

// ---- 1. garde-fou n°1
const H = load({ acts: [] });
const planA = H.Plan;
H.ctx.S.all = [];
CFGS.defaut = JSON.parse(JSON.stringify(planA._cfg()));
// le contexte vm partage S : on remplace simplement le contenu de S.all selon le cas
planA._setActs = A => { H.ctx.S.all = A; };
const acts = fakeActs();
const t0 = performance.now();
const cases = runAll(planA, H.clock, H.store, CFGS, acts);
const tAll = performance.now() - t0;
// types de séance vélo : contenu inchangé
const BIKE = ["vo2", "vo2r", "vo2s", "thr", "ss", "tempo", "end", "long", "longplus", "rec", "test", "testc"];
const PH = [{ wk: 1, deload: false }, { wk: 3, deload: false }, { wk: 4, deload: true }];
BIKE.forEach(t => [45, 75, 120, 210].forEach(d => PH.forEach((ph, i) => { cases[`build|${t}|${d}|${i}`] = sha(planA._build(t, d, ph)); })));
// temps de génération : pire cas des appels directs à _gen (meilleur de 5 essais pour chaque cas)
let worst = 0, worstKey = "";
for (const [cn, cfg] of Object.entries(CFGS)) for (const [sn, s] of Object.entries(SIT)) for (let w = 0; w < 8; w++) {
  let best = Infinity; for (let r = 0; r < 5; r++) { const a = performance.now(); planA._gen(monday(w), cfg, { ...s, prev: PREV[0] }); best = Math.min(best, performance.now() - a); }
  if (best > worst) { worst = best; worstKey = `${w}|${cn}|${sn}`; }
}

const refFile = here("./plan.ref.json");
if (REGEN) {
  writeFileSync(refFile, JSON.stringify({ v: 1, note: "empreintes de Plan._gen / Plan._eff / Plan._build sans jour de course (node tests/plan.mjs --regen, seulement en connaissance de cause)", genMaxMs: +worst.toFixed(3), genMaxKey: worstKey, cases }, null, 1) + "\n");
  console.log(`référence écrite : ${Object.keys(cases).length} cas, _gen pire cas ${worst.toFixed(2)} ms (${worstKey})`);
  process.exit(0);
}
const ref = JSON.parse(readFileSync(refFile, "utf8"));
const bad = Object.keys(ref.cases).filter(k => ref.cases[k] !== cases[k]);
assert.equal(bad.length, 0, `${bad.length} cas différents de la référence, par exemple : ${bad.slice(0, 5).join(", ")}`);
assert.equal(Object.keys(cases).length, Object.keys(ref.cases).length, "même nombre de cas");
assert.ok(worst <= 3 * ref.genMaxMs + 0.5, `_gen trop lent : ${worst.toFixed(2)} ms contre ${ref.genMaxMs} ms en référence (3 × + 0,5 ms de marge de mesure)`);
assert.ok(worst <= 50, "_gen : jamais plus de 50 ms par semaine");

// ---- 2. anciens planCfg et anciens liens #plan= (sans champ course) : chargement sans erreur, même plan
const old = CFGS.cinq, ctxOld = { ...SIT.frais, prev: PREV[0] };
{
  const h = load(); h.store.set("planCfg", JSON.stringify(old));
  same(h.Plan._cfg(), old, "ancien planCfg relu tel quel (aucun champ course ajouté)");
  assert.equal(sha(h.Plan._gen(monday(2), h.Plan._cfg(), ctxOld)), ref.cases[`gen|2|cinq|frais|p0`], "même semaine que la référence avec un ancien planCfg");
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const l = load({ hash: "#plan=" + b64({ c: old, kg: 72, age: "30-39", ftp: 260 }) });
  same(JSON.parse(l.store.get("planCfg")), old, "ancien lien #plan= : même planCfg");
  assert.equal(l.store.get("bwWeight"), "72"); assert.equal(l.store.get("bwAge"), JSON.stringify("30-39")); assert.equal(l.store.get("planFtp"), "260");
  assert.deepEqual(l.calls.replace, ["#plan"], "le lien est effacé de l'adresse");
  assert.equal(sha(l.Plan._gen(monday(2), l.Plan._cfg(), ctxOld)), ref.cases[`gen|2|cinq|frais|p0`], "même plan après import d'un ancien lien");
}

console.log(`ok plan (garde-fou n°1) : ${Object.keys(ref.cases).length} cas identiques à la référence, _gen pire cas ${worst.toFixed(2)} ms (référence ${ref.genMaxMs} ms), ${(tAll / 1000).toFixed(1)} s de calcul`);

// ======================================================================= 3. course (étape 5a)
const P = planA, RUN = P._run, TY = P.TYPES;
const COURSE = { _: { GAUGE: { resumeKm: 15 } } };
const runCtx = (o = {}) => ({ pace: 232, prevMin: 0, resume: false, advice: null, under: 0, ...o });
const FORM = SIT.frais.form;
const cfgRun = (base, runs, runN = 2, runMode = "auto") => ({ ...base, days: base.days.map((d, i) => runs[i] ? { ...d, run: runs[i][0], runDur: runs[i][1] ?? 60 } : { ...d }), runN, runMode });
const it0 = (bike, muscu = null) => ({ bike: bike ? { ...bike } : null, muscu });
const week = specs => specs.map((s, d) => ({ day: d, ...it0(...s) }));
const E60 = { t: "end", dur: 60, place: "mw" }, KEY = { t: "vo2", dur: 60, place: "mw" }, LONG = { t: "long", dur: 210, place: "out" };
const PHN = { deload: false, final: false }, PHD = { deload: true, final: false };
const rcOf = (days, n, mode = "auto") => ({ days: Array.from({ length: 7 }, (_, i) => ({ r: days[i] ? days[i][0] : "none", dur: days[i] ? days[i][1] ?? 60 : 60 })), n, mode });
const place = (items, rc, o = {}) => RUN.place(items, rc, o.ph || PHN, { form: FORM, run: runCtx(o.run) }, o.mon || monday(2), 0);
const free = () => week([[null], [null], [null], [null], [null], [null], [null]]);
const near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y}`);

// ---- 3.1 le cas du cahier des charges : mardi « en plus », jeudi « à la place », dimanche « à la place », 3 courses, auto
{
  const items = week([[null], [E60, "push"], [KEY], [E60, "pull"], [null, "legs"], [{ ...KEY, t: "thr" }, "upper"], [LONG]]);
  const info = place(items, rcOf({ 1: ["add"], 3: ["alt"], 6: ["alt"] }, 3), { run: { prevMin: 200 } });
  assert.equal(info.mode, "entretien"); assert.equal(info.auto, true);
  assert.equal(info.n, 2, "dimanche (sortie longue) est exclu : 2 courses sur 3");
  assert.ok(!items[6].run, "jamais de course le jour de la sortie longue");
  assert.ok(items[1].run && items[1].run.slot === "add" && items[1].run.t === "rfoot", "mardi « en plus » : footing");
  assert.equal(items[1].bike.t, "end", "« en plus » ne remplace rien");
  assert.ok(items[3].run && items[3].run.slot === "alt" && items[3].run.t === "rlong", "la sortie longue ne va que sur un jour « à la place »");
  assert.equal(items[3].bike, null, "jeudi : la séance facile du vélo est remplacée"); assert.equal(items[3].run.rep.t, "end");
  assert.ok(info.notes.some(n => /2 courses au lieu de 3/.test(n) && /2 jours possibles/.test(n)), "une ligne dit pourquoi : " + info.notes.join(" | "));
}
// ---- 3.2 règles de placement
{
  // alt : clé -> pas de course ; facile -> remplacée ; rien -> la course s'y place sans rien remplacer
  const items = week([[KEY], [E60], [null], [LONG], [null], [null], [null]]);
  place(items, rcOf({ 0: ["alt"], 1: ["alt"], 2: ["alt"] }, 3, "reprise"));
  assert.ok(!items[0].run && items[0].bike.t === "vo2", "alt sur une clé : pas de course");
  assert.ok(items[1].run && items[1].bike === null && items[1].run.rep, "alt sur du facile : remplacé");
  assert.ok(items[2].run && !items[2].run.rep && items[2].bike === null, "alt sans vélo : rien à remplacer");
  // add : pas sur une clé ni sur la sortie longue ; jamais le jour de Legs (même pour alt)
  const b = week([[KEY], [LONG], [E60, "legs"], [E60], [null], [null], [null]]);
  place(b, rcOf({ 0: ["add"], 1: ["add"], 2: ["add"], 3: ["add"] }, 4, "reprise"));
  assert.deepEqual(b.map(i => !!i.run), [false, false, false, true, false, false, false], "add : ni clé, ni longue, ni jambes");
  const c = week([[null], [E60, "legs"], [null], [null], [null], [null], [null]]);
  place(c, rcOf({ 1: ["alt"] }, 2)); assert.ok(!c[1].run, "alt le jour de Legs : non");
}
{
  // course dure (progression) : jamais un jour dur, ni la veille/le lendemain d'un jour dur, ni le lendemain de Legs
  let items = free().map((it, d) => d === 0 ? { ...it, ...it0(KEY) } : d === 4 ? { ...it, ...it0(null, "legs") } : d === 6 ? { ...it, ...it0(LONG) } : it);   // jours durs : 0, 4, 6
  let info = place(items, rcOf({ 0: ["alt"], 1: ["alt"], 2: ["alt"], 3: ["alt"], 4: ["alt"], 5: ["alt"] }, 2, "progression"), { run: { prevMin: 90 } });
  const hard = items.filter(i => i.run && TY[i.run.t].hard);
  assert.equal(hard.length, 1); assert.equal(hard[0].day, 2, "la seule place d'une séance dure (1, 3 et 5 touchent un jour dur)"); assert.ok(["rthr", "rvo2"].includes(hard[0].run.t));
  // lendemain de Legs : interdit même s'il n'y a aucun autre jour dur
  items = free().map((it, d) => d === 1 ? { ...it, ...it0(null, "legs") } : it);
  place(items, rcOf({ 2: ["alt"], 4: ["alt"] }, 2, "progression"), { run: { prevMin: 90 } });
  assert.ok(items.filter(i => i.run && TY[i.run.t].hard).every(i => i.day !== 2), "pas de séance dure le lendemain de Legs");
  // aucune séance dure possible : cas normal, le reste de la semaine est placé, une ligne explique
  items = week([[KEY], [E60], [KEY], [E60], [KEY], [E60], [null]]);
  info = place(items, rcOf({ 1: ["alt"], 3: ["alt"], 5: ["alt"] }, 3, "progression"), { run: { prevMin: 90 } });
  assert.equal(items.filter(i => i.run && TY[i.run.t].hard).length, 0, "aucun jour ne convient : pas de séance dure");
  assert.equal(info.n, 3); assert.ok(info.notes.some(n => /Pas de séance dure de course/.test(n)), "ligne explicative : " + info.notes.join("|"));
  // avec de la place, il y en a une et une seule
  items = free(); info = place(items, rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"], 6: ["alt"] }, 4, "progression"), { run: { prevMin: 200 } });
  assert.equal(items.filter(i => i.run && TY[i.run.t].hard).length, 1, "au plus une séance dure par semaine"); assert.equal(items.filter(i => i.run).length, 4);
  // rlong de préférence le week-end
  items = free(); place(items, rcOf({ 1: ["alt"], 3: ["alt"], 5: ["alt"] }, 3, "entretien"));
  assert.equal(items.find(i => i.run && i.run.t === "rlong").day, 5, "sortie longue le samedi quand c'est possible");
  // au plus runN
  items = free(); place(items, rcOf({ 0: ["alt"], 1: ["add"], 2: ["alt"], 3: ["alt"], 4: ["alt"] }, 2, "entretien"));
  assert.equal(items.filter(i => i.run).length, 2);
}
// ---- 3.3 volumes (minutes)
{
  const T = (o, rc = rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"] }, 3, "entretien")) => place(free(), rc, o).T;
  assert.equal(T({ run: { prevMin: 0 } }), 40, "précédent 0 : le minimum (2 × 20 min)");
  assert.equal(T({ run: { prevMin: 0 } }, rcOf({ 0: ["alt"] }, 1, "entretien")), 20, "une seule course : 20 min");
  assert.equal(T({ run: { prevMin: 100 } }), 110, "+10 % sur la semaine d'avant");
  // plafond : haut de la fourchette de la jauge (km/sem.) converti en minutes de footing = km × 1,28 × allure seuil / 60
  assert.equal(T({ run: { prevMin: 100, advice: [8, 10] } }), Math.round(10 * 1.28 * 232 / 60), "plafond de la jauge : 10 km à 1,28 × 3:52 = 49 min");
  assert.equal(T({ run: { prevMin: 100, advice: [8, 40] } }), 110, "plafond au-dessus de +10 % : sans effet");
  assert.equal(T({ run: { prevMin: 100, advice: [1, 2] } }), 40, "le minimum gagne si le plafond est plus bas");
  assert.equal(T({ run: { prevMin: 100, advice: null } }), 110, "advice null : pas de plafond");
  assert.equal(T({ ph: PHD, run: { prevMin: 100 } }), Math.round(110 * RUN.RUN_DELOAD), "semaine allégée : × 0,7");
  // durées : f = T / (n + 0,25), rlong = 1,25 f, arrondis à 5 min, bornés par runDur, total au plus T
  let items = free(); place(items, rcOf({ 0: ["alt", 120], 2: ["alt", 120], 4: ["alt", 120] }, 3, "entretien"), { run: { prevMin: 200 } });   // T = 220, f = 67,7
  const du = items.filter(i => i.run).map(i => [i.run.t, i.run.dur]);
  assert.deepEqual(du.map(x => x[0]).sort(), ["rfoot", "rfoot", "rlong"]);
  assert.equal(du.find(x => x[0] === "rlong")[1], 80, "1,25 × 67,7 = 85, rognée à 80 parce que le total (225) dépasse la cible (220)");
  assert.deepEqual(du.filter(x => x[0] === "rfoot").map(x => x[1]), [70, 70]); assert.equal(du.reduce((a, x) => a + x[1], 0), 220, "le total reste sous la cible");
  items = free(); place(items, rcOf({ 0: ["alt", 45], 2: ["alt", 45], 4: ["alt", 45] }, 3, "entretien"), { run: { prevMin: 200 } });
  assert.ok(items.filter(i => i.run).every(i => i.run.dur <= 45), "bornées par runDur du jour");
  // volume trop bas pour 4 séances de 20 min minimum
  items = free(); let inf = place(items, rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"], 5: ["alt"] }, 4, "entretien"), { run: { prevMin: 52 } });   // T = 57,2
  assert.equal(items.filter(i => i.run).length, 2); assert.ok(inf.notes.some(n => /volume trop bas/.test(n)), inf.notes.join("|")); assert.ok(items.filter(i => i.run).every(i => i.run.dur >= 20));
  items = free(); place(items, rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"] }, 3, "reprise"), { run: { prevMin: 0 } });
  assert.ok(items.filter(i => i.run).length === 2 && items.filter(i => i.run).every(i => i.run.dur === 20), "T = 40 : deux footings de 20 min");
}
// ---- 3.4 modes
{
  const rc4 = mode => rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"], 6: ["alt"] }, 3, mode);
  let items = free(), info = place(items, rc4("auto"), { run: { resume: true, prevMin: 100 } });
  assert.equal(info.mode, "reprise"); assert.ok(items.filter(i => i.run).every(i => i.run.t === "rfoot"), "reprise : footings seulement");
  items = free(); info = place(items, rc4("auto"), { run: { resume: false, prevMin: 100 } });
  assert.equal(info.mode, "entretien"); assert.deepEqual(items.filter(i => i.run).map(i => i.run.t).sort(), ["rfoot", "rfoot", "rlong"]);
  items = free(); info = place(items, rc4("entretien"), { run: { resume: true } }); assert.equal(info.mode, "entretien", "un mode choisi bat « auto »"); assert.equal(info.auto, false);
  // lignes droites : au plus 1 par semaine, à partir de la 3e semaine de reprise
  for (const [under, n] of [[0, 0], [1, 0], [2, 1], [5, 1]]) { items = free(); place(items, rc4("reprise"), { run: { under, prevMin: 100 } }); assert.equal(items.filter(i => i.run && i.run.t === "rstrides").length, n, `reprise, ${under} semaine(s) sous le seuil avant`); }
  // progression : au plus 1 séance dure, en alternance d'une semaine à l'autre
  const kinds = [];
  for (let w = 0; w < 4; w++) { items = free(); place(items, rc4("progression"), { mon: monday(w), run: { prevMin: 100 } });
    const h = items.filter(i => i.run && TY[i.run.t].hard); assert.ok(h.length <= 1); kinds.push(h[0] ? h[0].run.t : "-"); }
  assert.ok(kinds.every(k => k !== "-") && kinds.every((k, i) => !i || k !== kinds[i - 1]), "rthr / rvo2 en alternance : " + kinds);
  items = free(); place(items, rc4("progression"), { ph: PHD, run: { prevMin: 100 } }); assert.equal(items.filter(i => i.run && TY[i.run.t].hard).length, 0, "décharge : pas de séance dure");
}
// ---- 3.5 charge de la semaine : la course est réduite d'abord
{
  const items = week([[null], [{ t: "thr", dur: 120, place: "mw" }], [null], [{ t: "vo2", dur: 120, place: "mw" }], [null], [{ t: "ss", dur: 120, place: "mw" }], [null]]);
  const info = RUN.place(items, rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"] }, 3, "entretien"), PHN, { form: { ...FORM, ctl: 30, tsb: 0 }, run: runCtx({ prevMin: 300 }) }, monday(2), 0);   // fourchette basse : 7 × 35
  assert.ok(info.notes.some(n => /réduit/.test(n)), "course réduite : " + info.notes.join("|"));
  assert.ok(info.notes.some(n => /au minimum/.test(n)), "le vélo dépasse déjà seul la fourchette : on le dit");
  assert.equal(items.filter(i => i.run).length, 3, "on réduit les durées, on ne supprime pas de séance"); assert.ok(items.filter(i => i.run).every(i => i.run.dur === 20), "courses au plancher de 20 min");
  // fourchette large : rien n'est réduit
  const items2 = week([[null], [E60], [null], [E60], [null], [null], [null]]);
  const i2 = RUN.place(items2, rcOf({ 0: ["alt"], 2: ["alt"], 4: ["alt"] }, 3, "entretien"), PHN, { form: FORM, run: runCtx({ prevMin: 120 }) }, monday(2), 0);
  assert.ok(!i2.notes.some(n => /réduit/.test(n)));
}
// ---- 3.6 types : couleurs propres, durs, charge, allures
{
  const R6 = ["rfoot", "rstrides", "rlong", "rtempo", "rthr", "rvo2"], bikeCol = new Set(Object.values(TY).filter(t => !t.sport).map(t => t.c));
  R6.forEach(t => { assert.equal(TY[t].sport, "run"); assert.ok(!bikeCol.has(TY[t].c), `couleur propre : ${t}`); assert.equal(P.isKey(t), false, "jamais une séance clé vélo"); });
  assert.deepEqual(R6.filter(t => TY[t].hard), ["rthr", "rvo2"]);
  const thr = 240, W = Object.fromEntries(R6.map(t => [t, RUN.build(t, 60, thr)]));
  R6.forEach(t => { assert.equal(W[t].tss, Math.round(RUN.RUN_IF[t] ** 2 * 100), `charge de ${t} = h × IF² × 100`); assert.ok(W[t].title && W[t].goal && W[t].km > 5); assert.ok(W[t].steps.reduce((a, s) => a + s.d, 0) <= 3601); });
  assert.deepEqual(Object.values(RUN.RUN_IF), [.65, .68, .7, .88, .97, 1.08]);
  near(W.rfoot.steps[1].pace, thr * 1.28, 1e-9, "footing = 1,28 × l'allure seuil");
  const mainPace = t => W[t].steps.find(s => s.n || /Footing|Sortie/.test(s.label)).pace, v = p => thr / p;
  assert.ok(v(mainPace("rtempo")) >= .88 && v(mainPace("rtempo")) < .95, "tempo en zone 3");
  assert.ok(v(mainPace("rthr")) >= .95 && v(mainPace("rthr")) <= 1.02, "seuil en zone 4"); assert.ok(v(mainPace("rvo2")) > 1.02, "VO2max en zone 5");
  assert.ok(v(mainPace("rlong")) < v(mainPace("rfoot")), "sortie longue plus lente que le footing");
  assert.match(W.rthr.title, /^Seuil \d × 8'$/); assert.match(W.rvo2.title, /^VO2max \d × 3'$/); assert.equal(RUN.build("rfoot", 20, thr).steps.reduce((a, s) => a + s.d, 0), 1200);
  assert.ok(W.rstrides.steps.some(s => s.n === 6 && s.on === 20), "6 lignes droites");
}
// ---- 3.7 génération complète : le vélo et la muscu ne changent pas ; invariants sur beaucoup de réglages
{
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let nRuns = 0, nCases = 0, tMax = 0;
  for (let k = 0; k < 400; k++) {
    const base = [CFGS.defaut, CFGS.cinq, CFGS.six, CFGS.trois][k % 4], runs = {}, pick = ["none", "alt", "add"];
    for (let d = 0; d < 7; d++) { const r = pick[Math.floor(rnd() * 3)]; if (r !== "none") runs[d] = [r, [20, 30, 45, 60, 90, 120][Math.floor(rnd() * 6)]]; }
    const runN = 1 + Math.floor(rnd() * 4), mode = ["auto", "reprise", "entretien", "progression"][Math.floor(rnd() * 4)], c = cfgRun(base, runs, runN, mode), mon = monday(k % 8), rcfg = RUN.cfg(c);
    const sit = Object.values(SIT)[k % 4], o = { ...sit, prev: PREV[k % 2], run: runCtx({ prevMin: [0, 40, 90, 200][k % 4], resume: k % 3 === 0, under: k % 5, advice: k % 2 ? [20, 30] : null }) };
    const a = performance.now(), g = P._gen(mon, c, o); tMax = Math.max(tMax, performance.now() - a);
    const g0 = P._gen(mon, base, { ...sit, prev: PREV[k % 2] });   // même semaine sans course
    nCases++;
    g.items.forEach((it, d) => {
      const r = it.run, b0 = g0.items[d].bike;
      assert.equal(JSON.stringify(it.muscu), JSON.stringify(g0.items[d].muscu), "la muscu ne bouge jamais");
      if (!r) { assert.equal(JSON.stringify(it.bike), JSON.stringify(b0), "sans course ce jour-là, le vélo est identique"); return; }
      nRuns++;
      const x = rcfg.days[d];
      assert.notEqual(x.r, "none", "course seulement un jour réglé");
      assert.ok(!(b0 && (TY[b0.t].hard || b0.t === "long" || b0.t === "longplus")), "jamais sur une clé, une longue ni un test");
      assert.notEqual(it.muscu, "legs", "jamais le jour de Legs");
      assert.ok(r.dur >= 20 && r.dur <= x.dur, `durée de ${r.t} : ${r.dur} / ${x.dur}`);
      if (x.r === "add") { assert.ok(["rfoot", "rstrides"].includes(r.t), "« en plus » : footing seulement (lignes droites comprises)"); assert.equal(JSON.stringify(it.bike), JSON.stringify(b0), "« en plus » ne remplace rien"); assert.equal(r.slot, "add"); }
      else { assert.equal(it.bike, null, "« à la place » : le vélo du jour est parti"); if (b0) assert.equal(r.rep.t, b0.t); else assert.ok(!r.rep); }
      if (TY[r.t].hard) {
        for (const e of [d - 1, d + 1]) { const n = g.items[e]; if (!n) continue; const nb = g0.items[e].bike; assert.ok(!(n.muscu === "legs" || (nb && (TY[nb.t].hard || nb.t === "long")) || (n.run && TY[n.run.t].hard)), `séance dure collée à un jour dur (${d}/${e})`); }
        assert.ok(!g.ph.deload, "pas de séance dure en décharge"); }
      if (r.t === "rlong") assert.equal(r.slot, "alt");
    });
    const nR = g.items.filter(i => i.run).length; assert.ok(nR <= runN, "au plus runN courses"); assert.equal(g.run.n, nR);
    assert.ok(g.items.filter(i => i.run && TY[i.run.t].hard).length <= 1);
  }
  assert.ok(nRuns > 300, "le jeu de cas place vraiment des courses : " + nRuns); assert.ok(tMax <= 50, `_gen avec courses : ${tMax.toFixed(1)} ms`);
  console.log(`ok plan (course) : ${nCases} semaines générées, ${nRuns} courses placées, règles de placement vérifiées, _gen avec courses ${tMax.toFixed(1)} ms au pire`);
}
// ---- 3.8 réglages : appliqués à partir du lundi suivant, semaine en cours jamais modifiée
{
  const h = load({ acts: [{ id: 1, n: "Footing", t: "running", dt: new Date(2026, 9, 1, 18), d: "2026-10-01T18:00:00", mt: 1800, km: 5 }], course: COURSE }), RUN = h.Plan._run; h.store.set("planCfg", JSON.stringify(CFGS.cinq));   // RUN : celui de CE chargement (son localStorage, son horloge)
  h.clock.t = new Date(2026, 10, 4, 10, 0, 0).getTime();   // mercredi 4 novembre
  const cur = new Date(2026, 10, 2), next = new Date(2026, 10, 9), ctx = { ...SIT.frais, prev: PREV[0] }, E = (mon, c, o = {}) => h.Plan._eff(mon, c, { ...ctx, rc: RUN.rcFor(mon), ...o });
  const before = sha(E(cur, h.Plan._cfg()));
  const c = cfgRun(CFGS.cinq, { 0: ["alt", 45], 1: ["add", 45], 4: ["alt", 60] }, 3, "auto"); h.store.set("planCfg", JSON.stringify(c)); RUN.setRc(c);
  assert.equal(RUN.rcFor(cur), null, "la semaine en cours n'est pas concernée"); assert.ok(RUN.rcFor(next), "la semaine suivante l'est");
  assert.equal(sha(E(cur, c)), before, "semaine en cours identique");
  const W = E(next, c, { run: runCtx({ prevMin: 60 }) });
  assert.ok(W.items.some(i => i.run) && W.runInfo, "la semaine suivante porte des courses");
  // tout enlever : de nouveau rien à partir du lundi suivant ; remettre deux fois : pas de doublon
  RUN.setRc(cfgRun(CFGS.cinq, {}, 3, "auto")); assert.equal(RUN.rcFor(next), null);
  RUN.setRc(c); RUN.setRc(c); assert.equal(JSON.parse(h.store.get("planRc")).length, 1, "pas de doublon dans l'historique");
  // une semaine déjà figée n'est pas régénérée par un changement de réglages course
  h.store.delete("planWk:2026-11-02"); E(cur, c); const frozen = h.store.get("planWk:2026-11-02"); assert.ok(frozen, "la semaine en cours est figée"); const c2 = cfgRun(CFGS.cinq, { 2: ["alt"] }, 1, "reprise"); RUN.setRc(c2);
  E(cur, c2); assert.equal(h.store.get("planWk:2026-11-02"), frozen, "planWk figé : jamais régénéré par un changement de réglages course");
  assert.equal(RUN.cfg(CFGS.cinq), null, "champ course absent = aucune course");
  // activités pas encore chargées (au démarrage sur l'onglet Plan) : la semaine en cours n'est pas figée avec une forme et un volume calculés à vide
  const e = load({ acts: [], course: COURSE }); e.clock.t = new Date(2026, 10, 4, 10, 0, 0).getTime(); e.Plan._eff(cur, CFGS.cinq, { ...ctx, rc: null });
  assert.equal(e.store.has("planWk:2026-11-02"), false, "rien n'est figé tant que les activités ne sont pas là");
}
// ---- 3.9 courses faites : rattachées au jour, « extra » sinon
{
  const mkr = (d, h) => ({ id: 900 + d, n: "Footing", t: "running", dt: new Date(2026, 10, 2 + d, h, 0, 0), d: `2026-11-0${2 + d}T${pad(h)}:00:00`, mt: 2700, km: 8, hr: 140 });
  const h = load({ acts: [mkr(1, 18), mkr(3, 12)], course: COURSE });   // mardi 18 h, jeudi 12 h
  h.clock.t = new Date(2026, 10, 6, 21, 0, 0).getTime();   // vendredi soir
  const c = cfgRun(CFGS.cinq, { 0: ["alt"], 1: ["alt"], 3: ["add"], 4: ["alt"] }, 4, "entretien"), mon = new Date(2026, 10, 2);
  const W = h.Plan._eff(mon, c, { ...SIT.frais, prev: PREV[0], rc: RUN.cfg(c), run: runCtx({ prevMin: 200 }) });
  assert.equal(W.td, 4); let nPlanned = 0;
  W.items.forEach(it => { if (!it.run) return; nPlanned++; const done = [1, 3].includes(it.day); assert.equal(it.run.st, done ? "done" : it.day < W.td ? "missed" : "plan", `jour ${it.day}`); if (done) assert.equal(it.run.acts[0].id, 900 + it.day); });
  assert.ok(nPlanned >= 2);
  [1, 3].filter(d => !W.items[d].run).forEach(d => assert.equal(W.items[d].extra.some(a => a.id === 900 + d), true, "course faite non prévue = extra"));
  // sans aucun réglage course, une course faite apparaît quand même comme « extra » (comme le vélo)
  h.store.clear(); const W0 = h.Plan._eff(mon, CFGS.cinq, { ...SIT.frais, prev: PREV[0] });
  assert.ok(W0.items[1].extra.some(a => a.id === 901) && W0.items[3].extra.some(a => a.id === 903) && W0.items.every(i => !i.run));
}
// ---- 3.10 liens #plan= : tout est validé, rien de dangereux n'entre
{
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const evil = '<img src=x onerror=alert(1)>';
  const bad = { c: { v: 9, goal: { ftp: evil, vo2: "70", date: evil }, start: evil, days: CFGS.cinq.days.map((d, i) => ({ bike: i ? d.bike : evil, dur: i === 1 ? evil : d.dur, muscu: d.muscu, run: i === 2 ? evil : i === 3 ? "alt" : undefined, runDur: i === 3 ? 9999 : evil, extra: evil })), runN: 99, runMode: evil, junk: evil }, kg: evil, age: evil, ftp: 9999 };
  const l = load({ hash: "#plan=" + b64(bad), course: COURSE });
  const all = [...l.store.entries()].map(([k, v]) => k + "=" + v).join("\n");
  assert.ok(!/[<>]|onerror|junk/.test(all), "aucune valeur du lien ne reste : " + all.slice(0, 300));
  assert.equal(l.store.get("bwAge"), undefined, "âge hors liste : rejeté"); assert.equal(l.store.get("bwWeight"), undefined); assert.equal(l.store.get("planFtp"), undefined);
  const c = JSON.parse(l.store.get("planCfg"));
  assert.equal(c.days.length, 7); assert.equal(c.days[0].bike, "none"); assert.equal(c.days[1].dur, 60); assert.equal(c.days[2].run, undefined); assert.equal(c.days[3].run, "alt"); assert.equal(c.days[3].runDur, 120, "runDur borné");
  assert.equal(c.runN, 4, "runN borné"); assert.equal(c.runMode, undefined); assert.equal(c.start, "2026-10-05"); assert.deepEqual(c.goal, {}, "objectif invalide ignoré");
  assert.equal(c.days[0].extra, undefined); assert.deepEqual(Object.keys(c).sort(), ["days", "goal", "runN", "start", "v"]);
  // valeurs valides : acceptées telles quelles, champs course compris
  const good = { c: cfgRun(CFGS.six, { 1: ["add", 45], 3: ["alt", 75] }, 3, "progression"), kg: 71.5, age: "40-49", ftp: 265 };
  const g = load({ hash: "#plan=" + b64(good), course: COURSE });
  same(JSON.parse(g.store.get("planCfg")), good.c, "lien valide : planCfg identique, champs course compris"); assert.equal(g.store.get("bwWeight"), "71.5"); assert.equal(g.store.get("bwAge"), '"40-49"'); assert.equal(g.store.get("planFtp"), "265");
  assert.ok(g.store.get("planRc"), "les réglages course importés valent à partir du lundi suivant");
  // nombres hors bornes, clés héritées
  const one = o => load({ hash: "#plan=" + b64(o), course: COURSE }).store;
  assert.equal(one({ kg: 20 }).get("bwWeight"), undefined); assert.equal(one({ kg: 200 }).get("bwWeight"), undefined); assert.equal(one({ kg: "80" }).get("bwWeight"), undefined); assert.equal(one({ ftp: 50 }).get("planFtp"), undefined);
  assert.equal(one({ age: "constructor" }).get("bwAge"), undefined, "âge « constructor » rejeté (pas de clé héritée)"); assert.equal(one({ age: "<30" }).get("bwAge"), '"<30"', "« <30 » est dans la liste (affiché échappé)");
}
// ---- 3.11 jauge de reprise et plannedFor
{
  const mon = (m, d) => new Date(2026, m, d).getTime();
  const gauge = () => ({ resume: true, chronic: 8, advice: [6.4, 10.4], weeks: [{ t: mon(9, 12), km: 3 }, { t: mon(9, 19), km: 5 }, { t: mon(9, 26), km: 20 }, { t: mon(10, 2), km: 4 }, { t: mon(10, 9), km: 6 }] });
  const h = load({ acts: [], course: { _: { GAUGE: { resumeKm: 15 }, gauge } } });
  const rc = RUN_(h).ctx(new Date(2026, 10, 16));
  assert.equal(rc.resume, true); assert.deepEqual(rc.advice, [6.4, 10.4]); assert.equal(rc.under, 2, "semaines consécutives sous 15 km avant la semaine visée (la semaine à 20 km coupe)");
  assert.equal(RUN_(h).ctx(new Date(2026, 9, 26)).under, 2, "deux semaines sous le seuil avant le 26/10");
  const r2 = RUN_(load({ acts: [] })).ctx(new Date(2026, 10, 2)); assert.equal(r2.resume, false); assert.equal(r2.advice, null); assert.equal(r2.pace, 300, "allure seuil de repli");
  function RUN_(x) { return x.Plan._run; }
  // plannedFor : course seule, vélo seul, les deux
  const c = cfgRun(CFGS.cinq, { 0: ["alt"], 2: ["add"], 4: ["add"] }, 3, "entretien"); h.store.set("planCfg", JSON.stringify(c)); h.store.set("planSince", '"2026-10-01"');
  h.clock.t = new Date(2026, 10, 1, 12, 0, 0).getTime(); RUN_(h).setRc(c);   // dimanche : valable dès le lundi 2 novembre
  h.clock.t = new Date(2026, 10, 3, 12, 0, 0).getTime();
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => { const k = `2026-11-0${2 + d}`; return { d, any: h.Plan.plannedFor(k), run: h.Plan.plannedFor(k, "run"), bike: h.Plan.plannedFor(k, "bike") }; });
  assert.ok(days.some(x => x.run), "plannedFor(…, 'run') renvoie la course du jour");
  days.forEach(x => { assert.equal(!!x.run, !!(x.any && (x.any.sport === "run" || x.any.run)), "plannedFor sans argument voit aussi la course"); if (x.bike) assert.notEqual(x.bike.sport, "run"); });
  const runOnly = days.find(x => x.run && !x.bike); assert.ok(runOnly, "un jour avec course seule"); assert.equal(runOnly.any.sport, "run"); assert.equal(P.isKey(runOnly.any.t), false); assert.ok(runOnly.any.w && runOnly.any.label);
  const both = days.find(x => x.run && x.bike); if (both) assert.ok(both.any.run && both.any.t === both.bike.t, "vélo + course le même jour : la course est dans `.run`");
}
console.log("ok plan (course) : modes, volumes, plafonds, placement, liens validés, réglages à partir du lundi suivant, courses faites");
