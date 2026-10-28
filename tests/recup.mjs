// Tests du score de récupération (recup.js) : charge des 4 jours, récupération Garmin restante à 18 h et plafonds, tendance de la VFC.
// node tests/recup.mjs
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url);
const parseLocal = s => { const [d, t = "00:00:00"] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi, se] = t.split(":").map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0, se || 0); };
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"]);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const nf = (v, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

async function load(acts, rec) {
  const win = { Recup: { data: rec } };
  const ctx = { window: win, S: { all: acts }, RIDE_TYPES: RIDE, parseLocal, nf, console, MONTHS: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    localStorage: { getItem: k => k === "planFtp" ? "230" : null },
    document: { addEventListener() {}, getElementById() { return {}; } }, addEventListener() {}, innerWidth: 1, setInterval() {},
    Nav: { apply() {}, curTab() { return "plan"; } }, fetch: async () => ({ ok: true, json: async () => structuredClone(rec) }) };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(here("../charge.js"), "utf8"), ctx); ctx.Charge = win.Charge;
  vm.runInContext(readFileSync(here("../recup.js"), "utf8"), ctx);
  await win.Recup.ensure("x");
  return win;
}
const ride = (d, mt, w) => ({ id: d, d: d + "T18:00:00", t: "VirtualRide", m: 30000, mt, np: w, w, dt: parseLocal(d + "T18:00:00"), km: 30 });

// ------------------------------------------------------------------ 1) Charge des 4 jours (Charge.fatiguePart)
{
  // 28 jours réguliers (1 h à 70 % de 230 W), puis un gros week-end le 17 et le 18, repos le 19
  const acts = [];
  for (let k = 1; k <= 40; k++) { const t = new Date(2026, 8, 10 + k), d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; if (d < "2026-10-17") acts.push(ride(d, 3600, 161)); }
  acts.push(ride("2026-10-17", 3 * 3600, 184), ride("2026-10-18", 5 * 3600, 184));
  const { Charge } = await load(acts, { days: {} });
  const reg = Charge.fatiguePart(new Date(2026, 9, 16));
  assert.ok(Math.abs(reg.ratio - 1) < .01, "charge régulière : ratio 1");
  const tue = Charge.fatiguePart(new Date(2026, 9, 20)), old = Charge.loadPart(new Date(2026, 9, 20));
  assert.deepEqual([...tue.days].map(Math.round), [0, 320, 192, 49], "J-1 à J-4");
  assert.ok(tue.score < old.score, `le mardi, le gros week-end compte plus qu'avec loadPart (${tue.score} < ${old.score})`);
  assert.equal(Charge.fatiguePart(new Date(2026, 8, 12)), null, "sans historique : rien");
}

// ------------------------------------------------------------------ 2) Récupération Garmin restante et plafonds
{
  const day = (d, recov, wake = "07:00", extra = {}) => ({ d, f: 1, bed: d + "T00:00", wake: `${d}T${wake}`, sl: 8 * 3600, deep: 7200, light: 14400, rem: 7200, awake: 0, recov, ...extra });
  const days = {};
  for (let k = 1; k <= 20; k++) { const d = `2026-09-${String(k).padStart(2, "0")}`; days[d] = day(d, 0, "07:00", { hrv: 90, rhr: 45 }); }
  days["2026-09-21"] = day("2026-09-21", 11 * 60 + 600, "07:00", { hrv: 90, rhr: 45 });   // 21 h au réveil → 10 h à 18 h
  days["2026-09-22"] = day("2026-09-22", 30 * 60, "06:00", { hrv: 90, rhr: 45 });          // 30 h au réveil → 18 h à 18 h
  days["2026-09-23"] = day("2026-09-23", 120, "07:00", { hrv: 90, rhr: 45 });              // récupéré avant 18 h
  days["2026-09-24"] = day("2026-09-24", null, "07:00", { hrv: 90, rhr: 45 });
  const { Recup } = await load([], { days });
  const D = k => Recup.days.find(x => x.d === k), { recovLeft, REC } = Recup._;
  assert.equal(REC.at, 18);
  assert.equal(recovLeft(D("2026-09-21")), 10);
  assert.equal(recovLeft(D("2026-09-22")), 18);
  assert.equal(recovLeft(D("2026-09-23")), 0);
  assert.equal(recovLeft(D("2026-09-24")), null, "sans mesure Garmin : rien");
  const s21 = Recup.recoScore(D("2026-09-21")), s22 = Recup.recoScore(D("2026-09-22")), s23 = Recup.recoScore(D("2026-09-23")), s24 = Recup.recoScore(D("2026-09-24"));
  assert.ok(s23.score >= 80 && s23.score === s23.raw, "récupéré : pas de plafond");
  assert.equal(s21.score, 64, "≥ 6 h restantes : 64 au plus"); assert.ok(s21.raw > 64);
  assert.match(s21.text, /encore ~10 h de récupération à 18 h : score ramené de \d+ à 64/);
  assert.equal(s22.score, 44, "≥ 18 h restantes : 44 au plus, sous le seuil de 45 du Plan");
  assert.match(s22.text, /pas de séance dure aujourd'hui/);
  assert.ok(!s24.parts.some(p => p.key === "recov") && s24.score === s24.raw, "sans mesure : ni composante ni plafond");
}

// ------------------------------------------------------------------ 3) Tendance de la VFC
{
  const mk = (n, f) => { const days = {}; for (let k = 0; k < n; k++) { const t = new Date(2026, 8, 1 + k), d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; days[d] = { d, f: 1, ...f(k) }; } return { days }; };
  const { Recup: A } = await load([], mk(40, k => ({ hrv7: 95, hrvLo: 85, hrvUp: 120 })));
  let t = A._.hrvTrend(A.days);
  assert.equal(t.zone, "in"); assert.equal(t.trend, "stable");
  assert.match(A._.hrvTrendAnswer(t), /95 ms<\/b>, stable sur 4 semaines \(95 → 95\), dans ta zone normale \(85–120 ms\)/);
  const { Recup: B } = await load([], mk(40, k => ({ hrv7: k < 37 ? 100 : 80, hrvLo: 85, hrvUp: 120 })));
  t = B._.hrvTrend(B.days);
  assert.equal(t.zone, "below"); assert.equal(t.below, 3); assert.equal(t.trend, "down");
  assert.match(B._.hrvTrendAnswer(t), /en baisse de 20 ms sur 4 semaines \(100 → 80\), sous ta zone normale \(85–120 ms\) depuis 3 jours/);
  const { Recup: C } = await load([], mk(10, k => ({ hrv7: 130, hrvLo: 85, hrvUp: 120 })));
  t = C._.hrvTrend(C.days);
  assert.equal(t.trend, null, "moins de 4 semaines : pas de tendance"); assert.equal(t.zone, "above");
  assert.ok(!/semaines/.test(C._.hrvTrendAnswer(t)));
  const { Recup: E } = await load([], { days: {} });
  assert.equal(E._.hrvTrend(E.days), null);
}

// ------------------------------------------------------------------ 4) Respiration de la nuit
{
  const mk = (vals, f = () => ({})) => { const days = {}; vals.forEach((v, k) => { const t = new Date(2026, 8, 1 + k), d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; days[d] = { d, f: 1, sl: 8 * 3600, ...(v == null ? {} : { rx: v }), rhr: 45, ...f(k) }; }); return { days }; };
  const base = Array.from({ length: 30 }, (_, k) => 11 + (k % 3) * .2);   // 11,0 · 11,2 · 11,4 : normale 11,2
  const run = async (tail, f) => { const { Recup } = await load([], mk([...base, ...tail], f)); return { R: Recup, t: Recup._.respTrend(Recup.days) }; };
  let { R, t } = await run([11.4]);
  assert.equal(t.level, "ok"); near(t.base.m, 11.2); assert.equal(t.fine, true);
  assert.match(R._.respAnswer(t, true), /11,4 \/min<\/b> cette nuit, dans ta normale \(11,2 \/min/);
  ({ R, t } = await run([12.5]));
  assert.equal(t.level, "watch", "une nuit à +1,3 seule : à surveiller"); assert.match(R._.respAnswer(t, true), /1,3 au-dessus de ta normale \(11,2\) : à surveiller/);
  ({ R, t } = await run([12.5, 12.6]));
  assert.equal(t.level, "alert"); assert.equal(t.streak, 2); assert.match(R._.respAnswer(t, true), /depuis 2 nuits \(<b>12,6 \/min<\/b>/);
  ({ R, t } = await run([12.5], k => k === 30 ? { rhr: 50 } : {}));
  assert.equal(t.level, "alert", "une nuit + cœur au repos +5 bpm"); assert.match(R._.respAnswer(t, true), /avec le cœur au repos 5 bpm plus haut/);
  ({ R, t } = await run([12.5], k => k === 30 ? { hrv: 70, hrvLo: 85 } : {}));
  assert.equal(t.level, "alert"); assert.match(R._.respAnswer(t, true), /la VFC sous sa zone normale/);
  ({ R, t } = await run([11.6], k => k === 30 ? { rhr: 52 } : {}));
  assert.equal(t.level, "ok", "cœur haut mais respiration normale : pas d'alerte respiration");
  ({ R, t } = await run([10]));
  assert.equal(t.level, "low");
  ({ R, t } = await run([12.5, null]));
  assert.equal(t.v, 12.5, "dernière nuit sans mesure : on garde la précédente"); assert.match(R._.respAnswer(t, false), /la nuit du 30 sept\. au 1 oct\./);
  // valeur Garmin arrondie (resp) quand rx manque
  const { Recup: G } = await load([], { days: Object.fromEntries(Object.entries(mk(base).days).map(([k, v]) => [k, { ...v, rx: undefined, resp: 11 }])) });
  t = G._.respTrend(G.days); assert.equal(t.fine, false); assert.match(G._.respAnswer(t, true), /<b>11 \/min<\/b>/);
  const { Recup: F } = await load([], mk(base.slice(0, 10)));
  t = F._.respTrend(F.days); assert.equal(t.level, "nobase"); assert.match(F._.respAnswer(t, true), /Il faut 14 nuits/);
  const { Recup: E } = await load([], { days: {} });
  assert.equal(E._.respTrend(E.days), null); assert.match(E._.respAnswer(null), /Pas encore/);
}

// ------------------------------------------------------------------ 6) Régularité du sommeil et moniteur santé
{
  const ymd = t => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const mk = (n, f = () => ({})) => { const days = {}; for (let k = 0; k < n; k++) { const t = new Date(2026, 8, 1 + k), e = new Date(2026, 8, k), d = ymd(t);
    days[d] = { d, f: 1, sl: 7.75 * 3600, bed: ymd(e) + "T22:00", wake: d + "T05:45", rhr: 45, hrv: 100, hrvLo: 85, hrvUp: 120, rx: 11.2, spo2: 98, sstress: 12, ...f(k, ymd(e), d) }; } return { days }; };
  // mêmes heures chaque soir : 100
  let { Recup: R } = await load([], mk(40));
  let t = R._.sriAt(R.days, R.days.length - 1);
  assert.equal(t.score, 100); assert.match(R._.sriAnswer(t, []), /<b>100\/100<\/b> sur 7 jours, régulier/);
  // une nuit décalée de 4 h (coucher 2 h, lever 9 h 45) : 2 paires sur 7 à 8 h d'écart chacune
  ({ Recup: R } = await load([], mk(40, (k, e, d) => k === 37 ? { bed: d + "T02:00", wake: d + "T09:45" } : {})));
  t = R._.sriAt(R.days, R.days.length - 1);
  assert.equal(t.score, Math.round(200 * (1 - (2 * 480 / 7) / 1440) - 100)); assert.equal(t.worst.d, "2026-10-08");
  assert.match(R._.sriAnswer(t, Array(40).fill(100)), /assez régulier.*19 points en dessous de ta médiane de l'année \(100\)\. Le plus gros écart : la nuit du 7 au 8 oct\., de 02:00 à 09:45 \(d'habitude 22:00 → 05:45\)/);
  // trou de plus d'un jour : pas de paire ; moins de 4 paires = pas de score
  ({ Recup: R } = await load([], mk(40, k => k % 2 ? { bed: undefined, wake: undefined } : {})));
  assert.equal(R._.sriAt(R.days, R.days.length - 1), null); assert.match(R._.sriAnswer(null), /Il faut 4 paires/);
  // moniteur santé : tout normal
  ({ Recup: R } = await load([], mk(40)));
  let h = R._.healthAt(R.days, R.days.length - 1);
  assert.equal(h.bad.length, 0); assert.match(R._.healthAnswer(h, true), /<b>5 mesures sur 5<\/b> dans ta normale cette nuit/);
  // un signal (cœur +4), puis deux (cœur +4 et oxygène −3), cœur plus bas = hors normale mais dans le bon sens
  ({ Recup: R } = await load([], mk(40, k => k === 39 ? { rhr: 49 } : {})));
  h = R._.healthAt(R.days, 39); assert.deepEqual([...h.bad.map(x => x.k)], ["rhr"]); assert.match(R._.healthAnswer(h, true), /<b>1 signal<\/b> hors de ta normale cette nuit : cœur au repos plus haut/);
  ({ Recup: R } = await load([], mk(40, k => k === 39 ? { rhr: 49, spo2: 95 } : {})));
  h = R._.healthAt(R.days, 39); assert.deepEqual([...h.bad.map(x => x.k)], ["rhr", "spo2"]); assert.match(R._.healthAnswer(h, false), /<b>2 signaux<\/b> hors de ta normale cette nuit-là : cœur au repos plus haut et oxygène plus bas\. .*allège/);
  ({ Recup: R } = await load([], mk(40, k => k === 39 ? { rhr: 40, hrv: 125, sstress: 30, rx: 12.5 } : {})));
  h = R._.healthAt(R.days, 39);
  assert.equal(h.rows.find(x => x.k === "rhr").st, "off"); assert.equal(h.rows.find(x => x.k === "hrv").st, "off");
  assert.deepEqual([...h.bad.map(x => x.k)], ["resp", "sstress"], "stress du sommeil > normale + 8, respiration +1,3");
  // historique trop court : pas de normale, pas de signal
  ({ Recup: R } = await load([], mk(5, () => ({ hrvLo: undefined, hrvUp: undefined }))));
  h = R._.healthAt(R.days, 4); assert.equal(h.bad.length, 0); assert.ok(h.rows.every(x => x.st === "nobase")); assert.match(R._.healthAnswer(h, true), /pas encore assez d'historique/);
}

// ------------------------------------------------------------------ 5) Contrôle sur les vraies données : la séance seuil ratée du 20/10/2026
{
  const acts = JSON.parse(readFileSync(here("../data/activities.json"), "utf8")).map(a => ({ ...a, dt: parseLocal(a.d), km: a.m / 1000 }));
  const rec = JSON.parse(readFileSync(here("../data/recovery.json"), "utf8"));
  if (rec.days["2026-10-20"] && rec.days["2026-10-20"].recov === 1234) {
    const { Recup } = await load(acts.filter(a => a.d < "2026-10-20T12"), rec);
    const r = Recup.recoScore(Recup.days.find(x => x.d === "2026-10-20"));
    assert.equal(r.score, 64, "20/10 : 74 avant, 64 maintenant (~9 h de récupération Garmin à 18 h)");
  }
}
console.log("recup : ok");
