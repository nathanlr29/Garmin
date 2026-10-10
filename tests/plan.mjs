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
  vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx);
  if (course) win.Course = course;
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
