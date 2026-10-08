"use strict";
// Onglet « Plan » : un objectif, tes disponibilités, et une semaine vélo + muscu construite automatiquement
// puis réajustée chaque jour (séance ratée, récupération basse, séance faite un autre jour), avec « Annuler ».
// La muscu (Push, Pull, Legs, Upper, le matin) est seulement placée : son contenu reste celui de ton programme.
(() => {
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t; };
const mondayOf = d => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() - (t.getDay() + 6) % 7); return t; };
const dayIndex = (d, mon) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - mon) / 864e5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + pad(m % 60) : ""}` : `${m} min`;
const W5 = v => Math.round(v / 5) * 5;
const store2 = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const dShort = d => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

const GOAL0 = { ftp: 300, vo2: 65.5, date: "2026-12-31" };
const START0 = "2026-10-05";  // lundi : début du premier bloc
const DAYN = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const dl = d => DAYN[d].toLowerCase();
const DURS = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 270, 300];
const TYPES = {
  vo2: { l: "VO2max", c: "#d6336c", hard: 1 },
  vo2r: { l: "VO2max 30/15", c: "#a61e4d", hard: 1 },
  vo2s: { l: "VO2max 30/30", c: "#c2255c", hard: 1 },
  thr: { l: "Seuil", c: "#e8501c", hard: 1 },
  ss: { l: "Sweet spot", c: "#f08c00", hard: 1 },
  tempo: { l: "Tempo", c: "#e0a800" },
  end: { l: "Endurance", c: "#2f9e44" },
  long: { l: "Sortie longue", c: "#1c7ed6" },
  longplus: { l: "Longue + seuil", c: "#1864ab", hard: 1 },
  rec: { l: "Récupération", c: "#868e96" },
  test: { l: "Test FTP", c: "#7048e8", hard: 1 },
  testc: { l: "Test court", c: "#5f3dc4", hard: 1 },
};
const isKey = t => !!(t && TYPES[t] && TYPES[t].hard && t !== "longplus");
const isLong = t => t === "long" || t === "longplus";
// séances clés selon le bloc (0 = dernier bloc avant l'objectif … 3 = base)
const POOLS = [["vo2", "thr", "vo2r"], ["vo2r", "ss", "vo2"], ["thr", "vo2r", "ss"], ["ss", "thr", "tempo"]];
const MUSCU = { push: { l: "Push", d: "pecs, épaules, triceps" }, pull: { l: "Pull", d: "dos, biceps" }, legs: { l: "Legs", d: "jambes" }, upper: { l: "Upper", d: "haut du corps" } };
const MORDER = ["push", "pull", "legs", "upper"];  // ordre du programme ; avec moins de 4 matins on garde les premières
const ZONES = [[.56, "Z1", "#a5b1bd"], [.76, "Z2", "#4aa3df"], [.88, "Z3", "#2fb380"], [1.05, "Z4", "#f2b134"], [1.2, "Z5", "#ef6c3a"], [9, "Z6", "#d6336c"]];
const zoneOf = f => ZONES.findIndex(z => f < z[0]);
const RPE = ["2/10, très facile", "3-4/10, conversation facile", "5-6/10, soutenu", "7/10, dur mais tenable", "8-9/10, très dur", "9-10/10, maximal"];

// ------------------------------------------------------------------ Données
const rides = () => (S.all || []).filter(a => RIDE_TYPES.has(a.t));
const isTraining = a => a.mt >= 1200;  // les trajets du quotidien (moins de 20 min) ne comptent pas comme séances
const isMuscu = a => a.t === "strength_training";
function profile() {
  const p = (window.Recup && Recup.data && Recup.data.profile) || {};
  const own = store2.get("planFtp");
  const est = estimateFtp(), det = detectFtp(), auto = Math.max(p.ftp || 0, det ? det.ftp : 0);
  const ftp = own || auto || est || 250;
  const ftpSrc = own ? "saisie" : det && det.ftp > (p.ftp || 0) ? `détectée : ${det.l} à ${det.w} W le ${dShort(det.a.dt)}` : p.ftp ? `Garmin${p.ftpDate ? " · " + dShort(new Date(p.ftpDate)) : ""}` : est ? "estimée sur tes séances" : "par défaut";
  return { ...p, ftp, ftpSrc, est, det, auto };
}
// FTP détectée : meilleures puissances Garmin des 60 derniers jours (20 min × 95 %, 1 h, 5 min × 78 %, test rampe : 1 min × 75 %)
const isRamp = a => /ramp/i.test(a.n || "") && /test/i.test(a.n || "");
function detectFtp() {
  const cut = addDays(new Date(), -60); let best = null;
  rides().filter(a => a.dt >= cut && a.pc).forEach(a => {
    const R = [["1200", .95, "20 min"], ["3600", 1, "1 h"], ["300", .78, "5 min"]];
    if (isRamp(a)) R.push(["60", RAMP_F, "test rampe (meilleure minute)"]);
    R.forEach(([d, f, l]) => { const w = a.pc[d]; if (w && (!best || w * f > best.ftp)) best = { ftp: Math.round(w * f), w, l, a }; });
  });
  return best;
}
function estimateFtp() { // meilleure puissance normalisée sur 40 min et plus, ces 90 derniers jours
  const cut = addDays(new Date(), -90);
  const c = rides().filter(a => a.dt >= cut && (a.np || a.w) && a.mt >= 2400).map(a => (a.np || a.w) * (a.mt >= 3600 ? .97 : .93));
  return c.length ? W5(Math.max(...c)) : null;
}
// Charge d'une activité en TSS : puissance si on l'a (home trainer), sinon fréquence cardiaque rapportée au seuil
function tssOf(a) {
  const p = (window.Recup && Recup.data && Recup.data.profile) || {}, ftp = store2.get("planFtp") || p.ftp || 250, lthr = (p.hrZones && p.hrZones.lthr) || 165;
  const h = (a.mt || 0) / 3600; if (!h) return 0;
  const pw = a.np || a.w, IF = pw > 0 && RIDE_TYPES.has(a.t) ? pw / ftp : a.hr > 0 ? a.hr / lthr : .65;
  return h * clamp(IF, .4, 1.2) ** 2 * 100;
}
function dayLoads() { const m = {}; (S.all || []).forEach(a => { const k = a.d.slice(0, 10); m[k] = (m[k] || 0) + tssOf(a); }); return m; }
function fitness() {
  const m = dayLoads(), today = new Date(); let ctl = 0, atl = 0;
  for (let d = addDays(today, -120); d < today; d = addDays(d, 1)) { const l = m[ymd(d)] || 0; ctl += (l - ctl) / 42; atl += (l - atl) / 7; }
  const p = profile();
  const hard = rides().filter(a => a.te >= 3.8 || ((a.np || a.w) && (a.np || a.w) / p.ftp >= .85 && a.mt >= 1500)).pop();
  const wk = rides().filter(a => a.dt >= addDays(today, -7)), tr = wk.filter(isTraining);
  return { ctl, atl, tsb: ctl - atl, lastHard: hard ? Math.floor((today - hard.dt) / 864e5) : null, km7: wk.reduce((s, a) => s + a.km, 0), h7: wk.reduce((s, a) => s + a.mt, 0) / 3600, n7: tr.length, c7: wk.length - tr.length };
}
function readiness() {
  const k = ymd(new Date()), days = ((window.Recup && Recup.days) || []).filter(d => (d.sl || d.tr != null) && d.d <= k), last = days.slice(-3);
  const sc = last.map(d => Recup.recoScore(d).score).filter(v => v != null);
  const td = days.length && days[days.length - 1].d === k ? Recup.recoScore(days[days.length - 1]).score : null;  // score du matin seulement s'il est d'aujourd'hui
  return { today: td ?? null, last: sc.length ? sc[sc.length - 1] : null, avg3: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null };
}
// séance intense (hors sortie longue) : sert à compter les séances clés réellement faites
function hardRide(a, ftp) {
  if (!RIDE_TYPES.has(a.t) || a.mt < 1200 || a.mt >= 150 * 60) return false;
  const pw = a.np || a.w, IF = pw > 0 ? pw / ftp : 0, pc = a.pc || {};
  return a.te >= 3.5 || (IF >= .82 && a.mt >= 1500) || (pc["300"] || 0) >= 1.05 * ftp || (pc["1200"] || 0) >= .9 * ftp;
}
function habits() {
  const cut = addDays(new Date(), -56), R = rides().filter(a => a.dt >= cut && isTraining(a));
  const by = Array.from({ length: 7 }, () => ({ n: 0, inn: 0, mins: [] }));
  R.forEach(a => { const w = (a.dt.getDay() + 6) % 7; by[w].n++; if (isIndoor(a)) by[w].inn++; by[w].mins.push(a.mt / 60); });
  const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 60; };
  return { perWeek: R.length / 8, by: by.map(b => ({ n: b.n, indoor: b.n ? b.inn / b.n : .5, dur: med(b.mins) })) };
}

// ------------------------------------------------------------------ Réglages : objectif et disponibilités
function habitSets() {  // jours vélo déduits de tes 8 dernières semaines
  const h = habits();
  const order = h.by.map((b, i) => ({ i, n: b.n })).sort((a, b) => b.n - a.n);
  const count = h.perWeek >= 1 ? clamp(Math.round(h.perWeek), 2, 6) : 3;
  const days = order.filter(o => o.n > 0).slice(0, count).map(o => o.i);
  if (days.length < count) [1, 3, 5, 6, 2, 0, 4].forEach(d => { if (days.length < count && !days.includes(d)) days.push(d); });
  return days.sort((a, b) => a - b).map(d => { const b = h.by[d], out = d >= 5 && b.indoor < .6; let dur = DURS.reduce((a, x) => Math.abs(x - b.dur) < Math.abs(a - b.dur) ? x : a, 60);
    if (!b.n) dur = d >= 5 ? 180 : 60; return { day: d, dur: clamp(dur, 45, out ? 300 : 120), place: out || b.indoor < .4 ? "out" : "mw" }; });
}
function defaultCfg() {
  const sets = store2.get("planSets") || habitSets();  // on reprend les jours de l'ancienne version de l'onglet
  const days = Array.from({ length: 7 }, (_, d) => { const s = sets.find(x => x.day === d);
    return { bike: s ? (s.place === "out" ? "out" : "mw") : "none", dur: s ? s.dur : (d >= 5 ? 180 : 60), muscu: d !== 5 }; });
  return { v: 2, goal: { ...GOAL0 }, start: START0, days };
}
function getCfg() {
  let c = store2.get("planCfg");
  if (!c || !Array.isArray(c.days) || c.days.length !== 7) c = defaultCfg();
  c.goal = { ...GOAL0, ...(c.goal || {}) }; c.start = c.start || START0;
  return c;
}
const saveCfg = c => store2.set("planCfg", c);
const cfgSig = c => JSON.stringify([c.days, c.goal.date, c.start]);

// Périodisation : blocs de 4 semaines (3 de charge + 1 allégée) jusqu'à la semaine de l'objectif
function phase(mon, c) {
  const start = mondayOf(parseYmd(c.start)), last = mondayOf(parseYmd(c.goal.date));
  const wi = Math.round((mon - start) / (7 * 864e5)), W = Math.round((last - start) / (7 * 864e5));
  if (+mon === +last) return { wi, block: Math.ceil(W / 4) + 1, wk: 1, deload: true, final: true, kind: 0, test: "test", focus: "Semaine de tests : on mesure le chemin parcouru" };
  if (mon > last || wi < 0) return { wi, block: 0, wk: 1, deload: false, final: false, kind: 3, test: null, out: true, focus: mon > last ? "Objectif passé : fixes-en un nouveau" : "Avant le début du plan : on construit la base" };
  const w = Math.max(0, wi), block = Math.floor(w / 4) + 1, wk = w % 4 + 1, nb = Math.max(1, Math.ceil(W / 4));
  const kind = clamp(nb - block, 0, 3);
  const deload = wk === 4, nextFinal = +addDays(mon, 7) === +last;
  const test = deload && !nextFinal ? (kind === 1 ? "testc" : "test") : null;
  const FOC = ["VO2max et seuil haut, on consolide", "Bloc VO2max", "Seuil et sweet spot, premières séances VO2max", "Base : endurance, tempo et sweet spot"];
  return { wi, block, wk, deload, final: false, kind, test, focus: deload ? (test === "testc" ? "Semaine allégée + test court (sprint, 1 min, 5 min) pour ton profil" : test ? "Semaine allégée + test FTP pour mesurer le bloc" : "Semaine allégée avant la semaine de tests") : FOC[kind] };
}

// ------------------------------------------------------------------ Construction de la semaine
function combos(arr, k) { const out = []; const rec = (i, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1, cur); cur.pop(); } }; if (k <= arr.length) rec(0, []); return out; }
function perms(arr) { if (arr.length <= 1) return [arr.slice()]; const out = []; arr.forEach((x, i) => perms(arr.filter((_, j) => j !== i)).forEach(p => out.push([x, ...p]))); return out; }
function muscuOptions(days, sess) {
  if (!sess.length) return [[]];
  const out = [], P = perms(sess);
  combos(days, sess.length).forEach(ds => P.forEach(p => out.push(ds.map((d, i) => ({ day: d, s: p[i] })))));
  return out;
}
function bikeScore(ko, K, longS, ph, prev) {
  let sc = 0; const kd = ko.keys.map(s => s.day).sort((a, b) => a - b);
  ko.keys.forEach(s => {
    if (s.place === "mw") sc += 10;                                  // puissance maîtrisée sur MyWhoosh
    if (longS && s.day === longS.day - 1) sc -= 4;
    if (longS && s.day === longS.day + 1) sc -= 20;                  // lendemain de la sortie longue
    if (s.day === 0 && prev && prev.legsSun) sc -= 50;               // jambes dimanche matin, séance clé lundi : non
    else if (s.day === 0 && prev && prev.hardSun) sc -= 20;
    if (ph.test || ph.final) sc += [-6, 0, 6, 8, 4, 2, -4][s.day];   // le test en milieu de semaine, reposé
  });
  for (let i = 0; i < kd.length; i++) for (let j = i + 1; j < kd.length; j++) { const g = kd[j] - kd[i]; sc += g === 1 ? -25 : g === 2 ? 4 : 6; }
  const want = ko.boost ? K - 1 : K;
  if (ko.keys.length < want) sc -= 30 * (want - ko.keys.length);
  if (ko.boost) sc -= 6;
  return sc;
}
function muscuScore(mo, ko, longS, bikeDays, ph, prev) {
  const key = new Set(ko.keys.map(s => s.day)), long = longS ? longS.day : -9, testDay = (ph.test || ph.final) && ko.keys.length ? ko.keys[0].day : null;
  let sc = 0; const at = {};
  mo.forEach(x => at[x.day] = x.s);
  const L = mo.find(x => x.s === "legs");
  if (L) { const d = L.day;
    if (key.has(d)) sc -= 60;                    // jambes le matin, séance clé le soir
    if (key.has(d + 1)) sc -= 50;                // veille d'une séance clé
    if (d + 1 === long) sc -= 45;                // veille de la sortie longue
    if (d === long) sc -= 100;
    if (testDay != null && d + 2 === testDay) sc -= 15;
    if (key.has(d - 1) || d - 1 === long || (d === 0 && prev && prev.hardSun)) sc += 10;  // on enchaîne la fatigue, puis récupération
    if (!bikeDays.has(d + 1)) sc += 3;
    if (d === 6) sc -= 2;                        // le lundi suivant sera contraint
  }
  for (let d = 0; d < 6; d++) { const a = at[d], b = at[d + 1]; if (a && b) { const p = [a, b].sort().join(); if (p === "push,upper" || p === "pull,upper") sc -= 8; } }  // mêmes muscles deux matins de suite
  if (prev && prev.musSun && at[0]) { const p = [prev.musSun, at[0]].sort().join(); if (p === "push,upper" || p === "pull,upper") sc -= 8; }
  const seq = mo.slice().sort((a, b) => a.day - b.day).map(x => MORDER.indexOf(x.s));
  let desc = 0; for (let i = 0; i < seq.length; i++) if (seq[(i + 1) % seq.length] < seq[i]) desc++;
  if (seq.length > 1 && desc <= 1) sc += 6;      // ordre du programme respecté : Push → Pull → Legs → Upper
  mo.forEach(x => { if (x.s !== "legs" && key.has(x.day)) sc -= 1; });
  for (let d = 0; d < 5; d++) if (at[d] && at[d + 1] && at[d + 2]) sc -= 2;
  return sc;
}
// fixed : jours déjà passés de la semaine en cours (on les garde quand tu changes tes disponibilités en cours de semaine)
function genWeek(mon, c, ctx, fixed) {
  const ph = phase(mon, c), form = ctx.form, ready = ctx.ready, upto = fixed ? fixed.upto : 0, isFixed = d => d < upto;
  const slots = [];
  for (let i = 0; i < 7; i++) {
    if (isFixed(i)) { const b = fixed.items[i] && fixed.items[i].bike; if (b && TYPES[b.t]) slots.push({ day: i, dur: b.dur, place: b.place, fixed: true, t: b.t }); continue; }
    const d = c.days[i]; if (d.bike && d.bike !== "none") slots.push({ day: i, dur: d.dur, place: d.bike === "any" ? (d.dur >= 150 ? "out" : "mw") : d.bike });
  }
  const fixedLong = slots.find(s => s.fixed && isLong(s.t));
  const longS = fixedLong || slots.filter(s => !s.fixed && s.place === "out" && s.dur >= 150).sort((a, b) => b.dur - a.dur || b.day - a.day)[0] || null;
  const n = slots.length;
  // 2 séances clés par semaine : la sortie longue est déjà une grosse journée et la muscu pèse aussi.
  // 3 seulement avec 6 séances vélo ou plus, sans sortie longue et avec 2 matins de muscu au plus.
  const nMus = c.days.filter(d => d.muscu).length;
  let K = Math.min(n, 2);
  if (n >= 6 && !longS && nMus <= 2 && !(ready.last != null && ready.last < 60) && form.tsb > -10) K = 3;
  const tired = (ready.avg3 != null && ready.avg3 < 45) || form.tsb < -25;
  if (ph.deload || ph.final) K = Math.min(1, n); else if (tired) K = Math.max(Math.min(1, n), K - 1);
  const pool = ph.final ? ["test"] : ph.test ? [ph.test] : POOLS[ph.kind];
  const fixedKeys = slots.filter(s => s.fixed && isKey(s.t)), Krem = Math.max(0, K - fixedKeys.length);
  const cands = slots.filter(s => !s.fixed && s !== longS && s.dur >= 45);
  // muscu : séances des jours passés gardées, les autres réparties sur les matins restants
  const fixedMus = []; for (let d = 0; d < upto; d++) { const m = fixed.items[d] && fixed.items[d].muscu; if (m && MUSCU[m]) fixedMus.push({ day: d, s: m }); }
  const mDays = []; for (let d = upto; d < 7; d++) if (c.days[d].muscu && !(longS && longS.day === d)) mDays.push(d);
  const total = Math.min(4, fixedMus.length + mDays.length);
  const sess = MORDER.slice(0, total).filter(s => !fixedMus.some(f => f.s === s)).slice(0, mDays.length);
  const kOpts = [];
  combos(cands, Math.min(Krem, cands.length)).forEach(ks => kOpts.push({ keys: fixedKeys.concat(ks), boost: false }));
  if (longS && !longS.fixed && !ph.deload && !ph.final && Krem >= 2) combos(cands, Math.min(Krem - 1, cands.length)).forEach(ks => kOpts.push({ keys: fixedKeys.concat(ks), boost: true }));
  if (!kOpts.length) kOpts.push({ keys: fixedKeys.slice(), boost: false });
  const mOpts = muscuOptions(mDays, sess).map(mo => fixedMus.concat(mo)), bikeDays = new Set(slots.map(s => s.day));
  let best = null;
  for (const ko of kOpts) { const bs = bikeScore(ko, K, longS, ph, ctx.prev);
    for (const mo of mOpts) { const sc = bs + muscuScore(mo, ko, longS, bikeDays, ph, ctx.prev); if (!best || sc > best.sc + 1e-9) best = { sc, ko, mo }; } }
  const items = Array.from({ length: 7 }, (_, d) => isFixed(d) ? { day: d, bike: fixed.items[d].bike ? { ...fixed.items[d].bike } : null, muscu: fixed.items[d].muscu || null } : { day: d, bike: null, muscu: null });
  slots.forEach(s => { if (!s.fixed) items[s.day].bike = { dur: s.dur, place: s.place, t: null }; });
  const rest = pool.slice(); fixedKeys.forEach(f => { const k = rest.indexOf(f.t); if (k >= 0) rest.splice(k, 1); });
  best.ko.keys.filter(s => !s.fixed).sort((a, b) => a.day - b.day).forEach((s, i) => items[s.day].bike.t = (rest.length ? rest : pool)[i % (rest.length || pool.length)]);
  items.forEach(it => { if (!isFixed(it.day) && it.bike && it.bike.t === "test") it.bike.place = "mw"; });  // le test rampe se fait sur MyWhoosh
  if (longS && !longS.fixed) { const L = items[longS.day].bike; L.t = best.ko.boost ? "longplus" : "long";
    if (ph.deload) L.dur = DURS.reduce((a, x) => Math.abs(x - L.dur * .7) < Math.abs(a - L.dur * .7) ? x : a, 150); }  // semaine allégée : sortie longue raccourcie
  best.mo.forEach(x => { if (!isFixed(x.day)) items[x.day].muscu = x.s; });
  fillEasy(items, ph, tired, best.ko.keys.length, upto);
  return { items, K: best.ko.keys.length, tired, ph };
}
function fillEasy(items, ph, tired, nKeys, from = 0) {
  const hardAt = d => { const b = items[d] && items[d].bike; return !!(b && b.t && TYPES[b.t].hard); };
  items.forEach(it => { const b = it.bike; if (!b || b.t || it.day < from) return; const d = it.day;
    const afterHard = hardAt(d - 1), legs = it.muscu === "legs", legsBefore = items[d - 1] && items[d - 1].muscu === "legs";
    if ((afterHard || legs) && b.dur <= 75) { b.t = "rec"; b.dur = Math.min(b.dur, 60); }
    else if (!ph.deload && !ph.final && !tired && nKeys < 3 && b.dur >= 75 && !afterHard && !legs && !legsBefore && !hardAt(d + 1)) b.t = "tempo";
    else b.t = "end"; });
}
// la semaine d'avant compte pour le lundi : jambes ou grosse séance le dimanche
function prevCtx(mon) {
  const sun = addDays(mon, -1), k = ymd(sun), pw = store2.get("planWk:" + ymd(addDays(mon, -7)));
  const acts = (S.all || []).filter(a => a.d.slice(0, 10) === k), ftp = profile().ftp;
  const lblMap = store2.get("muscuLbl") || {};
  const mAct = acts.find(isMuscu), planned = pw && pw.items && pw.items[6] ? pw.items[6].muscu : null;
  const musSun = mAct ? (lblMap[mAct.id] || planned || null) : (mon > new Date() && planned ? planned : null);
  return { legsSun: musSun === "legs", musSun, hardSun: acts.some(a => hardRide(a, ftp) || (RIDE_TYPES.has(a.t) && a.mt >= 150 * 60)) || !!(pw && pw.items && pw.items[6] && pw.items[6].bike && TYPES[pw.items[6].bike.t] && TYPES[pw.items[6].bike.t].hard && mon > new Date()) };
}

// ------------------------------------------------------------------ Semaine réelle : ce qui a été fait, et les réajustements
function weekFacts(mon) {
  const f = Array.from({ length: 7 }, () => ({ rides: [], muscu: [] }));
  (S.all || []).forEach(a => { const k = dayIndex(a.dt, mon); if (k < 0 || k > 6) return;
    if (RIDE_TYPES.has(a.t) && isTraining(a)) f[k].rides.push(a); else if (isMuscu(a)) f[k].muscu.push(a); });
  return f;
}
function baseWeek(mon, c, ctx) {
  const key = "planWk:" + ymd(mon), cur = mondayOf(new Date());
  let base = store2.get(key);
  if (!base || base.v !== 2 || base.sig !== cfgSig(c) || !Array.isArray(base.items)) {
    const td = (new Date().getDay() + 6) % 7;  // disponibilités changées en cours de semaine : les jours passés restent tels quels
    const fixed = +mon === +cur && base && base.v === 2 && Array.isArray(base.items) && td > 0 ? { upto: td, items: base.items } : null;
    const g = genWeek(mon, c, ctx, fixed);
    base = { v: 2, sig: cfgSig(c), K: g.K, tired: g.tired, items: g.items, at: new Date().toISOString() };
    if (+mon <= +cur) store2.set(key, base);  // la semaine en cours est figée ; la suivante reste un aperçu
  }
  return base;
}
// créneau pour une séance clé déplacée : pas collée à un jour dur, pas le jour ni le lendemain des jambes
function keySlot(items, from, F, ftp, opt = {}) {
  // withLong : une sortie longue compte comme jour dur la veille de la séance (pas le lendemain : vendredi clé + samedi long, c'est classique)
  const hardDay = (d, withLong) => { if (d < 0 || d > 6 || d === opt.ignore) return false; const it = items[d];
    if (F[d].rides.some(a => hardRide(a, ftp) || (withLong && a.mt >= 150 * 60))) return true;
    return !!(it.bike && it.bike.st !== "missed" && TYPES[it.bike.t] && (isKey(it.bike.t) || (withLong && isLong(it.bike.t)))); };
  const legs = d => d >= 0 && d <= 6 && items[d].muscu && items[d].muscu.s === "legs" && items[d].muscu.st !== "missed";
  let best = null;
  for (let d = from; d < 7; d++) { const b = items[d].bike;
    if (!b || b.st !== "plan" || TYPES[b.t].hard || isLong(b.t) || b.dur < 45 || d === opt.ignore) continue;
    if (hardDay(d - 1, true) || hardDay(d + 1, false) || legs(d) || legs(d - 1)) continue;
    const sc = (b.place === "mw" ? 10 : 0) - d;
    if (!best || sc > best.sc) best = { d, sc }; }
  return best ? best.d : null;
}
// matin libre pour une séance de muscu reportée
function muscuSlot(items, from, s, c) {
  const key = d => d >= 0 && d <= 6 && items[d].bike && items[d].bike.st === "plan" && isKey(items[d].bike.t);
  const longAt = d => d >= 0 && d <= 6 && items[d].bike && isLong(items[d].bike.t) && items[d].bike.st !== "missed";
  const has = d => d >= 0 && d <= 6 && items[d].muscu && items[d].muscu.st !== "missed" ? items[d].muscu.s : null;
  let best = null;
  for (let d = from; d < 7; d++) {
    if (!c.days[d].muscu || has(d) || longAt(d)) continue;
    if (s === "legs" && (key(d) || key(d + 1) || longAt(d + 1))) continue;
    let sc = -d;
    [has(d - 1), has(d + 1)].forEach(o => { if (o) { const p = [o, s].sort().join(); if (p === "push,upper" || p === "pull,upper") sc -= 5; } });
    if (!best || sc > best.sc) best = { d, sc }; }
  return best ? best.d : null;
}
function effective(mon, c, ctx) {
  const cur = mondayOf(new Date()), isCur = +mon === +cur, now = new Date();
  const base = baseWeek(mon, c, ctx), ph = phase(mon, c), key = ymd(mon), ov = store2.get("planOv:" + key) || {};
  const items = base.items.map((it, d) => { const o = ov[d] || {}; let bike = it.bike ? { ...it.bike, st: "plan" } : null;
    if (bike && o.t && TYPES[o.t]) { bike.t = o.t; bike.own = true; } if (bike && o.dur) { bike.dur = o.dur; bike.own = true; } if (bike && o.place) { bike.place = o.place; bike.own = true; }
    return { day: d, date: addDays(mon, d), bike, muscu: it.muscu ? { s: it.muscu, st: "plan" } : null, extra: [] }; });
  const out = { mon, ph, items, changes: [], K: base.K, tired: base.tired, isCur, td: isCur ? (now.getDay() + 6) % 7 : mon < cur ? 7 : -1 };
  if (out.td < 0) return out;  // semaine à venir : simple aperçu
  const td = out.td, F = weekFacts(mon), ftp = profile().ftp, undo = new Set(store2.get("planUndo:" + key) || []), lbl = store2.get("muscuLbl") || {};
  const ready = ctx.ready, morningOver = now.getHours() >= 12, eveningOver = now.getHours() >= 22;
  const step = (id, text, fn) => { if (undo.has(id)) return false; fn(); out.changes.push({ id, text }); return true; };
  const info = text => out.changes.push({ id: null, text });
  // --- vélo : ce qui a été fait
  let hardDays = 0;
  for (let d = 0; d < 7 && d <= td; d++) { const it = items[d], R = F[d].rides;
    if (R.some(a => hardRide(a, ftp))) hardDays++;
    if (R.length) { if (it.bike) { it.bike.st = "done"; it.bike.acts = R; } else it.extra = R; }
    else if (it.bike && (d < td || (d === td && eveningOver))) it.bike.st = "missed"; }
  const plannedKeys = items.filter(it => it.bike && isKey(it.bike.t)).length;
  // --- muscu : ce qui a été fait (étiquette choisie, sinon séance prévue ce jour-là, sinon la prochaine de la semaine)
  const doneS = new Set(), planM = items.filter(it => it.muscu).map(it => it.muscu.s);
  for (let d = 0; d < 7 && d <= td; d++) F[d].muscu.forEach(a => {
    const it = items[d], here = it.muscu && it.muscu.st === "plan" ? it.muscu.s : null;
    let s = lbl[a.id] || (here && !doneS.has(here) ? here : planM.find(x => !doneS.has(x)));
    if (!s || doneS.has(s)) { it.muscuExtra = a; return; }
    doneS.add(s);
    if (here === s) { it.muscu.st = "done"; it.muscu.act = a; return; }
    const from = items.find(x => x.day !== d && x.muscu && x.muscu.s === s && x.muscu.st === "plan");
    if (from) { if (from.day > d) { from.muscu = null; info(`${MUSCU[s].l} faite ${dl(d)} au lieu de ${dl(from.day)}.`); } else from.muscu.st = "swapped"; }
    if (here) { it.muscu = { s, st: "done", act: a, displaced: here }; }
    else it.muscu = { s, st: "done", act: a };
  });
  // séances de muscu prévues passées non faites (ou déplacées par une autre séance faite ce jour-là)
  const missedM = [];
  items.forEach(it => { if (it.muscu && it.muscu.displaced && !doneS.has(it.muscu.displaced)) missedM.push({ s: it.muscu.displaced, from: it.day });
    if (it.muscu && it.muscu.st === "plan" && (it.day < td || (it.day === td && morningOver))) { it.muscu.st = "missed"; if (!doneS.has(it.muscu.s)) missedM.push({ s: it.muscu.s, from: it.day }); } });
  // --- R1 : séance clé ratée → déplacée si possible
  items.forEach(it => { if (!it.bike || it.bike.st !== "missed" || !isKey(it.bike.t)) return;
    const future = items.filter(x => x.day >= td && x.bike && x.bike.st === "plan" && isKey(x.bike.t)).length;
    if (hardDays + future >= plannedKeys) return;
    const from = td + (now.getHours() >= 20 ? 1 : 0), tgt = keySlot(items, from, F, ftp, { ignore: it.day });  // le vélo se fait le soir
    const t = it.bike.t, nm = TYPES[t].l;
    if (tgt == null) { info(`${nm} de ${dl(it.day)} non faite : pas de place cette semaine sans enchaîner deux jours durs, on la laisse passer.`); return; }
    step(`move-${it.day}`, `${nm} de ${dl(it.day)} non faite : déplacée à ${dl(tgt)}.`, () => { const b = items[tgt].bike; b.t = t; b.dur = Math.max(b.dur, 60); b.moved = it.day; it.bike.movedTo = tgt; });
  });
  // --- R2 : récupération basse ce matin et séance clé prévue aujourd'hui
  const T = td < 7 ? items[td] : null;
  if (isCur && T && T.bike && T.bike.st === "plan" && isKey(T.bike.t) && ready.today != null && ready.today < 45) {
    const t = T.bike.t, tgt = keySlot(items, td + 1, F, ftp, { ignore: td }), easy = ready.today < 35 ? "rec" : "end";
    step(`ready-${ymd(now)}`, tgt != null ? `Récupération à ${ready.today}/100 ce matin : ${TYPES[t].l} décalée à ${dl(tgt)}, ${easy === "rec" ? "récupération" : "endurance facile"} ce soir.` : `Récupération à ${ready.today}/100 ce matin : ${TYPES[t].l} remplacée par ${easy === "rec" ? "une récupération" : "de l'endurance facile"} (pas d'autre jour possible cette semaine).`,
      () => { if (tgt != null) { const b = items[tgt].bike; b.t = t; b.dur = Math.max(b.dur, 60); b.moved = td; } T.bike.t = easy; T.bike.dur = Math.min(T.bike.dur, easy === "rec" ? 45 : 60); T.bike.changed = true; });
  }
  // --- R2 bis : récupération très basse, séance facile prévue ce soir → récupération courte
  if (isCur && T && T.bike && T.bike.st === "plan" && !T.bike.changed && (T.bike.t === "end" || T.bike.t === "tempo") && ready.today != null && ready.today < 35)
    step(`easy-${ymd(now)}`, `Récupération à ${ready.today}/100 ce matin : ${TYPES[T.bike.t].l.toLowerCase()} remplacée par 45 min de récupération (ou repos).`, () => { T.bike.t = "rec"; T.bike.dur = 45; T.bike.changed = true; });
  // --- R3 : séances intenses déjà faites (y compris imprévues) → on n'en rajoute pas
  const fut = items.filter(x => x.day >= td && x.bike && x.bike.st === "plan" && isKey(x.bike.t));
  let excess = hardDays + fut.length - Math.max(plannedKeys, hardDays);
  fut.slice().reverse().forEach(x => { if (excess <= 0) return;
    if (step(`enough-${x.day}`, `Tu as déjà fait ${hardDays} séance${hardDays > 1 ? "s" : ""} intense${hardDays > 1 ? "s" : ""} cette semaine : ${dl(x.day)} passe en endurance.`, () => { x.bike.t = "end"; x.bike.changed = true; })) excess--; });
  items.forEach(x => { if (x.day < td || !x.bike || x.bike.st !== "plan" || !isKey(x.bike.t)) return;
    const prevHard = x.day > 0 && x.day - 1 <= td && F[x.day - 1].rides.some(a => hardRide(a, ftp)) && !(items[x.day - 1].bike && isKey(items[x.day - 1].bike.t));
    if (!prevHard) return;
    const t = x.bike.t, tgt = keySlot(items, x.day + 1, F, ftp, { ignore: x.day });
    step(`adj-${x.day}`, `Séance intense imprévue ${dl(x.day - 1)} : ${TYPES[t].l} ${tgt != null ? `décalée à ${dl(tgt)}` : "remplacée par de l'endurance"} pour ne pas enchaîner deux jours durs.`,
      () => { if (tgt != null) { const b = items[tgt].bike; b.t = t; b.moved = x.day; } x.bike.t = "end"; x.bike.changed = true; });
  });
  // --- muscu manquée → reportée sur un matin libre
  const seen = new Set();
  missedM.forEach(m => { if (seen.has(m.s)) return; seen.add(m.s);
    const tgt = muscuSlot(items, td + (morningOver ? 1 : 0), m.s, c);
    if (tgt == null) { info(`${MUSCU[m.s].l} non faite ${dl(m.from)} : plus de matin libre cette semaine.`); return; }
    step(`mmove-${m.s}-${m.from}`, `${MUSCU[m.s].l} non faite ${dl(m.from)} : reportée à ${dl(tgt)} matin.`, () => { items[tgt].muscu = { s: m.s, st: "plan", moved: m.from }; });
  });
  items.forEach(it => { if (it.bike && (it.bike.st === "plan" || it.bike.changed || it.bike.moved != null) && it.bike.t === "rec") it.bike.dur = Math.min(it.bike.dur, 60); });
  return out;
}
// ------------------------------------------------------------------ Contenu des séances vélo
const RAMP_0 = .55, RAMP_STEP = .06, RAMP_N = 18, RAMP_F = .75;  // test rampe : de 55 % à 157 % de FTP, FTP = 75 % de la meilleure minute
// pas : { d: secondes, lo, hi (fraction de FTP), free?, label }
function build(type, durMin, ph) {
  const T = durMin * 60, S = [], p = clamp(ph.wk, 1, 3) - 1, light = ph.deload ? .8 : 1;
  const ramp = (d, lo, hi, label) => S.push({ d, lo, hi, label });
  const st = (d, f, label) => S.push({ d, lo: f, hi: f, label });
  const free = (d, label) => S.push({ d, lo: 1, hi: 1, free: true, label });
  const hardWarm = () => { ramp(600, .5, .75, "Échauffement progressif"); st(60, 1.02, "Activation"); st(60, .55, "Récup"); st(60, 1.02, "Activation"); st(60, .55, "Récup"); };
  const cool = d => ramp(d, .65, .45, "Retour au calme");
  const used = () => S.reduce((a, s) => a + s.d, 0);
  const fill = (end, f = .65, label = "Endurance") => { const r = T - end - used(); if (r >= 120) st(r, f, label); };
  const vo2note = " Bloc continu de 20 min ou plus : bon pour l'estimation VO2max de Garmin.";
  let title = TYPES[type].l, goal = "";
  if (type === "vo2") {
    const on = [240, 240, 300][p], off = Math.round(on * .75), pct = [1.15, 1.17, 1.18][p];
    hardWarm(); const M = T - used() - 480, reps = clamp(Math.floor((M + off) / (on + off) * light), 3, [5, 6, 5][p]);
    for (let i = 0; i < reps; i++) { st(on, pct, `Intervalle ${i + 1}/${reps}`); if (i < reps - 1) st(off, .5, "Récupération"); }
    fill(480); cool(480); title = `VO2max ${reps} × ${on / 60}'`; goal = `Le cœur du travail VO2max : ${reps} efforts de ${on / 60} min à ${Math.round(pct * 100)} % de FTP. Tenir la puissance jusqu'au bout, cadence 95-105.`;
  } else if (type === "vo2r") {  // protocole de Rønnestad : 30 s dur / 15 s facile pendant 9 min 45
    const pct = [1.18, 1.2, 1.22][p];
    hardWarm(); const M = T - used() - 480, sets = clamp(Math.floor((M + 180) / 765 * light), 1, 3);
    for (let k = 0; k < sets; k++) { for (let i = 0; i < 13; i++) { st(30, pct, `Série ${k + 1} · ${i + 1}/13`); st(15, .5, "Récup"); } if (k < sets - 1) st(180, .55, "Entre deux séries"); }
    fill(480); cool(480); title = `VO2max ${sets} × 13 × 30/15`; goal = `Le protocole de Rønnestad : ${sets} série${sets > 1 ? "s" : ""} de 13 × (30 s à ${Math.round(pct * 100)} % / 15 s facile). Sur 10 semaines, il a fait gagner 8,7 % de VO2max contre 2,6 % pour des intervalles de 5 min. Cadence élevée, effort régulier.`;
  } else if (type === "vo2s") {
    hardWarm(); const M = T - used() - 480, sets = clamp(Math.floor((M + 300) / 900 * light), 1, 3);
    for (let k = 0; k < sets; k++) { for (let i = 0; i < 10; i++) { st(30, 1.3, `Série ${k + 1} · ${i + 1}/10`); st(30, .5, "Récup"); } if (k < sets - 1) st(300, .55, "Entre deux séries"); }
    fill(480); cool(480); title = `VO2max ${sets} × 10 × 30/30`; goal = `Des efforts courts à 130 % qui font monter la VO2 sans s'épuiser : ${sets} série${sets > 1 ? "s" : ""} de 10 × (30 s dur / 30 s facile).`;
  } else if (type === "thr") {
    const L = [12, 15, 20][p] * 60, pct = [.95, .97, 1.0][p];
    hardWarm(); const M = T - used() - 480, reps = clamp(Math.floor((M + 300) / (L + 300) * light), 2, 4);
    for (let i = 0; i < reps; i++) { st(L, pct, `Bloc seuil ${i + 1}/${reps}`); if (i < reps - 1) st(300, .55, "Récupération"); }
    fill(480); cool(480); title = `Seuil ${reps} × ${L / 60}'`; goal = `Repousser la FTP : ${reps} blocs de ${L / 60} min à ${Math.round(pct * 100)} %. Puissance régulière, pas de départ trop fort.${L >= 1200 ? vo2note : ""}`;
  } else if (type === "ss") {
    const L = [15, 20, 20][p] * 60, pct = .9;
    ramp(600, .5, .75, "Échauffement progressif"); const M = T - used() - 360, reps = clamp(Math.floor((M + 240) / (L + 240) * light), 2, 4);
    for (let i = 0; i < reps; i++) { st(L, pct, `Sweet spot ${i + 1}/${reps}`); if (i < reps - 1) st(240, .55, "Récupération"); }
    fill(360); cool(360); title = `Sweet spot ${reps} × ${L / 60}'`; goal = `Beaucoup de temps juste sous le seuil (88-92 %) : efficace pour faire monter la FTP sans trop de fatigue.${L >= 1200 ? vo2note : ""}`;
  } else if (type === "tempo") {
    ramp(480, .5, .7, "Échauffement"); const M = T - used() - 300, blocks = clamp(Math.floor((M - 600) / 1200), 1, 3);
    st(Math.max(0, Math.round((M - blocks * 1200) / 2)), .68, "Endurance");
    for (let i = 0; i < blocks; i++) { st(900, .82, `Tempo ${i + 1}/${blocks}`); st(300, .62, "Souple"); }
    fill(300); cool(300); title = `Endurance + ${blocks} × 15' tempo`; goal = "Une base d'endurance avec quelques blocs tempo pour élargir le moteur aérobie.";
  } else if (type === "end") {
    ramp(420, .5, .68, "Échauffement"); const M = T - used() - 300, n = Math.floor(M / 900);
    for (let i = 0; i < n; i++) { st(780, .68, "Endurance"); st(120, .72, "Cadence élevée (100-110 rpm)"); }
    fill(300, .68); cool(300); title = `Endurance ${fmtMin(durMin)}`; goal = "Zone 2 : construire la base aérobie qui soutient FTP et VO2max. Facile, régulier, on doit pouvoir parler.";
  } else if (type === "rec") {
    ramp(300, .45, .55, "Mise en route"); fill(240, .5, "Très facile"); cool(240); title = `Récupération ${fmtMin(durMin)}`; goal = "Faire tourner les jambes sans fatigue. Aucune intensité.";
  } else if (type === "long") {
    const tempo = !ph.deload && T >= 9000;
    ramp(900, .5, .68, "Mise en route");
    if (tempo) { const mid = Math.round((T - 900 - 600 - 3 * 900 - 2 * 300) / 2); st(mid, .68, "Endurance"); for (let i = 0; i < 3; i++) { st(900, .8, `Tempo ${i + 1}/3`); if (i < 2) st(300, .62, "Souple"); } }
    fill(600, .68); cool(600); title = `Sortie longue ${fmtMin(durMin)}${tempo ? " avec tempo" : ""}`; goal = `La grosse séance d'endurance de la semaine${tempo ? ", avec 3 × 15 min en tempo dans la seconde moitié" : ""}. Manger et boire régulièrement.`;
  } else if (type === "longplus") {
    ramp(900, .5, .68, "Mise en route"); const L = [10, 12, 15][p] * 60;
    const mid = Math.round((T - 900 - 600 - 3 * L - 2 * 360) / 2); st(Math.max(600, mid), .68, "Endurance");
    for (let i = 0; i < 3; i++) { st(L, .95, `Bloc seuil ${i + 1}/3`); if (i < 2) st(360, .62, "Souple"); }
    fill(600, .68); cool(600); title = `Sortie longue ${fmtMin(durMin)} + 3 × ${L / 60}' seuil`; goal = `Ta deuxième séance clé de la semaine, intégrée à la sortie longue : 3 blocs de ${L / 60} min au seuil (zone 4 au cardio) au milieu de la sortie, sur une portion roulante.`;
  } else if (type === "test") {  // test rampe (celui de MyWhoosh) : paliers d'1 min de +6 % de FTP jusqu'à ne plus tenir
    ramp(300, .45, .55, "Échauffement");
    for (let k = 0; k < RAMP_N; k++) st(60, Math.round((RAMP_0 + k * RAMP_STEP) * 100) / 100, k ? `Rampe · palier ${k + 1}` : "RAMPE : tiens chaque palier le plus longtemps possible");
    cool(600); title = "Test FTP rampe"; goal = "Le plus simple : lance le test « FTP Ramp Test » intégré à MyWhoosh, qui calcule ta FTP à la fin. Sinon, ce fichier reproduit la rampe : paliers d'1 min qui montent de 6 % de FTP, jusqu'à ne plus pouvoir tenir la puissance. Ta FTP = 75 % de ta meilleure minute. Pas de départ trop prudent ni d'échauffement long : l'effort dure 15 à 20 min.";
  } else if (type === "testc") {
    ramp(900, .5, .75, "Échauffement progressif"); st(60, 1.05, "Ouverture"); st(240, .55, "Récup");
    free(10, "SPRINT : 6 à 8 s à fond"); st(230, .5, "Récup"); free(10, "SPRINT : 6 à 8 s à fond"); st(300, .5, "Récup");
    free(60, "1 MIN à fond"); st(480, .5, "Récup"); free(300, "5 MIN à fond, régulier"); st(480, .5, "Récup");
    fill(300, .55, "Souple"); cool(300); title = "Test court : sprint, 1 min, 5 min"; goal = "Trois efforts maximaux pour ton profil de coureur (carte Progression) : 2 sprints, 1 min et 5 min à fond. En mode libre (pas ERG), sur un braquet moyen.";
  }
  for (let k = S.length - 1; k >= 0; k--) if (S[k].d < 10) S.splice(k, 1);
  // cohérence des rampes : l'échauffement monte jusqu'au niveau de la suite, le retour au calme part d'au plus bas que ce qui précède
  const first = S[0], next = S[1];
  if (first && next && first.lo !== first.hi && !next.free && next.lo < .75) { first.hi = next.lo; first.lo = Math.min(first.lo, Math.max(.35, next.lo - .12)); }
  const last = S[S.length - 1], prev = S[S.length - 2];
  if (last && prev && last.lo !== last.hi && !prev.free) { last.lo = Math.min(.65, prev.lo, prev.hi); last.hi = Math.min(last.hi, Math.max(.35, last.lo - .12)); }
  const tss = Math.round(S.reduce((a, s) => { const f = s.free ? (s.d <= 60 ? 1.3 : 1) : (s.lo + s.hi) / 2; return a + s.d / 3600 * f * f * 100; }, 0));
  return { title, goal, steps: S, tss };
}

// ------------------------------------------------------------------ Export MyWhoosh (.zwo)
function zwo(b, date, prof) {
  const x = v => v.toFixed(3), esc2 = t => String(t).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const lines = b.w.steps.map((st, i) => {
    if (st.free) return `    <FreeRide Duration="${st.d}" FlatRoad="1"/>`;
    if (st.lo !== st.hi) { const tag = i === 0 ? "Warmup" : i === b.w.steps.length - 1 ? "Cooldown" : "Ramp"; return `    <${tag} Duration="${st.d}" PowerLow="${x(st.lo)}" PowerHigh="${x(st.hi)}"/>`; }
    return `    <SteadyState Duration="${st.d}" Power="${x(st.lo)}"/>`;
  }).join("\n");
  return `<workout_file>\n  <author>Breizh Watts</author>\n  <name>${esc2(b.w.title)}</name>\n  <description>${esc2(b.w.goal + ` (FTP de référence : ${prof.ftp} W)`)}</description>\n  <sportType>bike</sportType>\n  <tags/>\n  <workout>\n${lines}\n  </workout>\n</workout_file>\n`;
}
const fileName = (b, date) => `${ymd(date)}_${b.w.title.replace(/[^A-Za-z0-9À-ÿ×' ]/g, "").replace(/[×' ]+/g, "-")}.zwo`;
function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function downloadAll(list, prof) {
  if (!window.JSZip) await new Promise((ok, ko) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
  const z = new JSZip(); list.forEach(it => z.file(fileName(it.bike, it.date), zwo(it.bike, it.date, prof)));
  const blob = await z.generateAsync({ type: "blob" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `seances_${ymd(list[0].date)}.zip`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ------------------------------------------------------------------ Affichage d'une séance
function hrRange(f, prof) {
  const z = prof.hrZones, zi = Math.min(4, zoneOf(f)), fl = z && z.floors;
  if (!fl || fl.some(v => v == null)) return null;
  const lo = fl[zi], hi = zi < 4 ? fl[zi + 1] - 1 : (z.max || fl[4] + 15);
  return `${lo}-${hi} bpm`;
}
function profileSvg(steps) {
  const T = steps.reduce((a, s) => a + s.d, 0), W = 600, H = 70; let x = 0, out = "";
  steps.forEach(s => { const w = s.d / T * W, f = s.free ? 1.05 : Math.max(s.lo, s.hi), col = ZONES[zoneOf(f)][2];
    if (s.lo !== s.hi && !s.free) { const y1 = H - Math.min(1.4, s.lo) / 1.4 * H, y2 = H - Math.min(1.4, s.hi) / 1.4 * H; out += `<path d="M${x},${H}L${x},${y1}L${x + w},${y2}L${x + w},${H}Z" fill="${ZONES[zoneOf((s.lo + s.hi) / 2)][2]}"/>`; }
    else { const h = Math.min(1.4, f) / 1.4 * H; out += `<rect x="${x}" y="${H - h}" width="${Math.max(.5, w - .4)}" height="${h}" fill="${col}" ${s.free ? 'opacity=".55"' : ""}/>`; }
    x += w; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="wprof" role="img" aria-label="Profil de la séance">${out}<line x1="0" x2="${W}" y1="${H - 1 / 1.4 * H}" y2="${H - 1 / 1.4 * H}" stroke="currentColor" stroke-dasharray="4 4" opacity=".35"/></svg>`;
}
function cleanDur(d) { return d < 60 ? `${d} s` : fmtMin(Math.round(d / 60)); }
function stepsTable(b, prof) {
  const st = b.w.steps, same = (a, c) => a && c && a.d === c.d && a.lo === c.lo && a.hi === c.hi && !!a.free === !!c.free;
  const base = l => l.split(/ \d/)[0];
  const rows = []; let i = 0;
  while (i < st.length) {
    if (i + 3 < st.length && same(st[i], st[i + 2]) && same(st[i + 1], st[i + 3])) {
      let k = 1; while (i + 2 * k + 1 < st.length && same(st[i], st[i + 2 * k]) && same(st[i + 1], st[i + 2 * k + 1])) k++;
      let reps = k, j = i + 2 * k; if (same(st[j], st[i])) { reps++; j++; }
      rows.push({ on: st[i], off: st[i + 1], reps }); i = j;
    } else { rows.push({ on: st[i] }); i++; }
  }
  const out = b.place === "out";
  const tgt = x => { const f = (x.lo + x.hi) / 2;
    if (x.free) return out ? "à fond, régulier" : "libre : à fond";
    if (out) return `${hrRange(f, prof) ? hrRange(f, prof) + " · " : ""}RPE ${RPE[Math.min(5, zoneOf(f))]}`;
    return (x.lo === x.hi ? `${W5(x.lo * prof.ftp)} W` : `${W5(x.lo * prof.ftp)} → ${W5(x.hi * prof.ftp)} W`) + ` <small>${Math.round(x.lo * 100)}${x.lo !== x.hi ? "-" + Math.round(x.hi * 100) : ""} %</small>`; };
  const dot = x => `<i style="background:${ZONES[zoneOf(x.free ? 1.02 : Math.max(x.lo, x.hi))][2]}"></i>`;
  return `<table class="steps"><tbody>${rows.map(r => r.off
    ? `<tr><td>${dot(r.on)}${r.reps} × ${cleanDur(r.on.d)}</td><td>${base(r.on.label)}<small>récup ${cleanDur(r.off.d)} entre chaque</small></td><td class="tg">${tgt(r.on)}<small>récup : ${out ? "très facile" : W5(r.off.lo * prof.ftp) + " W"}</small></td></tr>`
    : `<tr><td>${dot(r.on)}${cleanDur(r.on.d)}</td><td>${base(r.on.label)}</td><td class="tg">${tgt(r.on)}</td></tr>`).join("")}</tbody></table>`;
}
// ------------------------------------------------------------------ Affichage de l'onglet
const PS = { mon: null, open: {}, avail: false, goalEdit: false, W: null, Wc: null };
function weekTarget() { const t = new Date(), mon = mondayOf(t); return (t.getDay() === 0 || t.getDay() === 6) ? addDays(mon, 7) : mon; }
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); }
const placeL = p => p === "mw" ? "MyWhoosh" : "dehors";

function renderHead(prof, form, ready, ph, c) {
  const G = c.goal, end = parseYmd(G.date), weeksLeft = Math.max(1, Math.round((end - new Date()) / (7 * 864e5)));
  const ftp0 = (prof.ftpHist && prof.ftpHist.length ? prof.ftpHist[0][1] : prof.ftp) || prof.ftp;
  const need = G.ftp - prof.ftp, perW = need / weeksLeft;
  const vo2 = prof.vo2 && prof.vo2.length ? prof.vo2[prof.vo2.length - 1][1] : null, vo2first = prof.vo2 && prof.vo2.length ? prof.vo2[0][1] : null;
  const pct = (v, a, b) => clamp((v - a) / (b - a || 1) * 100, 0, 100);
  const verdict = need <= 0 ? "objectif atteint" : perW <= 1.2 ? "rythme réaliste" : perW <= 2.5 ? "ambitieux mais jouable" : "très ambitieux";
  const r = ready.today ?? ready.last, rc = r == null ? "var(--muted)" : r >= 75 ? "#2f9e44" : r >= 55 ? "#1c7ed6" : r >= 40 ? "#f08c00" : "#e03131";
  const tsbTxt = form.tsb > 5 ? "frais" : form.tsb > -10 ? "équilibré" : form.tsb > -25 ? "chargé" : "très chargé";
  const until = end.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `
  <section class="card span12 goalcard">
    <div class="gc">
      <div class="g"><div class="gl">FTP</div><div class="gv"><input id="pFtp" type="number" min="80" max="600" step="1" value="${prof.ftp}" aria-label="FTP en watts"><span>W</span><span class="arrow">→ ${G.ftp} W</span></div>
        <div class="pbar"><div style="width:${pct(prof.ftp, Math.min(ftp0, prof.ftp) - 20, G.ftp)}%"></div></div>
        <div class="gs">${need > 0 ? `encore <b>+${need} W</b> en ${weeksLeft} semaines, soit +${perW.toFixed(1).replace(".", ",")} W/sem · ${verdict}` : "objectif atteint"} · source : ${prof.ftpSrc}${prof.det && prof.det.ftp > prof.ftp ? ` · <b>détectée : ${prof.det.ftp} W</b> (${prof.det.l} à ${prof.det.w} W)` : ""}</div></div>
      <div class="g"><div class="gl">VO2max (Garmin)</div><div class="gv"><b>${vo2 != null ? String(vo2).replace(".", ",") : "–"}</b><span class="arrow">→ ${String(G.vo2).replace(".", ",")}</span></div>
        <div class="pbar"><div style="width:${vo2 != null ? pct(vo2, Math.min(vo2first || vo2, vo2) - 3, G.vo2) : 0}%"></div></div>
        <div class="gs">${vo2 != null ? `${vo2first != null && vo2first !== vo2 ? `${vo2 > vo2first ? "+" : ""}${(vo2 - vo2first).toFixed(1).replace(".", ",")} depuis janvier · ` : ""}encore ${Math.max(0, G.vo2 - vo2).toFixed(1).replace(".", ",")} à prendre` : "pas encore de valeur Garmin"}</div></div>
    </div>
    <div class="gedit">${PS.goalEdit ? `<form id="pGoalF"><label>FTP visée <input type="number" id="gFtp" min="100" max="600" value="${G.ftp}"> W</label><label>VO2max visée <input type="number" id="gVo2" min="30" max="90" step="0.5" value="${G.vo2}"></label><label>Pour le <input type="date" id="gDate" value="${G.date}" min="${ymd(addDays(new Date(), 14))}"></label><button class="btn2 primary">Enregistrer</button><button type="button" class="btn2 ghost" id="gCancel">Annuler</button></form>`
      : `<span>Objectif au ${until}</span><button class="lnk" id="gEdit">Modifier</button>`}</div>
  </section>
  <section class="card span12">
    <div class="formrow">
      <div class="fi"><div class="l">Récupération</div><div class="v" style="color:${rc}">${r ?? "–"}<small>/100</small></div><div class="s">${ready.today == null && r != null ? "dernier score connu" : ready.avg3 != null ? `moy. 3 j : ${Math.round(ready.avg3)}` : "onglet Récup"}</div></div>
      <div class="fi"><div class="l">Forme (charge en TSS)</div><div class="v">${form.tsb >= 0 ? "+" : ""}${Math.round(form.tsb)}</div><div class="s">${tsbTxt} · fond ${Math.round(form.ctl)} / fatigue ${Math.round(form.atl)}</div></div>
      <div class="fi"><div class="l">7 derniers jours</div><div class="v">${Math.round(form.km7)}<small> km</small></div><div class="s">${form.n7} séance${form.n7 > 1 ? "s" : ""}${form.c7 ? ` + ${form.c7} trajet${form.c7 > 1 ? "s" : ""}` : ""} · ${form.h7.toFixed(1).replace(".", ",")} h</div></div>
      <div class="fi"><div class="l">Dernière séance dure</div><div class="v sm">${form.lastHard == null ? "–" : form.lastHard === 0 ? "aujourd'hui" : form.lastHard === 1 ? "hier" : `il y a ${form.lastHard} j`}</div><div class="s">intensité ou effet aérobie élevé</div></div>
      <div class="fi wide"><div class="l">Cycle d'entraînement</div><div class="v sm">${ph.final ? "Semaine finale" : ph.out ? "Hors plan" : `Bloc ${ph.block} · semaine ${ph.wk}/4`}${ph.deload && !ph.final ? " (allégée)" : ""}</div><div class="s">${esc(ph.focus)}</div></div>
    </div>
  </section>`;
}

function bikeStatus(b) {
  if (b.st === "done") return `<span class="stg ok">faite ✓</span>`;
  if (b.st === "missed") return `<span class="stg ko">${b.movedTo != null ? `déplacée à ${dl(b.movedTo)}` : "non faite"}</span>`;
  if (b.moved != null) return `<span class="stg mv">vient de ${dl(b.moved)}</span>`;
  if (b.changed) return `<span class="stg mv">allégée</span>`;
  if (b.own) return `<span class="stg">modifiée</span>`;
  return "";
}
function doneSummary(acts) { const a = acts[0], km = acts.reduce((s, x) => s + x.km, 0), mt = acts.reduce((s, x) => s + x.mt, 0); return `${isIndoor(a) ? (a.w ? `${a.w} W · ` : "") : `${nf(km)} km · `}${fmtMin(Math.round(mt / 60))}`; }
function muscuChip(it) {
  const m = it.muscu, M = MUSCU[m.s];
  if (m.st === "done" && m.act) return `<label class="mchip done" title="Séance faite (Garmin). Change l'étiquette si ce n'était pas celle-ci."><b>✓</b><select data-mlbl="${m.act.id}" aria-label="Séance de muscu faite">${MORDER.map(s => `<option value="${s}" ${s === m.s ? "selected" : ""}>${MUSCU[s].l}</option>`).join("")}</select></label>`;
  const sub = m.st === "missed" ? "non faite" : m.st === "swapped" ? "faite un autre jour" : m.moved != null ? `reportée de ${dl(m.moved)}` : M.d;
  return `<span class="mchip ${m.st}${m.moved != null ? " moved" : ""}"><b>${M.l}</b><small>${sub}</small></span>`;
}
function renderDay(W, ready) {
  if (W.td < 0 || W.td > 6) return "";
  const it = W.items[W.td], b = it.bike, r = ready.today;
  const morning = it.muscu ? muscuChip(it) : it.muscuExtra ? `<span class="mchip done"><b>✓ Muscu</b><small>en plus</small></span>` : `<span class="dnone">Pas de muscu</span>`;
  const evening = b ? `<button class="dbk" data-open="${ymd(it.date)}" style="--tc:${TYPES[b.t].c}"><span class="badge">${TYPES[b.t].l}</span><span class="dbt">${esc(b.w.title)}</span><small>${b.st === "done" ? doneSummary(b.acts) : `${fmtMin(b.dur)} · ${placeL(b.place)} · ≈ ${b.w.tss} TSS`}</small>${bikeStatus(b)}</button>`
    : it.extra.length ? `<span class="dnone">Repos prévu · ${it.extra.length} sortie faite</span>` : `<span class="dnone">Repos vélo</span>`;
  const undoN = (store2.get("planUndo:" + ymd(W.mon)) || []).length;
  const last = rides().filter(isTraining).slice(-1)[0];
  return `<section class="card span6 dayc"><h2>Aujourd'hui <small>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}${r != null ? ` · récup ${r}/100` : ""}</small></h2>
    <div class="drow"><span class="dk">Matin</span><div>${morning}</div></div>
    <div class="drow"><span class="dk">${b && isLong(b.t) ? "Sortie" : "Soir"}</span><div>${evening}</div></div>
    ${W.changes.length ? `<div class="chgh">Ajustements de la semaine</div><ul class="chg">${W.changes.map(x => `<li>${esc(x.text)}${x.id ? ` <button class="lnk" data-undo="${esc(x.id)}">Annuler</button>` : ""}</li>`).join("")}</ul>` : ""}
    ${undoN ? `<button class="lnk small" id="pRedo">Rétablir ${undoN > 1 ? `les ${undoN} ajustements annulés` : "l'ajustement annulé"}</button>` : ""}
    ${last ? `<div class="dlast"><button class="lnk" data-bilan="${last.id}">Bilan de ta dernière séance : ${esc(last.n)} (${dShort(last.dt)}) →</button></div>` : ""}
  </section>`;
}
function detailHtml(W, it, prof) {
  const b = it.bike; if (!b) return "";
  let h = `${profileSvg(b.w.steps)}<p class="sg">${b.w.goal}</p>${stepsTable(b, prof)}`;
  if (b.st !== "done") h += b.place === "mw" ? `<button class="btn2 dl" data-dl="${it.day}">Télécharger pour MyWhoosh (.zwo)</button>`
    : `<div class="outnote">${/^vo2/.test(b.t) ? "Sans capteur de puissance, pilote les intervalles courts à la sensation : le cœur met 1 à 2 min à monter." : "Garde un œil sur le cardio : il dérive un peu à la chaleur et en fin de sortie."}</div>`;
  if (b.st === "done" && b.acts) h += `<div class="ddone">${b.acts.map(a => `<button class="btn2 primary" data-bilan="${a.id}">Bilan : ${esc(a.n)}</button>`).join("")}</div>`;
  if (b.st === "done" && b.acts && b.t === "test") {  // les séances MyWhoosh arrivent sur Garmin sans le nom du test : on lit la meilleure minute
    const w = Math.max(0, ...b.acts.map(a => (a.pc && a.pc["60"]) || 0)), f = Math.round(w * RAMP_F);
    if (w) h += `<p class="sg">Test rampe : meilleure minute ${w} W → <b>FTP ≈ ${f} W</b> (75 %).${f !== prof.ftp ? ` <button class="btn2" data-setftp="${f}">Utiliser ${f} W comme FTP</button>` : " C'est ta FTP actuelle."}</p>`;
  }
  if (b.st === "plan" && (W.td < 0 || it.day >= W.td)) {
    const opt = (v, cur, l) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`;
    h += `<div class="dmod"><span>Changer :</span><select data-ov="t" aria-label="Type">${Object.entries(TYPES).map(([k, t]) => opt(k, b.t, t.l)).join("")}</select>
      <select data-ov="dur" aria-label="Durée">${DURS.map(d => opt(d, b.dur, fmtMin(d))).join("")}</select><select data-ov="place" aria-label="Lieu">${opt("mw", b.place, "MyWhoosh")}${opt("out", b.place, "Dehors")}</select>
      ${b.own ? `<button class="lnk" data-ovreset="1">Revenir au plan</button>` : ""}</div>`;
  }
  return `<div class="wdet" data-d="${it.day}">${h}</div>`;
}
function weekRow(W, it, prof) {
  const now = W.isCur && it.day === W.td, past = W.td > it.day, b = it.bike, open = !!PS.open[ymd(it.date)];
  const bikeH = b ? `<button class="wsess" data-open="${ymd(it.date)}" style="--tc:${TYPES[b.t].c}" aria-expanded="${open}"><span class="badge">${TYPES[b.t].l}</span><span class="wt">${esc(b.w.title)}</span><small>${b.st === "done" ? doneSummary(b.acts) : `${fmtMin(b.dur)} · ${placeL(b.place)} · ≈ ${b.w.tss} TSS`}</small>${bikeStatus(b)}</button>` : "";
  const extra = it.extra.map(a => `<button class="wextra" data-bilan="${a.id}"><span>+ ${esc(a.n)}</span><small>${doneSummary([a])} · bilan →</small></button>`).join("");
  return `<div class="wrow${now ? " now" : ""}${past ? " past" : ""}"><div class="wday"><b>${DAYN[it.day].slice(0, 3)}</b><span>${it.date.getDate()} ${it.date.toLocaleDateString("fr-FR", { month: "short" })}</span></div>
    <div class="wmus">${it.muscu ? muscuChip(it) : it.muscuExtra ? `<span class="mchip done"><b>✓ Muscu</b><small>en plus</small></span>` : ""}</div>
    <div class="wbike">${bikeH}${extra}${!b && !it.extra.length ? `<span class="wrest">Repos vélo</span>` : ""}</div></div>${open && b ? detailHtml(W, it, prof) : ""}`;
}
function renderWeek(W, prof) {
  const thisMon = mondayOf(new Date()), ph = W.ph;
  const plannedT = W.items.reduce((s, it) => s + (it.bike && it.bike.st !== "missed" ? it.bike.w.tss : 0), 0);
  const doneT = Math.round((S.all || []).filter(a => { const k = dayIndex(a.dt, W.mon); return k >= 0 && k <= 6; }).reduce((s, a) => s + tssOf(a), 0));
  const cyc = ph.final ? "Semaine finale" : ph.out ? "Hors plan" : `Bloc ${ph.block} · semaine ${ph.wk}/4${ph.deload ? " (allégée)" : ""}`;
  const mw = W.items.filter(it => it.bike && it.bike.place === "mw" && it.bike.st === "plan" && (W.td < 0 || it.day >= W.td));
  return `<section class="card span12 wkc"><h2>La semaine <small>${cyc} · ≈ ${plannedT} TSS prévus${W.isCur ? ` · ${doneT} faits` : ""}</small><span class="wsel"><button class="chip" data-w="0" aria-pressed="${+W.mon === +thisMon}">Cette semaine</button><button class="chip" data-w="7" aria-pressed="${+W.mon === +addDays(thisMon, 7)}">Semaine prochaine</button></span></h2>
    <p class="pnote">${esc(ph.focus)}.${W.tired ? " Version allégée : fatigue détectée." : ""}${W.td < 0 ? " Aperçu : la semaine se fige lundi, puis s'ajuste chaque jour." : ""} Muscu le matin, vélo le soir ; jamais les jambes le jour ou la veille d'une séance clé.</p>
    <div class="wk">${W.items.map(it => weekRow(W, it, prof)).join("")}</div>
    ${mw.length ? `<div class="factions">${mw.length > 1 ? `<button class="btn2 primary" id="pZip">Télécharger les ${mw.length} séances MyWhoosh (.zip)</button>` : ""}</div>
    <details class="howto"><summary>Importer dans MyWhoosh</summary><ol>
      <li>Va sur <a href="https://workout.mywhoosh.com" target="_blank" rel="noopener">workout.mywhoosh.com</a> et connecte-toi.</li>
      <li>Importe le fichier .zwo (décompresse le .zip d'abord), vérifie l'aperçu, puis « Export to MyWhoosh ».</li>
      <li>La séance apparaît dans le dossier <b>MyWorkout</b> de l'appli (redémarre MyWhoosh s'il était ouvert).</li>
      <li>Les puissances sont en % de FTP : règle ta FTP MyWhoosh sur <b>${prof.ftp} W</b> pour retrouver les watts indiqués ici.</li></ol></details>` : ""}
  </section>`;
}
function renderAvail(c) {
  const opt = (v, cur, l) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`;
  const nb = c.days.filter(d => d.bike !== "none").length, nm = c.days.filter(d => d.muscu).length;
  return `<section class="card span12 avail"><details ${PS.avail ? "open" : ""} id="pAvailD"><summary><span class="avt">Mes disponibilités</span><small>${nb} jour${nb > 1 ? "s" : ""} de vélo · ${nm} matin${nm > 1 ? "s" : ""} de muscu possibles</small></summary>
    <div class="avg">${c.days.map((d, i) => `<div class="avrow" data-i="${i}"><b>${DAYN[i]}</b>
      <select data-k="bike" aria-label="Vélo ${DAYN[i]}">${opt("none", d.bike, "Pas de vélo")}${opt("mw", d.bike, "MyWhoosh")}${opt("out", d.bike, "Dehors")}${opt("any", d.bike, "Au choix")}</select>
      <select data-k="dur" aria-label="Durée max ${DAYN[i]}" ${d.bike === "none" ? "disabled" : ""}>${DURS.map(v => opt(v, d.dur, "jusqu'à " + fmtMin(v))).join("")}</select>
      <label class="mtog"><input type="checkbox" data-k="muscu" ${d.muscu ? "checked" : ""}> muscu le matin</label></div>`).join("")}</div>
    <p class="note">Le plan choisit les jours des séances clés et place Push, Pull, Legs et Upper sur 4 de tes matins de muscu : jamais les jambes le matin d'une séance clé, ni la veille d'une séance clé ou de la sortie longue. Avec moins de 4 matins, Upper saute en premier. Une sortie « dehors » de 2 h 30 ou plus devient la sortie longue.</p>
    <div class="factions"><button class="btn2" id="pShare">Copier le lien pour mon autre appareil</button><button class="btn2 ghost" id="pHabits">Vélo selon mes habitudes</button></div><div id="pShareOut"></div>
  </details></section>`;
}

// ------------------------------------------------------------------ Charge conseillée du jour
function todayLoad(form, r) {
  const base = Math.max(30, form.ctl);
  const F = r == null ? [.6, 1.1] : r >= 80 ? [1, 1.6] : r >= 65 ? [.8, 1.3] : r >= 50 ? [.5, 1] : r >= 35 ? [.2, .6] : [0, .3];
  const k = form.tsb < -20 ? .8 : form.tsb > 10 ? 1.1 : 1;
  return { lo: Math.round(base * F[0] * k / 5) * 5, hi: Math.max(15, Math.round(base * F[1] * k / 5) * 5), r };
}
function renderToday(form, ready, W) {
  const L = todayLoad(form, ready.today ?? ready.last), today = ymd(new Date());
  const done = Math.round((S.all || []).filter(a => a.d.slice(0, 10) === today).reduce((s, a) => s + tssOf(a), 0));
  const it = W.td >= 0 && W.td < 7 ? W.items[W.td] : null, ps = it && it.bike && it.bike.st === "plan" ? it.bike : null, planned = ps ? ps.w.tss : 0;
  const max = Math.max(L.hi * 1.4, done + planned + 10, 60), X = v => Math.min(100, v / max * 100);
  let msg;
  if (L.r != null && L.r < 35) msg = "Récupération très basse : repos, ou 30 à 45 min très faciles.";
  else if (ps && done + planned > L.hi * 1.1) msg = `Ta séance prévue (« ${esc(ps.w.title)} », ≈ ${planned}) dépasse la cible : raccourcis-la si tu te sens lourd.`;
  else if (ps && done + planned < L.lo) msg = `Ta séance prévue est en dessous : tu peux l'allonger d'environ ${Math.round((L.lo - done - planned) / 50 * 60 / 5) * 5} min en endurance.`;
  else if (ps) msg = `Ta séance prévue (« ${esc(ps.w.title)} », ≈ ${planned}) est dans la cible.`;
  else if (done >= L.lo) msg = done > L.hi ? "Tu as déjà dépassé la cible du jour : récupère." : "Cible du jour atteinte avec ce que tu as déjà fait.";
  else { const mid = (L.lo + L.hi) / 2 - done; msg = `Pas de séance prévue : environ ${Math.round(mid / 50 * 60 / 5) * 5} min d'endurance si tu as envie de rouler.`; }
  return `<section class="card span6 today"><h2>Charge conseillée <small>${L.r != null ? `récup ${L.r}/100` : "sans donnée de récup"} · forme ${form.tsb >= 0 ? "+" : ""}${Math.round(form.tsb)}</small></h2>
    <div class="tdv"><b>${L.lo}–${L.hi}</b><span>de charge</span></div>
    <div class="tdbar"><div class="tg" style="left:${X(L.lo)}%;width:${X(L.hi) - X(L.lo)}%"></div>${done ? `<div class="dn" style="width:${X(done)}%"></div>` : ""}${planned ? `<div class="pl" style="left:${X(done)}%;width:${X(done + planned) - X(done)}%"></div>` : ""}</div>
    <div class="tdleg"><span><i class="g"></i>cible</span>${done ? `<span><i class="d"></i>déjà fait : ${done}</span>` : ""}${planned ? `<span><i class="p"></i>prévu : ≈ ${planned}</span>` : ""}</div>
    <p class="tdmsg">${msg}</p>
    <p class="note">Charge en TSS, calculée avec ta puissance (home trainer) ou ta fréquence cardiaque (dehors) : 1 h d'endurance ≈ 50, 1 h au seuil ≈ 100.</p></section>`;
}

// ------------------------------------------------------------------ Classement selon la FTP (W/kg)
const ZWIFT = [[0, 0], [1.5, 2], [2, 6], [2.5, 13], [3.2, 42], [4, 85], [4.6, 95], [5.2, 99], [6.5, 100]];  // % cumulé des coureurs
const AFY = { "<30": [4.95, 5.77], "30-39": [4.3, 5.59], "40-49": [4, 4.88], "50-59": [3.63, 4.38], "60+": [3.23, 4.18] };  // médiane, top 10 % (hommes)
const cdfPts = x => { if (x <= 0) return 0; for (let i = 1; i < ZWIFT.length; i++) if (x <= ZWIFT[i][0]) { const [a, b] = ZWIFT[i - 1], [c, d] = ZWIFT[i]; return b + (d - b) * (x - a) / (c - a); } return 100; };
const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const topOf = c => Math.max(1, Math.round(100 - c));
function renderRank(prof, c) {
  const kg = +store2.get("bwWeight") || 0, age = store2.get("bwAge") || "30-39", G = c.goal;
  const form = `<div class="rkform"><label>Poids <input id="pKg" type="number" min="35" max="150" step="0.1" value="${kg || ""}" placeholder="kg"> kg</label>
    <label>Âge <select id="pAge">${Object.keys(AFY).map(k => `<option ${k === age ? "selected" : ""}>${k}</option>`).join("")}</select></label></div>`;
  if (!kg) return `<section class="card span12 rank"><h2>Ton niveau</h2><p class="tdmsg">Indique ton poids pour calculer tes watts par kilo et te situer parmi les cyclistes. Il reste uniquement sur cet appareil.</p>${form}</section>`;
  const wkg = prof.ftp / kg, top = topOf(cdfPts(wkg)), goal = G.ftp / kg, topG = topOf(cdfPts(goal));
  const [med, p90] = AFY[age] || AFY["30-39"], sd = (p90 - med) / 1.2816, topA = topOf(100 * .5 * (1 + erf((wkg - med) / sd / Math.SQRT2)));
  return `<section class="card span12 rank"><h2>Ton niveau <small>FTP ${prof.ftp} W · ${String(kg).replace(".", ",")} kg</small></h2>
    <div class="rkrow"><div class="tdv"><b>${wkg.toFixed(2).replace(".", ",")}</b><span>W/kg</span></div><div class="rktop">Top <b>${top} %</b><span>des cyclistes qui s'entraînent</span></div></div>
    <div class="rkbar"><div style="width:${100 - top}%"></div><i style="left:${100 - topG}%" title="objectif ${G.ftp} W"></i></div>
    <p class="tdmsg">À ${G.ftp} W tu serais à ${goal.toFixed(2).replace(".", ",")} W/kg : top ${topG} %. Parmi des sportifs testés en laboratoire (hommes ${age} ans), tu es dans le top ${topA} %.</p>
    ${form}
    <p class="note">Repères indicatifs : 1 616 coureurs d'une course Zwift (L'Étape du Tour 2020, 20 min × 95 %) et 1 517 hommes testés par A Faster You (2026). Les deux populations sont plus entraînées que la moyenne des cyclistes.</p></section>`;
}

// ------------------------------------------------------------------ Logique de page
function ctxFor(mon, form, ready) { return { form, ready, prev: prevCtx(mon) }; }
function withWorkouts(W) { W.items.forEach(it => { if (it.bike) it.bike.w = build(it.bike.t, it.bike.dur, W.ph); }); return W; }
function render() {
  const box = $("plan"); if (!box) return;
  if (!store2.get("planSince")) store2.set("planSince", ymd(new Date()));
  const c = getCfg(), prof = profile(), form = fitness(), ready = readiness(), cur = mondayOf(new Date());
  if (!PS.mon || PS.mon < cur) PS.mon = weekTarget();
  const Wc = withWorkouts(effective(cur, c, ctxFor(cur, form, ready)));
  const W = +PS.mon === +cur ? Wc : withWorkouts(effective(PS.mon, c, ctxFor(PS.mon, form, ready)));
  PS.W = W; PS.Wc = Wc;
  box.innerHTML = `<div class="grid">${renderHead(prof, form, ready, W.ph, c)}${renderDay(Wc, ready)}${renderToday(form, ready, Wc)}${renderWeek(W, prof)}${renderAvail(c)}
    <section class="card span12 progc" id="pProg"><h2>Progression <small>tes séances analysées</small></h2><div id="pProgBody"><p class="note">${window.Bilan ? "Analyse en cours…" : ""}</p></div></section>${renderRank(prof, c)}</div>`;
  bind(c, prof);
  if (window.Bilan) Bilan.progress($("pProgBody"), { ftp: prof.ftp, goal: c.goal, profile: prof }).catch(() => {});
}
function bind(c, prof) {
  const box = $("plan");
  const kgIn = $("pKg"), ageIn = $("pAge");
  if (kgIn) kgIn.onchange = () => { const v = +kgIn.value; store2.set("bwWeight", v >= 35 && v <= 150 ? v : null); render(); };
  if (ageIn) ageIn.onchange = () => { store2.set("bwAge", ageIn.value); render(); };
  $("pFtp").onchange = e => { const v = Math.round(+e.target.value); if (v >= 80 && v <= 600) { store2.set("planFtp", v === profile().auto ? null : v); render(); } };
  if ($("gEdit")) $("gEdit").onclick = () => { PS.goalEdit = true; render(); };
  if ($("gCancel")) $("gCancel").onclick = () => { PS.goalEdit = false; render(); };
  if ($("pGoalF")) $("pGoalF").onsubmit = e => { e.preventDefault(); const f = +$("gFtp").value, v = +$("gVo2").value, d = $("gDate").value;
    if (f >= 100 && f <= 600 && d) { c.goal = { ftp: Math.round(f), vo2: v >= 30 && v <= 90 ? v : c.goal.vo2, date: d }; saveCfg(c); PS.goalEdit = false; render(); } };
  box.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { PS.mon = addDays(mondayOf(new Date()), +b.dataset.w); render(); });
  box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { const k = b.dataset.open, d = parseYmd(k), mon = mondayOf(d);
    const inDay = !!b.closest(".dayc");
    if (+mon !== +PS.mon) { PS.mon = mon; PS.open = {}; }
    PS.open[k] = inDay ? true : !PS.open[k]; render();
    if (inDay) setTimeout(() => document.querySelector(`.wdet[data-d="${dayIndex(d, mon)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30); });
  box.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => { const k = "planUndo:" + ymd(PS.Wc.mon), u = store2.get(k) || []; u.push(b.dataset.undo); store2.set(k, u); render(); });
  if ($("pRedo")) $("pRedo").onclick = () => { store2.del("planUndo:" + ymd(PS.Wc.mon)); render(); };
  box.querySelectorAll("[data-bilan]").forEach(b => b.onclick = () => window.Bilan ? Bilan.open(+b.dataset.bilan) : window.open(`https://connect.garmin.com/modern/activity/${b.dataset.bilan}`, "_blank", "noopener"));
  box.querySelectorAll("[data-mlbl]").forEach(s => s.onchange = () => { const m = store2.get("muscuLbl") || {}; m[s.dataset.mlbl] = s.value; store2.set("muscuLbl", m); render(); });
  box.querySelectorAll("[data-setftp]").forEach(b => b.onclick = () => { store2.set("planFtp", +b.dataset.setftp); render(); });
  box.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => { const it = PS.W.items[+b.dataset.dl]; download(fileName(it.bike, it.date), zwo(it.bike, it.date, prof)); });
  if ($("pZip")) $("pZip").onclick = () => { const L = PS.W.items.filter(it => it.bike && it.bike.place === "mw" && it.bike.st === "plan" && (PS.W.td < 0 || it.day >= PS.W.td)); downloadAll(L, prof).catch(() => toast("Téléchargement groupé impossible : télécharge les séances une par une.")); };
  box.querySelectorAll("[data-ov]").forEach(s => s.onchange = () => { const d = +s.closest(".wdet").dataset.d, k = "planOv:" + ymd(PS.W.mon), ov = store2.get(k) || {};
    ov[d] = { ...(ov[d] || {}), [s.dataset.ov]: s.dataset.ov === "dur" ? +s.value : s.value }; store2.set(k, ov); render(); });
  box.querySelectorAll("[data-ovreset]").forEach(b => b.onclick = () => { const d = +b.closest(".wdet").dataset.d, k = "planOv:" + ymd(PS.W.mon), ov = store2.get(k) || {}; delete ov[d]; store2.set(k, ov); render(); });
  const ad = $("pAvailD"); if (ad) ad.ontoggle = () => { PS.avail = ad.open; };
  box.querySelectorAll(".avrow").forEach(r => r.onchange = e => { const i = +r.dataset.i, k = e.target.dataset.k; if (!k) return;
    c.days[i][k] = k === "muscu" ? e.target.checked : k === "dur" ? +e.target.value : e.target.value;
    if (k === "bike" && e.target.value === "any" && c.days[i].dur < 60) c.days[i].dur = 60;
    saveCfg(c); PS.avail = true; render(); });
  if ($("pHabits")) $("pHabits").onclick = () => { const sets = habitSets(); c.days.forEach((d, i) => { const s = sets.find(x => x.day === i); d.bike = s ? s.place : "none"; if (s) d.dur = s.dur; }); saveCfg(c); PS.avail = true; render(); };
  if ($("pShare")) $("pShare").onclick = () => {
    const data = { c, kg: store2.get("bwWeight"), age: store2.get("bwAge"), ftp: store2.get("planFtp") };
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}#plan=${code}`;
    const show = () => { $("pShareOut").innerHTML = `<input class="shareout" readonly value="${esc(url)}" aria-label="Lien de tes réglages">`; $("pShareOut").firstChild.select(); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Lien copié : ouvre-le sur ton autre appareil."), show); else show();
  };
}
function importLink() {
  const h = location.hash; if (!h.startsWith("#plan=")) return false;
  try {
    const raw = h.slice(6).replace(/-/g, "+").replace(/_/g, "/"), o = JSON.parse(decodeURIComponent(escape(atob(raw + "===".slice((raw.length + 3) % 4)))));
    if (o.c && Array.isArray(o.c.days) && o.c.days.length === 7) saveCfg(o.c);
    if (o.kg) store2.set("bwWeight", o.kg); if (o.age) store2.set("bwAge", o.age); if (o.ftp) store2.set("planFtp", o.ftp);
    toast("Réglages du plan importés sur cet appareil.");
  } catch (e) { toast("Lien de réglages illisible."); }
  history.replaceState(null, "", "#plan");
  return true;
}
// séance prévue un jour donné (pour le bilan) : rien avant la mise en route de ce plan
function plannedFor(key) {
  const since = store2.get("planSince"); if (!since || key < since) return null;
  const d = parseYmd(key), mon = mondayOf(d), form = fitness(), ready = readiness();
  const W = withWorkouts(effective(mon, getCfg(), ctxFor(mon, form, ready))), it = W.items[dayIndex(d, mon)];
  return it && it.bike ? { day: it.day, date: it.date, t: it.bike.t, dur: it.bike.dur, place: it.bike.place, w: it.bike.w, label: TYPES[it.bike.t].l, ftp: profile().ftp } : null;
}

async function open() {
  $("title").textContent = "Mon plan";
  const ok = await Recup.ensure("plan", () => open());
  if (!ok) return;
  render();
}
window.Plan = { open, ftp: () => profile().ftp, plannedFor, hardRide: a => hardRide(a, profile().ftp), TYPES, isKey, _build: build, _zwo: zwo, _gen: genWeek, _eff: effective, _cfg: getCfg, _phase: phase };
if (importLink() && Recup.curTab() === "plan") dispatchEvent(new HashChangeEvent("hashchange"));
document.addEventListener("velo:loaded", () => { if (Recup.curTab() === "plan") open(); });
let rt3, lw3 = innerWidth; addEventListener("resize", () => { if (innerWidth === lw3) return; lw3 = innerWidth; clearTimeout(rt3); rt3 = setTimeout(() => { if (Recup.curTab() === "plan" && PS.W) render(); }, 200); });
if (Recup.curTab() === "plan") open();
})();
