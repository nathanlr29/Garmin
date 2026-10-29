"use strict";
// Onglet « Synthèse » : cinq questions, chacune avec UNE phrase-réponse calculée en français courant, puis le chiffre avec son repère :
//   1. Est-ce que je progresse ? (niveau d'entraînement)  2. Que faire aujourd'hui ? (fraîcheur + récup + séance prévue)
//   3. Où j'en suis de mes objectifs ?  4. Quelque chose cloche ?  5. Ma semaine. Puis « Détails » (replié) : courbes, charge par semaine, projections, historique des alertes.
// Vocabulaire : niveau d'entraînement (CTL), fatigue récente (ATL), fraîcheur (TSB). Les sigles CTL / ATL / TSB / TSS n'apparaissent jamais dans la page.
// Deux parties : des fonctions pures (testées par tests/synthese.mjs, exposées dans Synthese._) puis le rendu.
// Données : Charge (dayLoadsBySport, series, fitness), Recup (profile, jours), Plan (FTP, séance prévue). Même style SVG que Bilan.progress et la carte Progression course.
(() => {
const DAY = 864e5;

// ------------------------------------------------------------------ Constantes
// Le niveau (CTL), la fatigue récente (ATL) et la fraîcheur (TSB) sont calculés comme la carte Forme du Plan : 120 jours glissants (Charge.series).
// Une série sur 365 jours donnerait un niveau plus haut (≈ +4 points aujourd'hui) : on garde la définition du Plan partout,
// y compris pour la courbe et les variations, pour que le chiffre en grand soit EXACTEMENT celui du Plan.
// Amorce : chaque point de la courbe est calculé sur les 120 jours qui le précèdent ; un point n'est affiché que si ces 120 jours existent
// dans l'historique (sinon la courbe partirait de 0 et montrerait une fausse montée au début). Le point d'aujourd'hui est toujours gardé.
const FIT_DAYS = 120;
const PERIODS = [[3, 92], [6, 183], [12, 365]];           // puces de la courbe : mois → jours
const SHARE_DAYS = 30, WEEKS = 12;                          // répartition par sport : barre sur 30 jours, 12 semaines empilées
const MIN_SESSION = 600;                                    // « séance » de la ligne « Ta semaine » : 10 min et plus
const SPORTS = [["bike", "Vélo", "var(--accent)"], ["run", "Course", "var(--info)"], ["strength", "Muscu", "var(--z7)"], ["other", "Autre", "var(--ghost)"]];
const LINE = { ctl: "var(--accent)", atl: "#e0457b", tsb: "var(--good)" };
const RECUP_COL = ["var(--good)", "var(--info)", "var(--warn)", "var(--bad)"];   // états du score de récup : dans l'onglet Récup (html.night), --teal / --accent-2 / --amber / --rose ont les mêmes valeurs
const K_PERIOD = "synPeriod", K_DETAILS = "synDetails";
const READY_LOW = 45;                                       // récup du jour sous 45 : seuil du Plan (clé déplacée ou remplacée)
const TREND = { stablePct: 3 };                             // niveau à ±3 % de celui d'il y a 30 jours = « stable »
const CURVE_DAYS = 183;                                     // mini-courbe du niveau : 6 mois
const BAND = { good: "var(--good)", mid: "var(--warn)", bad: "var(--bad)" };
// Objectifs de fin d'année (projection) : ceux du Plan (carte objectifs, modifiables), GOALS seulement si le Plan n'est pas chargé
const GOALS = { ftp: 300, vo2: 65, date: "2026-12-31" };
const PROJ = { days: 120, justFrac: .6, ftpDec: 0, vo2Dec: 1 };   // tendance sur 120 jours ; « un peu juste » si le rythme actuel couvre au moins 60 % du rythme nécessaire
// FTP mesurée, comme le Plan (detectFtp) : meilleur 20 min × 95 % ou meilleur 1 h, sur 4 semaines glissantes, un point par semaine.
// Ni test rampe ni FTP Garmin : chez toi ils surestiment la FTP (rampe 260-304 W pour un meilleur 20 min de 228 W en 2026).
const ULTRA = { km: 250, kmh: 28, weeks: 8 };   // objectif ultra : 250 km à 28 km/h ; regarde la plus longue sortie dehors des 8 dernières semaines
const PAL = { ss: ["sweet spot", 6], thr: ["seuil", 7], vo2r: ["VO2max", 5] };   // programme FTP du Plan : nom et nombre de paliers (STEPS de plan.js, vérifié par le test)
const FTPM = { win: 28, step: 7, f20: .95, gap: 1.05 };   // gap : FTP du Plan plus de 5 % au-dessus de la mesure → conseiller le test 20 min
// Détecteurs (« frais cachés »)
const DET = { grayDays: 14, grayMin: 3, grayShare: .2, grayRunIF: .85, graySessionSec: 1200,   // zone grise : ≥ 3 séances non dures avec > 20 % du temps en zone 3 sur 14 jours
  loadAcute: 7, loadChronic: 28, loadRatio: 1.5,                                                // charge des 7 derniers jours / moyenne hebdo des 28 jours d'avant
  hrvDays: 3,                                                                                   // VFC sous la normale Garmin (hrvLo) 3 jours de suite
  sleepNights: 7, sleepBase: 60, sleepBaseMin: 20, sleepDebtSec: 3 * 3600,                      // dette de sommeil : > 3 h sur 7 nuits par rapport à la médiane des 60 nuits d'avant
  history: 90 };                                                                                // jours d'historique des alertes
const K_RELEVE = "synReleve:";   // + date du lundi : relevé refermé

// ------------------------------------------------------------------ Fonctions pures
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t; };
const ymd = d => window.Charge.ymd(d);
const mondayOf = d => window.Charge.mondayOf(d);

// fond / fatigue / forme tels que la carte Forme du Plan les affiche pour le jour t (charges des 120 jours d'avant, le jour t exclu)
function fitAt(loads, t) { const s = window.Charge.series(loads, new Date(t), FIT_DAYS); return { ctl: s.ctl, atl: s.atl, tsb: s.tsb }; }
// une valeur par jour sur les n derniers jours, aujourd'hui compris (le dernier point = Charge.fitness(aujourd'hui)).
// firstT : date de la première activité connue ; sans elle, tous les points sont gardés. Un point n'est gardé que si ses 120 jours d'amorce
// sont dans l'historique (jour − 120 j ≥ première activité), sauf aujourd'hui (toujours gardé : c'est le chiffre de la carte Forme du Plan).
function fitSeries(loads, today, n, firstT) {
  const day = dayStart(today), out = [], lim = firstT == null ? null : dayStart(firstT).getTime();
  for (let i = n - 1; i >= 0; i--) {
    const t = addDays(day, -i).getTime();
    if (i && lim != null && t - FIT_DAYS * DAY < lim) continue;
    out.push({ t, ...fitAt(loads, i ? new Date(t) : today) });
  }
  return out;
}
// variation entre le dernier point et celui d'il y a k jours : en points et en % de la valeur de départ
function variation(ser, k, key) {
  if (ser.length <= k) return null;
  const cur = ser[ser.length - 1][key], ref = ser[ser.length - 1 - k][key];
  return { cur, ref, delta: cur - ref, pct: ref ? (cur - ref) / Math.abs(ref) * 100 : null };
}
// même libellé que la carte Forme du Plan
function formLabel(tsb) { return tsb > 5 ? "frais" : tsb > -10 ? "équilibré" : tsb > -25 ? "chargé" : "très chargé"; }

// Répartition de la charge par sport sur les `days` derniers jours (aujourd'hui compris)
function sportShare(daily, today, days = SHARE_DAYS) {
  const out = { bike: 0, run: 0, strength: 0, other: 0 }, day = dayStart(today);
  for (let i = 0; i < days; i++) { const e = daily[ymd(addDays(day, -i))]; if (e) for (const k in out) out[k] += e[k] || 0; }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  return { ...out, total, pct: Object.fromEntries(Object.keys(out).map(k => [k, total ? out[k] / total * 100 : 0])) };
}
// Charge par semaine (lundi-dimanche) et par sport, sur n semaines dont la semaine en cours
function weeklyBySport(daily, today, n = WEEKS) {
  const m0 = mondayOf(today), W = Array.from({ length: n }, (_, i) => ({ t: addDays(m0, -7 * (n - 1 - i)).getTime(), bike: 0, run: 0, strength: 0, other: 0, total: 0 }));
  for (const k in daily) { const [y, m, d] = k.split("-").map(Number), dt = new Date(y, m - 1, d); if (dt > today) continue;
    const i = Math.round((m0 - mondayOf(dt)) / (7 * DAY)); if (i < 0 || i >= n) continue; const w = W[n - 1 - i];
    for (const s of ["bike", "run", "strength", "other"]) { w[s] += daily[k][s] || 0; w.total += daily[k][s] || 0; } }
  return W;
}
// Ta semaine : la semaine en cours (lundi → aujourd'hui) contre la moyenne des 4 semaines complètes d'avant
function weekStats(acts, today, tssOf) {
  const m0 = mondayOf(today), blank = () => ({ hours: 0, tss: 0, n: 0, bike: 0, run: 0, strength: 0, other: 0 }), cur = blank(), prev = Array.from({ length: 4 }, blank), to = Array.from({ length: 4 }, blank);
  const dow = (today.getDay() + 6) % 7;   // lundi = 0 : « à ce stade de la semaine » = jusqu'au même jour de la semaine
  for (const a of acts) {
    if (!(a.mt >= MIN_SESSION) || a.dt > today) continue;
    const i = Math.round((m0 - mondayOf(a.dt)) / (7 * DAY)); if (i < 0 || i > 4) continue;
    const t = tssOf(a), sp = window.Charge.sportOf(a), add = w => { w.hours += a.mt / 3600; w.tss += t; w.n++; w[sp]++; };
    if (i === 0) add(cur); else { add(prev[i - 1]); if ((a.dt.getDay() + 6) % 7 <= dow) add(to[i - 1]); }
  }
  const mean = ws => Object.fromEntries(Object.keys(cur).map(k => [k, ws.reduce((s, w) => s + w[k], 0) / 4]));
  return { cur, avg: mean(prev), avgTo: mean(to), prev };
}
// variation en % d'une valeur par rapport à sa moyenne (null si la moyenne est nulle)
const vsAvg = (v, avg) => avg > 0 ? (v / avg - 1) * 100 : null;

// Indicateurs : valeur courante et variation sur 30 jours d'une liste [[date, valeur]] (dernière valeur connue à la date de référence)
const dayMs = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
function listSeries(list) { return (list || []).map(r => ({ t: dayMs(r[0]), v: typeof r[1] === "number" && isFinite(r[1]) ? r[1] : null })).filter(p => p.v != null && !isNaN(p.t)).sort((a, b) => a.t - b.t); }
function valueBefore(ser, t) { let v = null; for (const p of ser) { if (p.t <= t) v = p; else break; } return v; }
function listVariation(ser, now, days, cur) {
  if (!ser.length) return null;
  const c = cur != null ? cur : ser[ser.length - 1].v, ref = valueBefore(ser, now - days * DAY);
  return ref ? { cur: c, ref: ref.v, delta: c - ref.v, pct: ref.v ? (c - ref.v) / ref.v * 100 : null } : null;
}
// score de récup : couleur identique à celle de l'onglet Récup
const recupColor = s => s >= 75 ? RECUP_COL[0] : s >= 50 ? RECUP_COL[1] : s >= 25 ? RECUP_COL[2] : RECUP_COL[3];


// ------------------------------------------------------------------ Fonctions pures : projection (4b)
const median = a => { const v = a.slice().sort((x, y) => x - y), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };
// Tendance robuste de Theil-Sen : pente = médiane des pentes de toutes les paires, ordonnée = médiane des y − pente × x.
// Un point isolé (un test raté, un 292 → 260) ne la fait pas basculer. pts : [{ x, y }] (x en jours).
function theilSen(pts) {
  if (pts.length < 3) return null;
  const sl = []; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j].x !== pts[i].x) sl.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
  if (!sl.length) return null;
  const slope = median(sl), intercept = median(pts.map(p => p.y - slope * p.x)); return { slope, intercept };
}
// FTP mesurée d'une sortie vélo : max(20 min × 95 %, 1 h) ; { v, w, l } ou null
function ftpOf(a) {
  const pc = a.pc || {}, c = [[pc["1200"] * FTPM.f20, pc["1200"], "20 min"], [pc["3600"], pc["3600"], "1 h"]].filter(r => r[1] > 0);
  if (!c.length) return null; const b = c.reduce((x, y) => y[0] > x[0] ? y : x); return { v: Math.round(b[0]), w: b[1], l: b[2] };
}
// Série de FTP mesurée : un point par semaine (aujourd'hui, −7 j, −14 j…) = meilleure FTP mesurée des 28 jours qui finissent ce jour-là.
// Un point n'est gardé que si ses 28 jours sont couverts par l'historique de puissance (première sortie avec des puissances), sinon
// le premier point ne verrait que quelques sorties. Chaque point garde la sortie retenue (a) pour l'infobulle.
function ftpPoints(acts, now) {
  const rides = acts.filter(a => a.pc && window.Charge.sportOf(a) === "bike" && a.dt.getTime() <= now).map(a => ({ a, t: a.dt.getTime(), m: ftpOf(a) })).filter(r => r.m);
  if (!rides.length) return [];
  const first = Math.min(...rides.map(r => r.t)), out = [];
  for (let e = now; e - FTPM.win * DAY >= first; e -= FTPM.step * DAY) {
    let best = null; for (const r of rides) if (r.t > e - FTPM.win * DAY && r.t <= e && (!best || r.m.v > best.m.v)) best = r;
    if (best) out.push({ t: e, v: best.m.v, w: best.m.w, l: best.m.l, a: best.a });
  }
  return out.reverse();
}
// Objectifs : ceux du Plan (planCfg.goal), validés ; sinon GOALS
function goalsFrom(g) {
  const ok = g && typeof g === "object", ftp = ok && +g.ftp >= 100 && +g.ftp <= 600 ? +g.ftp : GOALS.ftp, vo2 = ok && +g.vo2 >= 30 && +g.vo2 <= 90 ? +g.vo2 : GOALS.vo2;
  const date = ok && /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") && !isNaN(dayMs(g.date)) ? g.date : GOALS.date;
  return { ftp, vo2, date, plan: !!ok };
}
// Projection vers un objectif. ser : [{ t, v }] ; cur : valeur actuelle (la FTP utilisée par le Plan, la dernière VO2max) ; tendance sur les 120 derniers jours.
// Le rythme actuel est la pente de Theil-Sen ; verdict : atteint / dans les temps / un peu juste / hors de portée au rythme actuel.
// anchor : la tendance tracée passe par la valeur actuelle (FTP du Plan) avec la pente des mesures, au lieu de l'ordonnée de Theil-Sen.
function projection(ser, goal, dateStr, now, cur, dec = 0, anchor = false) {
  const t0 = now - PROJ.days * DAY, pts = ser.filter(p => p.t >= t0 && p.t <= now).map(p => ({ x: (p.t - now) / DAY, y: p.v })), ts = theilSen(pts);
  const end = dayMs(dateStr), daysLeft = (end - now) / DAY, weeksLeft = Math.max(daysLeft / 7, 0), base = cur != null ? cur : pts.length ? pts[pts.length - 1].y : null;
  if (!ts || base == null) return null;
  const rate = ts.slope * 7, projected = base + ts.slope * Math.max(daysLeft, 0), need = weeksLeft > 0 ? (goal - base) / weeksLeft : null, f = x => Math.round(x * 10 ** dec) / 10 ** dec;
  let verdict = base >= goal ? "atteint" : weeksLeft <= 0 ? "hors de portée au rythme actuel" : projected >= goal ? "dans les temps" : rate > 0 && rate >= PROJ.justFrac * need ? "un peu juste" : "hors de portée au rythme actuel";
  return { n: pts.length, slope: ts.slope, intercept: ts.intercept, rate, cur: base, projected, need, weeksLeft, verdict, goal, end,
    anchor, trendAt: x => (anchor ? base : ts.intercept) + ts.slope * x, text: { cur: f(base), projected: f(projected), rate: f(rate * 10) / 10, need: need == null ? null : f(need * 10) / 10 } };
}

// ------------------------------------------------------------------ Fonctions pures : détecteurs (4b)
// ctx : { acts, loads (Charge.dayLoads), days (jours Récup), hardRide(a), tssOf(a) }. Chaque détecteur est évalué « au jour asOf » :
// { active, status: "ok" | "actif" | "nodata", … }. Les mêmes fonctions servent à l'historique des 90 jours.
const endOfDay = d => { const t = dayStart(d); t.setHours(23, 59, 59, 999); return t; };
const keyOf = d => ymd(new Date(d));
function detGray(ctx, asOf) {
  const end = endOfDay(asOf), from = new Date(end.getTime() - DET.grayDays * DAY), hit = [];
  for (const a of ctx.acts) {
    if (a.dt <= from || a.dt > end || !(a.mt >= DET.graySessionSec)) continue;
    const sp = window.Charge.sportOf(a); let share = null;
    if (sp === "bike") { if (ctx.hardRide(a) || !a.pz || !a.pz.some(v => v > 0)) continue; share = a.pz[2] / a.pz.reduce((s, v) => s + v, 0); }
    else if (sp === "run") { const IF = Math.sqrt(ctx.tssOf(a) / (a.mt / 3600) / 100); if (!(IF < DET.grayRunIF) || !a.hz || !a.hz.some(v => v > 0)) continue; share = a.hz[2] / a.hz.reduce((s, v) => s + v, 0); }
    else continue;
    if (share > DET.grayShare) hit.push({ a, share });
  }
  return { active: hit.length >= DET.grayMin, status: hit.length >= DET.grayMin ? "actif" : "ok", count: hit.length, hit };
}
function detLoad(ctx, asOf) {
  const day = dayStart(asOf), sum = (i0, i1) => { let s = 0; for (let i = i0; i <= i1; i++) s += ctx.loads[keyOf(addDays(day, -i))] || 0; return s; };
  const acute = sum(0, DET.loadAcute - 1), chronic = sum(DET.loadAcute, DET.loadAcute + DET.loadChronic - 1) / (DET.loadChronic / 7);
  if (!(chronic > 0)) return { active: false, status: "nodata", acute, chronic, ratio: null };
  const ratio = acute / chronic; return { active: ratio > DET.loadRatio, status: ratio > DET.loadRatio ? "actif" : "ok", acute, chronic, ratio };
}
function detHrv(ctx, asOf) {
  const day = dayStart(asOf), vals = [];
  for (let i = 0; i < DET.hrvDays; i++) { const k = keyOf(addDays(day, -i)), d = ctx.days.find(x => x.d === k); if (!d || typeof d.hrv !== "number" || typeof d.hrvLo !== "number") return { active: false, status: "nodata", vals }; vals.push({ d: k, hrv: d.hrv, lo: d.hrvLo }); }
  const low = vals.every(v => v.hrv < v.lo); return { active: low, status: low ? "actif" : "ok", vals };
}
function detSleep(ctx, asOf) {
  const key = keyOf(asOf), nights = ctx.days.filter(d => d.sl > 0 && d.d <= key), last = nights.slice(-DET.sleepNights), base = nights.slice(-DET.sleepNights - DET.sleepBase, -DET.sleepNights);
  const oldest = new Date(last.length ? dayMs(last[0].d) : 0);
  if (last.length < DET.sleepNights || base.length < DET.sleepBaseMin || (dayStart(asOf) - oldest) / DAY > DET.sleepNights + 3) return { active: false, status: "nodata", debt: null };
  const med = median(base.map(d => d.sl)), debt = last.reduce((s, d) => s + Math.max(0, med - d.sl), 0);
  return { active: debt > DET.sleepDebtSec, status: debt > DET.sleepDebtSec ? "actif" : "ok", debt, med, nights: last.length };
}
// respiration de la nuit au-dessus de ta normale (règle de l'onglet Récup, Recup._.respAt) : 2 nuits de suite, ou une nuit avec cœur au repos haut ou VFC basse
function detResp(ctx, asOf) {
  const k = keyOf(asOf), i = ctx.days.findIndex(d => d.d === k), r = i >= 0 && ctx.respAt ? ctx.respAt(ctx.days, i) : null;
  if (!r || r.level === "nobase") return { active: false, status: "nodata" };
  const on = r.level === "alert"; return { active: on, status: on ? "actif" : "ok", ...r };
}
const DETECTORS = [["gray", "Zone grise", detGray, "Séances ni faciles ni dures"], ["load", "Charge qui monte trop vite", detLoad, "Charge qui monte trop vite"], ["hrv", "VFC basse", detHrv, "VFC basse"], ["sleep", "Dette de sommeil", detSleep, "Dette de sommeil"], ["resp", "Respiration de nuit haute", detResp, "Respiration de nuit haute"]];
// dernière alerte et nombre de jours en alerte sur les 90 derniers jours
function alertHistory(fn, ctx, today, n = DET.history) {
  const day = dayStart(today); let last = null, count = 0;
  for (let i = 0; i < n; i++) { const d = i ? addDays(day, -i) : today, r = fn(ctx, d); if (r.active) { count++; if (!last) last = addDays(day, -i).getTime(); } }
  return { last, count, n };
}
const detectAll = (ctx, asOf) => Object.fromEntries(DETECTORS.map(([k, , fn]) => [k, fn(ctx, asOf)]));

// ------------------------------------------------------------------ Fonctions pures : relevé de la semaine (le lundi)
// Le relevé de la semaine dernière est affiché le lundi et le mardi
const showReleve = today => [1, 2].includes(today.getDay());
function weekReport(ctx, today, plan) {
  const m1 = mondayOf(today), m0 = addDays(m1, -7), end = addDays(m1, -1);   // semaine dernière : m0 (lundi) → end (dimanche)
  const inWeek = ctx.acts.filter(a => a.dt >= m0 && a.dt < m1), per = { bike: { n: 0, km: 0, tss: 0 }, run: { n: 0, km: 0, tss: 0 }, strength: { n: 0, km: 0, tss: 0 }, other: { n: 0, km: 0, tss: 0 } };
  let hours = 0, tss = 0;
  for (const a of inWeek) { if (!(a.mt >= MIN_SESSION)) continue; const sp = window.Charge.sportOf(a), t = ctx.tssOf(a); per[sp].n++; per[sp].km += a.km; per[sp].tss += t; hours += a.mt / 3600; tss += t; }
  const f0 = fitAt(ctx.loads, m0), f1 = fitAt(ctx.loads, m1);
  let planned = 0, done = 0, hasPlan = false;
  if (plan) for (let i = 0; i < 7; i++) { const d = addDays(m0, i), p = plan.plannedFor(ymd(d)); if (p) { hasPlan = true; if (plan.isKey(p.t)) planned++; } }
  if (plan) done = inWeek.filter(a => window.Charge.sportOf(a) === "bike" && plan.hardRide(a)).length;
  const alerts = []; for (const [k, , fn, name] of DETECTORS) { let act = null; for (let i = 0; i < 7; i++) { const d = addDays(m0, i); if (fn(ctx, d).active) act = d.getTime(); } if (act != null) alerts.push({ k, name, last: act }); }
  return { m0, end, hours, tss, per, niveau: { from: f0.ctl, to: f1.ctl, delta: f1.ctl - f0.ctl }, keys: { planned, done, hasPlan }, alerts, n: inWeek.filter(a => a.mt >= MIN_SESSION).length };
}


// ------------------------------------------------------------------ Fonctions pures : phrases-réponses (4-bis)
// Texte en français courant, calculé. Les nombres sont écrits avec leur propre formateur (pas de dépendance au DOM).
const num = (v, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgnT = (v, d = 0) => Math.abs(v) < 5 * Math.pow(10, -d - 1) ? num(0, d) : `${v < 0 ? "−" : "+"}${num(Math.abs(v), d)}`;
const dayMonth = t => { const d = new Date(t); return `${d.getDate() === 1 ? "1er" : d.getDate()} ${d.toLocaleDateString("fr-FR", { month: "long" })}`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// 4,5 h → « 4 h 30 » ; moins d'une heure → « 45 min »
function hmTxt(h) { const m = Math.round(h * 60), H = Math.floor(m / 60), M = m % 60; return H ? `${H} h ${String(M).padStart(2, "0")}` : `${M} min`; }
const peakOf = (ser, key) => ser.reduce((b, p) => !b || p[key] > b[key] ? p : b, null);
const clamp01 = v => Math.max(0, Math.min(100, v));

// 1. Est-ce que je progresse ? Mot (hausse / stable / baisse) selon la variation du niveau sur 30 jours ; repère principal = pic de la période
function trendWord(v30) {
  if (!v30) return null;
  const p = v30.pct != null ? v30.pct : (v30.delta > 0 ? 100 : v30.delta < 0 ? -100 : 0);
  return p > TREND.stablePct ? "en hausse" : p < -TREND.stablePct ? "en baisse" : "stable";
}
function progress(ser) {
  const f = ser[ser.length - 1], v30 = variation(ser, 30, "ctl"), pk = peakOf(ser, "ctl"), word = trendWord(v30), share = pk && pk.ctl > 0 ? f.ctl / pk.ctl * 100 : null;
  const atPeak = share != null && (share >= 97 || f.t === pk.t);
  let text = `Ton niveau d'entraînement est de ${num(f.ctl)}`;
  if (word === "stable") text += ", stable sur 30 jours"; else if (word) text += `, ${word} sur 30 jours (${sgnT(v30.delta)})`;
  if (atPeak) text += ", à ton plus haut de l'année"; else if (share != null) text += `, à ${num(share)} % de ton pic de l'année (${num(pk.ctl)}, le ${dayMonth(pk.t)})`;
  return { text: text + ".", word, v30, peak: pk && { v: pk.ctl, t: pk.t }, share, atPeak, cur: f.ctl };
}

// 2. Que faire aujourd'hui ? Seuils du Plan : fraîcheur (frais > 5, équilibré > −10, chargé > −25, très chargé), récup du jour < 45 = basse.
// o : { tsb, reco (score du jour ou null), hrvLow (VFC basse 3 jours), planned ({ label, dur, hard } ou null ; label = titre avec le palier, « Sweet spot #2 · 3 × 10' », si la séance en a un),
//       done (séances déjà faites aujourd'hui : [{ label, min, plan }], plan = séance du Plan, sinon sortie en plus) }
// Séance du jour faite : la phrase le dit et passe à la récup ; s'il reste une séance prévue (vélo + course), le conseil porte sur elle.
const doneList = L => cap(L.map(x => `${x.plan ? "séance" : "sortie"} « ${x.label} »${x.min ? ` (${x.min} min)` : ""}`).join(" et ")) + ` faite${L.length > 1 ? "s" : ""} ✓`;
function advice(o) {
  const lab = formLabel(o.tsb), tired = lab === "chargé" || lab === "très chargé", reco = o.reco, recoLow = reco != null && reco < READY_LOW;
  const pl = o.planned, sess = pl ? `ta séance « ${pl.label} »${pl.dur ? ` de ${pl.dur} min` : ""} prévue ce soir` : null, hard = !!(pl && pl.hard);
  const reasons = [];
  if (tired) reasons.push(lab === "très chargé" ? "fatigue récente très élevée" : "fatigue récente élevée");
  if (recoLow) reasons.push("récup basse"); else if (reco != null && reco < 65) reasons.push("récup moyenne");
  if (o.hrvLow) reasons.push("VFC basse");
  const bad = recoLow || lab === "très chargé" || (tired && o.hrvLow), mid = !bad && reasons.length > 0, why = reasons.join(" et ");
  const done = (o.done || []).filter(Boolean);
  if (done.length && !pl) return { text: `${doneList(done)}. ` + (reasons.length ? `${cap(why)} : récupère bien ce soir, mange bien et couche-toi tôt.` : "C'est bouclé pour aujourd'hui : place à la récup."), tone: "good", label: lab, reasons, done: true };
  let tone, text;
  if (bad) {
    tone = "bad";
    text = `${cap(why)} : ` + (hard ? `${sess} est à alléger ou à décaler.` : "garde la séance facile, ou prends un jour de repos.");
  } else if (mid) {
    tone = "mid";
    text = `${cap(why)} : ` + (hard ? `${sess} reste jouable, mais coupe-la si les jambes tirent.` : pl ? `${sess} passe, sans chercher à en faire plus.` : "une séance tranquille est le bon choix.");
  } else {
    tone = "good";
    const state = lab === "frais" ? `Tu es frais${reco != null ? " et bien récupéré" : ""}` : `Ta fraîcheur est correcte${reco != null ? " et tu es bien récupéré" : ""}`;
    text = `${state} : ` + (hard ? `bon jour pour ${sess}.` : pl ? `${sess} se fait sans souci.` : lab === "frais" ? "bon jour pour une séance intense si tu en as envie." : "une séance normale passe bien.");
  }
  if (done.length) text = `${doneList(done)}. ${text}`;
  return { text, tone, label: lab, reasons };
}

// séances du jour pour advice() : pl = Plan.plannedFor(jour) (vélo, avec `run` si une course est aussi prévue, ou course seule), acts = Plan.doneOn(jour).
// planned = la première séance prévue pas encore faite (ni ratée), done = séances du Plan faites puis sorties en plus
function todaySessions(pl, TYPES, acts) {
  const S = pl ? [pl.sport === "run" ? null : pl, pl.sport === "run" ? pl : pl.run].filter(Boolean) : [], used = new Set();
  const min = L => Math.round(L.reduce((n, a) => n + (a.mt || 0), 0) / 60) || null;
  const lab = p => p.w && /#\d/.test(p.w.title || "") ? p.w.title : p.label;
  const done = S.filter(p => p.st === "done").map(p => { (p.acts || []).forEach(a => used.add(a.id)); return { label: lab(p), min: min(p.acts || []), plan: true }; });
  (acts || []).filter(a => !used.has(a.id)).forEach(a => done.push({ label: a.n || "sans nom", min: min([a]), plan: false }));
  const left = S.find(p => p.st !== "done" && p.st !== "missed");
  return { planned: left ? { label: lab(left), dur: left.dur, hard: !!(TYPES[left.t] && TYPES[left.t].hard) } : null, done };
}

// 3. Où j'en suis de mes objectifs ? Départ = valeur connue au 1er janvier (sinon la première de l'année), arrivée = objectif, repère = part du chemin faite
function objective(ser, cur, goal, now) {
  const y0 = new Date(new Date(now).getFullYear(), 0, 1).getTime(), st = valueBefore(ser, y0) || ser.find(p => p.t >= y0 && p.t <= now);
  if (!st || cur == null || !(goal > st.v)) return null;
  const pct = (cur - st.v) / (goal - st.v) * 100;
  return { start: st.v, startT: st.t, cur, goal, pct, bar: clamp01(pct), reached: cur >= goal };
}
const VERDICT_TXT = { "atteint": "Objectif atteint", "dans les temps": "Dans les temps", "un peu juste": "Un peu juste", "hors de portée au rythme actuel": "Hors de portée au rythme actuel" };
const endLabel = dateStr => { const [, m, d] = dateStr.split("-"); return `${d}/${m}`; };
// « Au rythme actuel : ~232 W au 31/12. Il faudrait +9,4 W/semaine (tu fais +1,2). »
function objLine(P, unit, dec, date = GOALS.date) {
  if (!P) return "Pas assez de mesures sur les 120 derniers jours pour projeter.";
  if (P.verdict === "atteint") return "Objectif atteint.";
  const u = unit ? " " + unit : "", d = dec ? 2 : 1;
  return `Au rythme actuel : ~${num(P.projected, dec)}${u} au ${endLabel(date)}. Il faudrait ${sgnT(P.need, d)}${u}/semaine (${Math.abs(P.rate) < 5 * 10 ** (-d - 1) ? "tu stagnes" : `tu fais ${sgnT(P.rate, d)}`}).`;
}
// FTP du Plan contre la dernière mesure : « FTP du Plan : 240 W. Ta meilleure mesure des 4 dernières semaines : 196 W (20 min à 206 W, le 3 oct.). … »
function ftpCheckLine(cur, last) {
  if (!last) return cur ? `FTP du Plan : ${num(cur)} W. Aucun effort de 20 min ou 1 h mesuré ces 4 dernières semaines : fais le test 20 min pour la vérifier.` : "";
  const when = new Date(last.a.dt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), meas = `${num(last.v)} W (${last.l} à ${num(last.w)} W, le ${when})`;
  if (!cur) return `Ta meilleure mesure des 4 dernières semaines : ${meas}.`;
  const gap = (1 - last.v / cur) * 100;
  if (cur > last.v * FTPM.gap) return `Mesurée sur 4 semaines : ${meas}, ${num(gap)} % sous ta FTP du Plan. Le test 20 min tranchera.`;
  if (cur < last.v / FTPM.gap) return `Mesurée sur 4 semaines : ${meas}, mieux que ta FTP du Plan : passe-la à ${num(last.v)} W.`;
  return `Mesurée sur 4 semaines : ${meas}, comme ta FTP du Plan.`;
}
// Ultra : plus longue sortie vélo dehors des 8 dernières semaines contre 250 km à 28 km/h (vitesse en mouvement) ; record de l'année en repère
function ultraStat(acts, now) {
  const y0 = new Date(new Date(now).getFullYear(), 0, 1).getTime(), out = acts.filter(a => a.t === "Ride" && a.m > 0 && a.mt > 0 && a.dt.getTime() <= now);
  const longest = l => l.reduce((b, a) => !b || a.m > b.m ? a : b, null), r = a => a && { km: a.m / 1000, kmh: a.m / a.mt * 3.6, t: a.dt.getTime(), a };
  return { last: r(longest(out.filter(a => a.dt.getTime() > now - ULTRA.weeks * 7 * DAY))), year: r(longest(out.filter(a => a.dt.getTime() >= y0))) };
}
function ultraLine(U) {
  const L = U.last, d = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const yr = U.year && (!L || U.year.km > L.km + 1) ? ` Record de l'année : ${num(U.year.km)} km le ${dayMonth(U.year.t)}.` : "";
  if (!L) return { ok: false, text: `Aucune sortie dehors ces ${ULTRA.weeks} dernières semaines.${yr}` };
  const dk = ULTRA.km - L.km, dv = ULTRA.kmh - L.kmh, ok = dk <= 0 && dv <= 0;
  const miss = [dk > 0 ? `${num(dk)} km` : "", dv > 0 ? `${num(dv, 1)} km/h` : ""].filter(Boolean).join(" et ");
  return { ok, text: `Plus longue sortie des ${ULTRA.weeks} dernières semaines : ${num(L.km)} km à ${num(L.kmh, 1)} km/h (${d(L.t)})${ok ? " : tu y es." : `, il manque ${miss}.`}${yr}` };
}
// Programme FTP du Plan (palLog) : paliers réussis et prochain palier de chaque échelle ; null sans suivi
function palSummary(log) {
  const L = (Array.isArray(log) ? log : []).filter(x => x && x.v === 2 && PAL[x.t] && Number.isInteger(x.k) && x.k >= 0 && x.k < PAL[x.t][1] && /^\d{4}-\d\d-\d\d$/.test(x.d || "")).sort((a, b) => a.d < b.d ? -1 : 1);
  if (!L.length) return null;
  const done = new Set(L.filter(x => x.ok).map(x => x.t + x.k)).size, total = Object.values(PAL).reduce((n, p) => n + p[1], 0);
  const next = Object.keys(PAL).map(t => { const r = L.filter(x => x.t === t).pop(), k = r ? Math.min(r.k + (r.ok ? 1 : 0), PAL[t][1] - 1) : 0; return `${PAL[t][0]} #${k + 1}`; });
  return `Programme FTP : ${done} palier${done > 1 ? "s" : ""} réussi${done > 1 ? "s" : ""} sur ${total}. Prochains : ${next.join(", ")}.`;
}
function objectivesAnswer(items) {   // items : [{ name, verdict }]
  const ok = items.filter(i => i.verdict);
  if (!ok.length) return "Pas assez de mesures pour juger tes objectifs de fin d'année.";
  const word = v => v === "atteint" ? "atteint" : v === "dans les temps" ? "dans les temps" : v === "un peu juste" ? "un peu juste" : "hors de portée au rythme actuel";
  if (ok.length > 1 && ok.every(i => i.verdict === ok[0].verdict)) return `Tes ${ok.length === 2 ? "deux " : ""}objectifs sont ${word(ok[0].verdict)}.`;
  return cap(ok.map(i => `l'objectif ${i.name} est ${word(i.verdict)}`).join(", ").replace(/, ([^,]*)$/, " et $1")) + ".";
}

// 4. Quelque chose cloche ?
function detAnswer(res) {
  const on = DETECTORS.filter(([k]) => res[k].active), nodata = DETECTORS.filter(([k]) => res[k].status === "nodata"), list = l => l.map(d => d[3].replace(/^\p{Lu}(?=\p{Ll})/u, c => c.toLowerCase())).join(", ").replace(/, ([^,]*)$/, " et $1");
  if (on.length) return `${on.length} point${on.length > 1 ? "s" : ""} d'attention : ${list(on)}.`;
  if (nodata.length === DETECTORS.length) return "Pas assez de données pour vérifier tes indicateurs pour l'instant.";
  return "Rien à signaler aujourd'hui" + (nodata.length ? ` (pas assez de données pour : ${list(nodata)}).` : ".");
}

// 5. Ma semaine : « Depuis lundi : 4 h 30, 3 séances (2 vélo, 1 course) : plus que d'habitude (3 h 50 à ce stade de la semaine). »
function weekAnswer(ws) {
  const { cur, avgTo } = ws, names = [["bike", "vélo"], ["run", "course"], ["strength", "muscu"], ["other", "autre"]];
  const hab = avgTo.hours > 0 ? ` (d'habitude ${hmTxt(avgTo.hours)} à ce stade de la semaine)` : "";
  if (!cur.n) return `Aucune séance depuis lundi${hab}.`;
  const kinds = names.filter(([k]) => cur[k] > 0).map(([k, l]) => `${cur[k]} ${l}`).join(", "), r = avgTo.hours > 0 ? cur.hours / avgTo.hours : null;
  const cmp = r == null ? "" : r > 1.15 ? " : plus que d'habitude" : r < .85 ? " : moins que d'habitude" : " : comme d'habitude";
  return `Depuis lundi : ${hmTxt(cur.hours)}, ${cur.n} séance${cur.n > 1 ? "s" : ""} (${kinds})${cmp}${r == null ? "" : ` (${hmTxt(avgTo.hours)} à ce stade de la semaine)`}.`;
}
function shareAnswer(sh) {
  if (!sh.total) return `Aucune séance sur les ${SHARE_DAYS} derniers jours.`;
  return `Sur ${SHARE_DAYS} jours : ` + SPORTS.filter(([k]) => sh[k] > 0).map(([k, l]) => `${num(sh.pct[k])} % ${l.toLowerCase()}`).join(" · ") + ".";
}

// Détails : titres qui disent quoi regarder
function partOfMonth(t) { const d = new Date(t), m = d.toLocaleDateString("fr-FR", { month: "long" }), n = d.getDate(); return n <= 10 ? `début ${m}` : n <= 20 ? `mi-${m}` : `fin ${m}`; }
function curveTitle(pts) {
  if (pts.length < 30) return "";
  const last = pts[pts.length - 1], pk = peakOf(pts, "ctl"), v30 = variation(pts, 30, "ctl"), word = trendWord(v30), drop = pk.ctl ? (last.ctl - pk.ctl) / pk.ctl * 100 : 0;
  if ((last.t - pk.t) / DAY <= 7 || drop > -3) return `Ton niveau est à son plus haut de la période (${num(pk.ctl)}).`;
  const tail = word === "stable" ? `puis s'est stabilisé, ${num(-drop)} % plus bas` : word === "en hausse" ? `puis a baissé de ${num(-drop)} %, il remonte depuis` : `puis a baissé de ${num(-drop)} %`;
  return `Ton niveau a culminé ${partOfMonth(pk.t)}, ${tail}.`;
}
function weeksTitle(W) {
  const cur = W[W.length - 1], prev = W.slice(0, -1).filter(w => w.total > 0), avg = prev.length ? prev.reduce((s, w) => s + w.total, 0) / prev.length : 0;
  if (!avg) return "Ta charge par semaine, tous sports.";
  const best = prev.reduce((b, w) => w.total > b.total ? w : b, prev[0]);
  return `Ta semaine la plus chargée : celle du ${dayMonth(best.t)} (${num(best.total / avg * 100)} % de ta moyenne).`;
}
function projTitle(name, P, unit, dec, date = GOALS.date) {
  if (!P) return `${name} : pas assez de mesures pour dégager une tendance.`;
  if (P.verdict === "atteint") return `${name} : objectif atteint.`;
  return `${name} : la tendance mène à ~${num(P.projected, dec)}${unit ? " " + unit : ""} au ${endLabel(date)}, pour un objectif de ${num(P.goal, dec)}${unit ? " " + unit : ""}.`;
}

// ------------------------------------------------------------------ Rendu : outils
const S_ = { period: 12, box: null };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const dLong = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dShort = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const sgn = (v, d = 0) => Math.abs(v) < 5 * Math.pow(10, -d - 1) ? nf(0, d) : `${v < 0 ? "−" : "+"}${nf(Math.abs(v), d)}`;   // un écart qui arrondit à zéro s'écrit « 0 », sans signe
const note = t => `<p class="note">${t}</p>`;
const col = v => v >= 0 ? "var(--good)" : "var(--bad)";
const esc_ = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// bouton « ? » qui déplie une explication de 1 à 2 phrases
const HELP = {
  niveau: "Moyenne de ta charge d'entraînement des 6 dernières semaines. Plus il est haut, plus tu encaisses de charge. Il monte lentement et redescend lentement.",
  fatigue: "La même moyenne, mais sur 7 jours seulement : elle grimpe vite après une grosse semaine et retombe vite avec du repos.",
  fraicheur: "Ton niveau moins ta fatigue récente. Positif : tu es reposé. Très négatif : tu accumules la fatigue, à surveiller.",
  recup: "Score de l'onglet Récup (sommeil, VFC, cœur au repos, charge des derniers jours). En dessous de 45, le Plan allège ou déplace la séance dure.",
};
const q = k => `<button type="button" class="syq" data-help="${k}" aria-expanded="false" aria-label="Explication">?</button>`;
const helpP = k => `<p class="syhelp" id="syh-${k}" hidden>${HELP[k]}</p>`;

// Courbes SVG (mêmes classes, couleurs et infobulles que Bilan.progress) : plusieurs séries sur des dates communes, repère à zéro, survol par date
function lines(box, o) {
  if (!box) return;
  const W = Math.max(280, box.clientWidth || 400), H = 210, m = { l: 40, r: 10, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const P = o.pts, t0 = P[0].t, t1 = P[P.length - 1].t, all = o.keys.flatMap(k => P.map(p => p[k])).concat([0]);
  const lo0 = Math.min(...all), hi0 = Math.max(...all), pad = (hi0 - lo0) * .08 || 1, lo = lo0 - pad, hi = hi0 + pad;
  const x = t => m.l + (t - t0) / Math.max(1, t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}"><g class="axis">`;
  const tk = niceTicks(hi - lo, 6), st = tk[1] || 10; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${nf(v === 0 ? 0 : v)}</text>`;
  const span = (t1 - t0) / (30.4375 * DAY), stepM = span > 8 ? 3 : span > 4 ? 2 : 1, d0 = new Date(t0);
  for (let k = 1; k < 40; k++) { const f = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (f.getTime() > t1) break; if (stepM > 1 && f.getMonth() % stepM) continue;
    s += `<text x="${x(f.getTime())}" y="${H - 5}" text-anchor="middle">${MONTHS[f.getMonth()]}${f.getMonth() === 0 ? " " + String(f.getFullYear()).slice(2) : ""}</text>`; }
  s += `</g><line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1" opacity=".6"/>`;
  for (const k of o.keys) s += `<path d="${P.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(p[k]).toFixed(1)).join("")}" fill="none" stroke="${o.colors[k]}" stroke-width="${k === o.keys[0] ? 2.6 : 1.8}" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<line class="syCur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" stroke-width="1" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="syHit"/></svg>`;
  box.innerHTML = s + `<div class="legend bm-leg">${o.legend}</div>`;
  const svg = box.querySelector("svg"), cur = box.querySelector(".syCur");
  const mv = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(P.length - 1, Math.round((px - m.l) / iw * (P.length - 1))));
    cur.setAttribute("x1", x(P[i].t)); cur.setAttribute("x2", x(P[i].t)); cur.setAttribute("opacity", .6); showTip(e, o.tip(P[i])); };
  svg.addEventListener("pointermove", mv); svg.addEventListener("pointerdown", mv); svg.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
}
function spark(ser, color = "var(--accent)") {
  if (ser.length < 2) return "";
  const W = 120, H = 34, t0 = ser[0].t, t1 = ser[ser.length - 1].t, lo = Math.min(...ser.map(p => p.v)), hi = Math.max(...ser.map(p => p.v)), r = hi - lo || 1;
  return `<svg viewBox="0 0 ${W} ${H}" class="crSpark" role="img" aria-label="Évolution"><path d="${ser.map((p, i) => (i ? "L" : "M") + (2 + (p.t - t0) / Math.max(1, t1 - t0) * (W - 4)).toFixed(1) + "," + (H - 3 - (p.v - lo) / r * (H - 6)).toFixed(1)).join("")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
// Mini-courbe du niveau (une seule courbe) avec le pic marqué et le point d'aujourd'hui
function miniCurve(box, pts, pk) {
  if (!box || pts.length < 2) return;
  const W = Math.max(280, box.clientWidth || 340), H = 108, m = { l: 6, r: 10, t: 16, b: 18 }, iw = W - m.l - m.r, ih = H - m.t - m.b, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const lo = Math.min(...pts.map(p => p.ctl)), hi = Math.max(...pts.map(p => p.ctl)), r = hi - lo || 1;
  const x = t => m.l + (t - t0) / Math.max(1, t1 - t0) * iw, y = v => m.t + ih - (v - lo) / r * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Niveau d'entraînement sur 6 mois" class="symini"><g class="axis">`;
  const d0 = new Date(t0); for (let k = 1; k < 9; k++) { const f = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (f.getTime() >= t1 - 10 * DAY) break; s += `<text x="${x(f.getTime())}" y="${H - 4}" text-anchor="middle">${MONTHS[f.getMonth()]}</text>`; }
  s += `</g><path d="${pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(p.ctl).toFixed(1)).join("")}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  const last = pts[pts.length - 1];
  if (pk && pk.t >= t0 && pk.t < last.t) { const px = x(pk.t), anchor = px > W - 60 ? "end" : px < 60 ? "start" : "middle";
    s += `<circle cx="${px}" cy="${y(pk.v)}" r="4" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/><text x="${px}" y="${Math.max(10, y(pk.v) - 8)}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="var(--ink)">pic ${num(pk.v)}</text>`; }
  s += `<circle cx="${x(last.t)}" cy="${y(last.ctl)}" r="4.4" fill="var(--accent)" stroke="var(--card)" stroke-width="1.5"/></svg>`;
  box.innerHTML = s;
}
// Jauge colorée avec repère. segs : [[borne haute, couleur, libellé]] du plus bas au plus haut ; good : borne basse de la zone « bon pour toi »
// « bon pour toi » au début de la zone verte, ou au bout de la jauge si le repère tomberait dessus (jusqu'à 26 % de large sur téléphone)
const goodLab = (g, m) => { const L = 26, at = (m < g - 4 || m > g + L) ? `left:${g}%` : (m < 100 - L - 4 ? "right:0" : null);
  return at ? `<em class="sygood" style="${at}">bon pour toi${at.startsWith("left") ? " ›" : ""}</em>` : ""; };
function gauge(v, min, max, segs, good, unitTxt) {
  const pos = x => clamp01((x - min) / (max - min) * 100);
  let lo = min; const bars = segs.map(([hi, c, l]) => { const w = pos(Math.min(hi, max)) - pos(lo), out = `<i style="width:${w}%;background:${c}" title="${l}"></i>`; lo = hi; return out; }).join("");
  const labs = (() => { let l0 = min; return segs.map(([hi, , l]) => { const a = pos(l0), b = pos(Math.min(hi, max)); l0 = hi; return `<span style="left:${(a + b) / 2}%">${l}</span>`; }).join(""); })();
  return `<div class="sygbar" role="img" aria-label="${unitTxt}"><div class="sygseg">${bars}</div>${good != null ? goodLab(pos(good), pos(v)) : ""}<b class="sygmark" style="left:${pos(v)}%"></b></div><div class="sygl">${labs}</div>`;
}
const FRAIS = { min: -40, max: 25, segs: [[-25, "var(--bad)", "très chargé"], [-10, "var(--warn)", "chargé"], [5, "var(--info)", "équilibré"], [25, "var(--good)", "frais"]], good: 5 };
const RECUPG = { min: 0, max: 100, segs: [[READY_LOW, RECUP_COL[3], "basse"], [65, RECUP_COL[2], "moyenne"], [100, RECUP_COL[0], "bonne"]], good: 65 };

// ------------------------------------------------------------------ Rendu : les cinq blocs
function blkProgress(D) {
  const P = D.prog; if (!P) return `<section class="card hud span12 syblk" id="syProg"><h2>Est-ce que je progresse ?</h2>${note("Pas encore assez d'historique pour calculer ton niveau d'entraînement.")}</section>`;
  const v = P.v30, arrow = !v ? "" : P.word === "en hausse" ? "↑" : P.word === "en baisse" ? "↓" : "→", c = P.word === "en hausse" ? "var(--good)" : P.word === "en baisse" ? "var(--bad)" : "var(--muted)";
  const ref = v ? `<span class="syvar" style="color:${c}">${Math.abs(v.delta) < .5 ? "inchangé" : `${sgn(v.delta)} pt${Math.abs(v.delta) >= 1.5 ? "s" : ""}${v.pct == null ? "" : ` (${sgn(v.pct)} %)`}`} en 30 jours</span>` : `<span class="syvar">variation sur 30 jours : pas assez de recul</span>`;
  const pk = P.peak ? `<small>${P.atPeak ? "ton plus haut de l'année" : `pic de l'année : ${nf(P.peak.v)} (${dayMonth(P.peak.t)}) · tu es à ${nf(P.share)} %`}</small>` : "";
  return `<section class="card hud span12 syblk" id="syProg"><h2>Est-ce que je progresse ?</h2><p class="syans">${P.text}</p>
    <div class="synum"><span class="crbig syctl">${nf(P.cur)}</span><div class="synumt"><span class="sylab">niveau d'entraînement ${q("niveau")}</span>${ref}${pk}</div></div>${helpP("niveau")}
    <div id="syMini"></div>${D.pal ? `<p class="syobl">${D.pal} <a href="#plan" data-go="plan" role="button">Voir dans le Plan</a></p>` : ""}</section>`;
}
function blkToday(D) {
  const A = D.adv, f = D.fit[D.fit.length - 1], rec = D.rec;
  const recRow = rec.score != null
    ? `<div class="sygauge"><div class="sygh"><span>Récup du jour ${q("recup")}</span><b style="color:${rec.color}">${nf(rec.score)}<small>/100</small></b><small>${esc_(rec.label || "")}${rec.today ? "" : ` · dernière nuit enregistrée (${dShort(rec.t)})`}</small></div>${gauge(rec.score, RECUPG.min, RECUPG.max, RECUPG.segs, RECUPG.good, "Récup du jour")}${helpP("recup")}</div>`
    : `<div class="sygauge"><div class="sygh"><span>Récup du jour</span><small>pas de nuit enregistrée</small></div></div>`;
  return `<section class="card span12 syblk" id="syToday"><h2>Que faire aujourd'hui ?</h2><p class="syans" style="--c:${BAND[A.tone]}">${A.text}</p>
    <div class="sygauges"><div class="sygauge"><div class="sygh"><span>Fraîcheur ${q("fraicheur")}</span><b style="color:${BAND[A.tone === "bad" ? "bad" : A.label === "chargé" ? "mid" : "good"]}">${f.tsb >= 0 ? "+" : ""}${nf(f.tsb)}</b><small>${A.label}</small></div>${gauge(f.tsb, FRAIS.min, FRAIS.max, FRAIS.segs, FRAIS.good, "Fraîcheur")}${helpP("fraicheur")}</div>${recRow}</div>
    <p class="syfatl">Fatigue récente : <b>${nf(f.atl)}</b> ${q("fatigue")} <span>contre un niveau de ${nf(f.ctl)} : ${f.atl > f.ctl ? "plus fatigué que ton habitude" : "moins fatigué que ton habitude"}</span></p>${helpP("fatigue")}</section>`;
}
function blkWx() {
  return `<section class="card span12 syblk" id="syWx" hidden><h2>Ce week-end, dehors ?</h2><div id="syWxBody"></div></section>`;
}
// prévisions Open-Meteo (gardées 1 h sur l'appareil), au point de départ des boucles s'il est réglé, sinon au centre de la ville de config.json ;
// coordonnées arrondies à 0,01° (≈ 1 km) : le point de départ n'est jamais envoyé exactement. En cas d'échec, la carte reste cachée.
// AROME HD de Météo-France (1,3 km, ~2 jours) heure par heure, le modèle par défaut au-delà et pour le risque de pluie (comme sortie.js)
function arome(h) {
  if (!h) return h; const out = { time: h.time };
  for (const k in h) { const m = /^(.+)_best_match$/.exec(k); if (!m) continue; const x = h[m[1] + "_meteofrance_arome_france_hd"];
    out[m[1]] = h[k].map((v, i) => x && x[i] != null ? x[i] : v); }
  return Object.keys(out).length > 1 ? out : h;
}
async function loadWx() {
  const box = document.getElementById("syWx"); if (!box) return;
  let st = null; try { st = JSON.parse(localStorage.getItem("soStart")); } catch (e) {}
  const cfg = (typeof S !== "undefined" && S.cfg) || {}, lat = st && isFinite(st.lat) ? st.lat : cfg.latitude ?? 48.1173, lon = st && isFinite(st.lon) ? st.lon : cfg.longitude ?? -1.6778;
  const days = weekendDays(Date.now()), a = ymd(days[0]), b = ymd(days[days.length - 1]), key = `${lat.toFixed(2)},${lon.toFixed(2)}|${a}|${b}`;
  let j = null; try { const c = JSON.parse(localStorage.getItem(K_WX)); if (c && c.key === key && Date.now() - c.at < WX.ttl) j = c.j; } catch (e) {}
  if (!j) {
    try { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m&start_date=${a}&end_date=${b}&timezone=Europe%2FParis&models=meteofrance_arome_france_hd,best_match`);
      if (!r.ok) return; const J = await r.json(); j = arome(J.hourly); if (!j) return; j.off = J.utc_offset_seconds; lsSet(K_WX, JSON.stringify({ key, at: Date.now(), j })); } catch (e) { return; }
  }
  const el = document.getElementById("syWx"); if (!el) return;
  const L = weekendWx(j, days); if (!L.some(d => d.ok)) return;
  const far = Math.round((days[0] - new Date(new Date().toDateString())) / DAY) >= WX.far;
  const tone = d => d.ok ? BAND[d.verdict] : "var(--ghost)";
  el.querySelector("#syWxBody").innerHTML = `<p class="syans">${weekendAnswer(L)}</p>
    <div class="sywx">${L.map(d => d.ok
      ? `<details class="sywxday"><summary class="sywxd"><span class="sydot2" style="background:${tone(d)}"></span><b>${cap1(dayName(d.dt))}</b><span>${wxLine(d)}</span></summary>${wxHoursHtml(d)}</details>`
      : `<div class="sywxd"><span class="sydot2" style="background:${tone(d)}"></span><b>${cap1(dayName(d.dt))}</b><span>${wxLine(d)}</span></div>`).join("")}</div>
    <p class="note">Touche un jour pour le détail heure par heure${cfg.latitude != null ? `, ou <a href="${wxMoreUrl(cfg.latitude, cfg.longitude)}" target="_blank" rel="noopener">prévisions complètes sur meteoblue</a>` : ""}.${far ? ` Prévisions à ${Math.round((days[0] - new Date(new Date().toDateString())) / DAY)} jours, encore incertaines : reviens jeudi ou vendredi.` : ""}</p>`;
  el.hidden = false;
}
function blkGoals(D) {
  const O = D.obj, G = O.goals, row = (name, o, P, unit, dec, extra = "") => {
    if (!o) return `<div class="syobj"><div class="syoh"><b>${name}</b></div>${note("Pas assez de mesures depuis le 1er janvier.")}${extra}</div>`;
    const u = unit ? " " + unit : "", vcol = P ? verdictCol(P.verdict) : "var(--muted)", ok = P && P.verdict === "atteint";
    return `<div class="syobj"><div class="syoh"><b>${name}</b>${P ? `<span class="syverd" style="color:${vcol}">${VERDICT_TXT[P.verdict]}</span>` : ""}</div>
      <div class="syprog" role="img" aria-label="${name} : ${nf(o.pct)} % du chemin"><div class="syfill" style="width:${o.bar}%;background:${ok ? "var(--good)" : "var(--accent)"}"></div><b class="symark" style="left:${o.bar}%"><span>${nf(o.cur, dec)}${u}</span></b></div>
      <div class="syscale"><span>${nf(o.start, dec)}${u} <small>${dShort(o.startT)}</small></span><span class="sypct">${o.pct < 0 ? "recul de " + nf(-o.pct) : nf(o.pct)} % du chemin</span><span>${nf(o.goal, dec)}${u}</span></div>
      <p class="syobl">${objLine(P, unit, dec, G.date)}</p>${extra}</div>`; };
  return `<section class="card span12 syblk" id="syGoals"><h2>Où j'en suis de mes objectifs ?</h2><p class="syans">${objectivesAnswer([{ name: "FTP", verdict: D.proj.ftp && D.proj.ftp.verdict }, { name: "VO2max", verdict: D.proj.vo2 && D.proj.vo2.verdict }])}</p>
    <div class="syobjs">${row("FTP", O.ftp, D.proj.ftp, "W", PROJ.ftpDec, O.ftpCheck ? `<p class="syobl">${O.ftpCheck}</p>` : "")}${row("VO2max", O.vo2, D.proj.vo2, "", PROJ.vo2Dec)}
      <div class="syobj"><div class="syoh"><b>Ultra : ${num(ULTRA.km)} km à ${num(ULTRA.kmh)} km/h</b>${O.ultra.ok ? `<span class="syverd" style="color:var(--good)">Prêt</span>` : ""}</div><p class="syobl">${O.ultra.text}</p></div></div>
    <p class="note">Objectifs au ${endLabel(G.date)} : ${num(G.ftp)} W et ${num(G.vo2, G.vo2 % 1 ? 1 : 0)} de VO2max. <a href="#plan" data-go="plan" role="button">Les modifier dans le Plan</a>. FTP mesurée : meilleur 20 min × 95 % ou meilleur 1 h.</p></section>`;
}
function blkDet(D) {
  const rows = DETECTORS.filter(([k]) => D.det.res[k].active).map(([k, , , title]) => { const t = DET_TXT[k](D.det.res[k]);
    return `<div class="sydet on"><div class="syd1"><span class="sydot2" style="background:var(--accent)"></span><b>${title}</b></div><p class="bm-p">${t.why}</p><p class="bm-p sytip">À faire : ${t.tip}</p></div>`; }).join("");
  const any = !!rows, nod = DETECTORS.every(([k]) => D.det.res[k].status === "nodata");
  return `<section class="card span12 syblk" id="syDet"><h2>Quelque chose cloche ?</h2><p class="syans ${any ? "" : "syokp"}">${any ? "" : nod ? "" : "✓ "}${detAnswer(D.det.res)}</p>${rows ? `<div class="sydets">${rows}</div>` : ""}</section>`;
}
function blkWeek(D) {
  const sh = D.share, active = SPORTS.filter(([k]) => sh[k] > 0);
  const bar = sh.total ? `<div class="bm-zbar sybar" role="img" aria-label="Répartition par sport">${active.map(([k, l, c]) => `<div style="width:${sh.pct[k]}%;background:${c}" title="${l} : ${nf(sh.pct[k])} %"></div>`).join("")}</div>
    <div class="legend bm-leg sylegend">${active.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l.toLowerCase()} ${nf(sh.pct[k])} %</span>`).join("")}</div>` : "";
  return `<section class="card span12 syblk" id="syWeek"><h2>Ma semaine</h2><p class="syans">${weekAnswer(D.week)}</p><p class="syans2">${shareAnswer(sh)}</p>${bar}</section>`;
}
function blkReleve(D) {
  const R = D.report, key = K_RELEVE + ymd(mondayOf(D.today));
  if (!R || lsGet(key) || !showReleve(D.today)) return "";
  const km = SPORTS.filter(([k]) => R.per[k].n > 0 && (k === "bike" || k === "run")).map(([k, l, c]) => `<div class="crvar"><span><i class="sydot" style="background:${c}"></i>${l}</span><b>${nf(R.per[k].km)} km</b><small>${nf(R.per[k].n)} séance${R.per[k].n > 1 ? "s" : ""}</small></div>`).join("");
  const other = SPORTS.filter(([k]) => (k === "strength" || k === "other") && R.per[k].n > 0).map(([k, l, c]) => `<div class="crvar"><span><i class="sydot" style="background:${c}"></i>${l}</span><b>${nf(R.per[k].n)} séance${R.per[k].n > 1 ? "s" : ""}</b></div>`).join("");
  const keys = R.keys.hasPlan ? `${nf(R.keys.done)} faite${R.keys.done > 1 ? "s" : ""} / ${nf(R.keys.planned)} prévue${R.keys.planned > 1 ? "s" : ""}` : "pas de plan enregistré";
  const al = R.alerts.length ? R.alerts.map(a => `${a.name} (jusqu'au ${dShort(a.last)})`).join(" · ") : "aucune";
  const answer = R.n ? `Semaine dernière : ${hmTxt(R.hours)}, ${R.n} séance${R.n > 1 ? "s" : ""}, niveau d'entraînement ${trendWordWeek(R.niveau.delta)}, ${num(R.niveau.from)} → ${num(R.niveau.to)}.` : "Semaine dernière : aucune séance.";
  return `<section class="card span12 syblk syreleve" id="syReleve"><h2>Relevé de la semaine dernière <small>du ${dShort(R.m0.getTime())} au ${dShort(R.end.getTime())}</small><button class="btn" data-close="${key}" aria-label="Refermer le relevé">Refermer</button></h2>
    <p class="syans">${answer}</p>
    <div class="crvars sy4 sy4s">${km}${other}<div class="crvar"><span>Séances clés</span><b>${keys}</b><small>selon le Plan</small></div></div>
    <p class="bm-p">Points d'attention de la semaine : ${al}.</p></section>`;
}
const trendWordWeek = d => Math.abs(d) < .5 ? "stable" : d > 0 ? "en hausse" : "en baisse";

// ------------------------------------------------------------------ Rendu : Détails (replié par défaut)
function projChart(box, P, ser, unit, dec, label) {
  if (!box) return;
  const W = Math.max(280, box.clientWidth || 400), H = 200, m = { l: 44, r: 12, t: 12, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, now = S_.D.now;
  const t0 = now - 150 * DAY, t1 = P.end, hist = ser.filter(p => p.t >= t0), xs = t => (t - now) / DAY;
  const vals = [...hist.map(p => p.v), P.goal, P.trendAt(xs(t1)), P.trendAt(xs(Math.max(t0, now - PROJ.days * DAY)))], lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * .12 || 1, lo = lo0 - pad, hi = hi0 + pad;
  const x = t => m.l + (t - t0) / (t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih, f = v => nf(v, dec);
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><g class="axis">`;
  const st = niceTicks(hi - lo, 4)[1] || 1; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${f(v)}</text>`;
  const d0 = new Date(t0); for (let k = 1; k < 14; k++) { const q2 = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (q2.getTime() > t1) break; g += `<text x="${x(q2.getTime())}" y="${H - 5}" text-anchor="middle">${MONTHS[q2.getMonth()]}</text>`; }
  g += `</g><line x1="${m.l}" x2="${W - m.r}" y1="${y(P.goal)}" y2="${y(P.goal)}" stroke="var(--accent)" stroke-dasharray="5 4"/><text x="${m.l + 4}" y="${y(P.goal) - 5}" font-size="11" font-weight="700" fill="var(--accent)">objectif ${f(P.goal)} ${unit}</text>`;
  const ta = Math.max(t0, now - PROJ.days * DAY);
  g += `<line x1="${x(now)}" x2="${x(now)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" stroke-width="1" opacity=".4"/>`;
  g += `<path d="M${x(ta).toFixed(1)},${y(P.trendAt(xs(ta))).toFixed(1)}L${x(now).toFixed(1)},${y(P.trendAt(0)).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="2" opacity=".55"/>`;
  g += `<path d="M${x(now).toFixed(1)},${y(P.trendAt(0)).toFixed(1)}L${x(t1).toFixed(1)},${y(P.trendAt(xs(t1))).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>`;
  g += `<text x="${W - m.r}" y="${y(P.trendAt(xs(t1))) + (P.trendAt(xs(t1)) < P.goal ? 14 : -6)}" text-anchor="end" font-size="11" font-weight="700" fill="var(--ink)">≈ ${f(P.projected)} ${unit}</text>`;
  hist.forEach((p, i) => g += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="3.6" fill="var(--accent)" fill-opacity=".75" stroke="var(--card)" stroke-width="1.5" data-i="${i}"/>`);
  box.innerHTML = g + `</svg><div class="legend bm-leg"><span><i style="background:var(--accent)"></i>mesures</span><span><i style="background:var(--ink);opacity:.6"></i>${P.anchor ? "rythme des 120 derniers jours, depuis ta FTP du Plan" : "tendance des 120 derniers jours"}</span><span><i style="background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 6px)"></i>projection au ${dShort(P.end)}</span></div>`;
  const svg = box.querySelector("svg"), tipf = e => { const c = e.target.closest("circle[data-i]"); if (!c) return hideTip(); const p = hist[+c.dataset.i]; showTip(e, `<b>${dLong(p.t)}</b><br>${f(p.v)} ${unit}${p.l ? `<br>${p.l} à ${nf(p.w)} W sur les 4 semaines d'avant` : ""}`); };
  svg.addEventListener("pointermove", tipf); svg.addEventListener("pointerdown", tipf); svg.addEventListener("pointerleave", hideTip);
}
const verdictCol = v => v === "atteint" || v === "dans les temps" ? "var(--good)" : v === "un peu juste" ? "var(--warn)" : "var(--bad)";
const DET_TXT = {
  gray: r => ({ why: `${r.count} séances « ni faciles ni dures » en ${DET.grayDays} jours (plus de ${DET.grayShare * 100} % du temps en zone 3) : fatigantes sans apporter le stimulus d'une vraie séance dure.`, tip: "garde les séances faciles vraiment faciles (zones 1-2) et réserve l'intensité aux séances clés." }),
  load: r => ({ why: `Ta charge des 7 derniers jours (${nf(r.acute)}) est ${nf(r.ratio, 1)}× ta charge hebdomadaire habituelle des 28 jours d'avant (${nf(r.chronic)}).`, tip: "évite d'ajouter de l'intensité cette semaine et garde une journée vraiment facile." }),
  hrv: r => ({ why: `VFC (variabilité cardiaque) sous ta normale Garmin ${DET.hrvDays} jours de suite : ${r.vals.slice().reverse().map(v => `${nf(v.hrv)} ms (normale à partir de ${nf(v.lo)})`).join(", ")}.`, tip: "regarde d'abord le sommeil et la fatigue des derniers jours ; si la récup reste basse, garde la séance du jour facile." }),
  resp: r => ({ why: `Respiration de la nuit à ${nf(r.v, r.fine ? 1 : 0)} /min, ${r.streak >= 2 ? `au-dessus de ta normale depuis ${r.streak} nuits` : `${nf(r.dv, 1)} au-dessus de ta normale`} (${nf(r.base.m, 1)})${r.signals.length ? `, avec ${r.signals.join(" et ")}` : ""} : ${window.Recup?._?.RESP_WHY || "ton corps est sous stress."}`, tip: "allège la séance du jour ; si ça continue ou si tu te sens patraque, repos complet." }),
  sleep: r => ({ why: `Il te manque ${nf(r.debt / 3600, 1)} h de sommeil sur ${r.nights} nuits par rapport à ta médiane des ${DET.sleepBase} nuits d'avant (${nf(r.med / 3600, 1)} h par nuit).`, tip: "récupère avec environ 1 h de plus par nuit cette semaine." }),
};
function detailsHtml(D) {
  const chips = PERIODS.map(([mo]) => `<button class="chip" aria-pressed="${mo === S_.period}" data-per="${mo}">${mo} mois</button>`).join("");
  const hist = DETECTORS.map(([k, , , title]) => { const h = D.det.hist[k], r = D.det.res[k];
    return `<li><b>${title}</b> : ${r.status === "nodata" ? "pas assez de données" : h.last == null ? `aucune alerte sur ${DET.history} jours` : `dernière alerte le ${dLong(h.last)} · ${nf(h.count)} jour${h.count > 1 ? "s" : ""} en alerte sur ${DET.history}`}</li>`; }).join("");
  const proj = (id, P, ser, name, unit, dec, date) => `<div class="pg-box pg-wide" id="${id}"><h4>${projTitle(name, P, unit, dec, date)}</h4>${P ? `<div class="${id}Plot"></div>` : note("Pas assez de mesures sur les 120 derniers jours pour dégager une tendance.")}</div>`;
  const ctitle = curveTitle(D.fit.slice(-(PERIODS.find(p => p[0] === S_.period)[1])));
  return `<details class="card span12 sydetails" id="syDetails"${lsGet(K_DETAILS) === "1" ? " open" : ""}><summary><span>Détails</span><small>courbes, charge par semaine, projections, historique des alertes</small></summary>
    <div class="sydbody">
    <h3 class="syh3">Niveau, fatigue récente et fraîcheur</h3><p class="syans2" id="syCTitle">${ctitle}</p>
    <div class="chips crchips" role="group" aria-label="Période">${chips}</div><div id="syPlot"></div>
    <ul class="sycl"><li><i style="background:${LINE.ctl}"></i><b>Niveau</b> : ce que tu encaisses, il bouge lentement.</li><li><i style="background:${LINE.atl}"></i><b>Fatigue récente</b> : monte vite après une grosse semaine.</li><li><i style="background:${LINE.tsb}"></i><b>Fraîcheur</b> : niveau moins fatigue ; au-dessus de 0, tu es reposé.</li></ul>
    <h3 class="syh3">Charge par semaine</h3><p class="syans2">${weeksTitle(D.weeks)}</p><div id="syWeeks"></div>
    <h3 class="syh3">Projection vers tes objectifs</h3><div class="pg-grid">${proj("syFtp", D.proj.ftp, D.proj.ftpSer, "FTP", "W", PROJ.ftpDec, D.obj.goals.date)}${proj("syVo2", D.proj.vo2, D.proj.vo2Ser, "VO2max", "", PROJ.vo2Dec, D.obj.goals.date)}</div>
    <h3 class="syh3">Historique des alertes <small>${DET.history} derniers jours</small></h3><ul class="syhist">${hist}</ul>
    <h3 class="syh3">Indicateurs <small>valeur, courbe et variation sur 30 jours · un clic ouvre l'onglet</small></h3>${indic(D)}
    </div></details>`;
}
function plotCurve(D) {
  const days = PERIODS.find(p => p[0] === S_.period)[1], pts = D.fit.slice(-days);
  if (pts.length < 2) { const b = document.getElementById("syPlot"); if (b) b.innerHTML = note("Pas encore assez d'historique pour tracer la courbe."); return; }
  const t = document.getElementById("syCTitle"); if (t) t.textContent = curveTitle(pts);
  lines(document.getElementById("syPlot"), { label: "Niveau, fatigue récente et fraîcheur", pts, keys: ["ctl", "atl", "tsb"], colors: LINE,
    legend: `<span><i style="background:${LINE.ctl}"></i>niveau</span><span><i style="background:${LINE.atl}"></i>fatigue récente</span><span><i style="background:${LINE.tsb}"></i>fraîcheur</span>`,
    tip: p => `<b>${dLong(p.t)}</b><br>Niveau ${nf(p.ctl)} · Fatigue récente ${nf(p.atl)} · Fraîcheur ${p.tsb >= 0 ? "+" : ""}${nf(p.tsb)}` });
}
function plotWeeks(D) {
  const box = document.getElementById("syWeeks"); if (!box) return;
  const W = D.weeks, mx = Math.max(...W.map(w => w.total), 50);
  const bars = W.map((w, i) => `<div class="sywk" data-i="${i}"><div class="sywkb" style="height:${w.total / mx * 100}%">${SPORTS.map(([k, , c]) => w[k] > 0 ? `<div style="height:${w[k] / w.total * 100}%;background:${c}"></div>` : "").join("")}</div><span>${i % 2 === (W.length - 1) % 2 ? dShort(w.t) : ""}</span></div>`).join("");
  box.innerHTML = `<div class="sywks" aria-label="Charge par semaine et par sport">${bars}</div><div class="legend bm-leg">${SPORTS.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>`;
  box.querySelectorAll(".sywk").forEach(el => { const w = W[+el.dataset.i], tipf = e => showTip(e, `<b>semaine du ${dShort(w.t)}</b>${SPORTS.filter(([k]) => w[k] > 0).map(([k, l]) => `<br>${l} ${nf(w[k])}`).join("")}<br>Total ${nf(w.total)}`); el.addEventListener("pointermove", tipf); el.addEventListener("pointerdown", tipf); el.addEventListener("pointerleave", hideTip); });
}
function indic(D) {
  const tile = (go, l, v, u, sub, d, sp, c) => `<div class="tile crtile syind" role="button" tabindex="0" data-go="${go}" title="Ouvrir"><div class="l">${l}</div><div class="v"${c ? ` style="color:${c}"` : ""}>${v}<small>${u}</small></div>
    <div class="crd">${d}</div>${sp}<div class="s">${sub}</div></div>`;
  const dv = (v, dg, unit = "") => v ? `<span>30 j <span style="color:${col(v.delta)}">${v.delta === 0 ? "=" : sgn(v.delta, dg)}${unit}</span></span>` : `<span>30 j –</span>`;
  const T = [];
  T.push(tile("plan", "FTP", D.ftp.cur ? nf(D.ftp.cur) : "–", " W", `utilisée par le Plan${D.ftp.meas ? ` · mesurée ${nf(D.ftp.meas.v)} W` : ""}`, dv(D.ftp.v30, 0, " W"), spark(D.ftp.ser)));
  T.push(tile("plan", "VO2max", D.vo2.cur != null ? nf(D.vo2.cur, 1) : "–", "", D.vo2.date ? `mesurée le ${dLong(D.vo2.date)}` : "", dv(D.vo2.v30, 1), spark(D.vo2.ser)));
  T.push(tile("course", "Allure seuil", D.thr.pace ? window.paceTxt(D.thr.pace) : "–", D.thr.pace ? " /km" : "", D.thr.src, `<span>pas d'historique (seuil unique)</span>`, ""));
  T.push(tile("recup", "Récup du jour", D.rec.score != null ? nf(D.rec.score) : "–", D.rec.score != null ? " /100" : "", D.rec.label || "pas de nuit enregistrée", D.rec.v ? `<span>vs 30 j <span style="color:${col(D.rec.v.delta)}">${D.rec.v.delta === 0 ? "=" : sgn(D.rec.v.delta, 0)}</span></span>` : `<span>vs 30 j –</span>`, spark(D.rec.ser, D.rec.color), D.rec.color));
  return `<div class="crtiles syinds">${T.join("")}</div>`;
}

// ------------------------------------------------------------------ Données de la page
function gather() {
  const today = new Date(), acts = (typeof S !== "undefined" && S.all) || [], ch = window.Charge, loads = ch.dayLoads(acts), daily = ch.dayLoadsBySport(acts);
  const profile = (window.Recup && window.Recup.data && window.Recup.data.profile) || {}, now = today.getTime();
  const firstT = acts.length ? Math.min(...acts.map(a => a.dt.getTime())) : null;
  const fit = fitSeries(loads, today, 365, firstT);
  const ftpSer = ftpPoints(acts, now), ftpNow = window.Plan && window.Plan.ftp ? window.Plan.ftp() : ftpSer.length ? ftpSer[ftpSer.length - 1].v : null;
  let G = goalsFrom(null); try { if (window.Plan && window.Plan._cfg) G = goalsFrom(window.Plan._cfg().goal); } catch (e) {}
  const vo2Ser = listSeries(profile.vo2), p = ch.params();
  const own = (() => { try { const v = +localStorage.getItem("runThrPace"), [lo, hi] = ch.RUN_PACE_RANGE; return v >= lo && v <= hi; } catch (e) { return false; } })();
  const lt = (profile.run && profile.run.lt) || {};
  const thrSrc = !p.runPace ? "aucune : charge estimée à la FC" : own ? "ta saisie (runThrPace)" : `Garmin${lt.d ? `, mesuré le ${dLong(dayMs(lt.d))}` : ""}`;
  // récup du jour : dernier jour avec une nuit ou une disponibilité, même couleur que l'onglet Récup
  const days = ((window.Recup && window.Recup.days) || []).filter(d => d.sl || d.tr != null), last = days[days.length - 1];
  const scores = days.slice(-31).map(d => ({ t: d.dt ? d.dt.getTime() : dayMs(d.d), v: window.Recup.recoScore(d).score })).filter(p => p.v != null);
  const rs = last ? window.Recup.recoScore(last) : null, prev = scores.slice(0, -1);
  const rec = { score: rs && rs.score != null ? rs.score : null, label: rs && rs.label ? rs.label : "", ser: scores, color: rs && rs.score != null ? recupColor(rs.score) : null, t: last ? (last.dt ? last.dt.getTime() : dayMs(last.d)) : null, today: !!last && last.d === ymd(today),
    v: rs && rs.score != null && prev.length >= 5 ? { delta: rs.score - prev.reduce((s, q) => s + q.v, 0) / prev.length } : null };
  // projection, détecteurs, relevé
  const planAPI = window.Plan && window.Plan.plannedFor ? window.Plan : null, recDays = (window.Recup && window.Recup.days) || [];
  const dctx = { acts, loads, days: recDays, respAt: window.Recup?._?.respAt, hardRide: a => planAPI ? planAPI.hardRide(a) : false, tssOf: a => ch.tssOf(a) };
  const proj = { ftp: projection(ftpSer, G.ftp, G.date, now, ftpNow, PROJ.ftpDec, true), ftpSer, vo2: projection(vo2Ser, G.vo2, G.date, now, vo2Ser.length ? vo2Ser[vo2Ser.length - 1].v : null, PROJ.vo2Dec), vo2Ser };
  const vo2Cur = vo2Ser.length ? vo2Ser[vo2Ser.length - 1].v : null;
  const lastFtp = ftpSer.length && now - ftpSer[ftpSer.length - 1].t < DAY ? ftpSer[ftpSer.length - 1] : null;   // le point d'aujourd'hui = les 28 derniers jours
  const obj = { ftp: objective(ftpSer, ftpNow, G.ftp, now), vo2: objective(vo2Ser, vo2Cur, G.vo2, now), goals: G, ftpCheck: ftpCheckLine(ftpNow, lastFtp), ultra: ultraLine(ultraStat(acts, now)) };
  let pal = null; try { pal = palSummary(JSON.parse(localStorage.getItem("palLog"))); } catch (e) {}
  const res = detectAll(dctx, today), hist = Object.fromEntries(DETECTORS.map(([k, , fn]) => [k, alertHistory(fn, dctx, today)]));
  const report = acts.length ? weekReport(dctx, today, planAPI) : null;
  // séance prévue ce soir (Plan) pour la phrase « Que faire aujourd'hui ? »
  let planned = null, done = []; try { const pl = planAPI && planAPI.plannedFor(ymd(today)); if (pl) ({ planned, done } = todaySessions(pl, planAPI.TYPES, planAPI.doneOn ? planAPI.doneOn(ymd(today)) : [])); else if (planAPI && planAPI.doneOn) done = todaySessions(null, planAPI.TYPES, planAPI.doneOn(ymd(today))).done; } catch (e) {}
  const f = fit[fit.length - 1];
  const adv = advice({ tsb: f.tsb, reco: rec.today ? rec.score : null, hrvLow: res.hrv.active, planned, done });
  return { pal, today, now, acts, loads, daily, profile, proj, obj, det: { res, hist }, report, dctx, fit, prog: fit.length ? progress(fit) : null, adv, planned, share: sportShare(daily, today), weeks: weeklyBySport(daily, today), week: weekStats(acts, today, a => ch.tssOf(a)),
    ftp: { cur: ftpNow, ser: ftpSer, meas: lastFtp, v30: lastFtp ? listVariation(ftpSer, now, 30) : null },   // variation : la mesure contre la mesure, jamais la FTP du Plan contre une mesure
    vo2: { cur: vo2Cur, date: vo2Ser.length ? vo2Ser[vo2Ser.length - 1].t : null, ser: vo2Ser, v30: listVariation(vo2Ser, now, 30) },
    thr: { pace: p.runPace, src: thrSrc }, rec };
}


// ------------------------------------------------------------------ Météo du week-end (« Ce week-end, dehors ? »)
// Fenêtre de sortie : 9 h-18 h. Verdict par jour, seuils simples : bon = sec (< 1 mm, risque < 50 %), vent < 30 km/h, rafales < 55, au moins 6 °C ;
// mauvais = 5 mm ou plus, moins de 3 h sèches, vent ≥ 40 km/h, rafales ≥ 70 ou moins de 2 °C ; sinon mitigé.
const WX = { from: 9, to: 18, dryMm: .2, dryPct: 40, good: { mm: 1, pct: 50, wind: 30, gust: 55, t: 6 }, bad: { mm: 5, dryH: 3, wind: 40, gust: 70, t: 2 }, ttl: 36e5, far: 4, speed: 27 };   // speed : vitesse supposée pour la tenue (km/h)
const K_WX = "synWx2";  // v2 : décalage horaire d'Open-Meteo gardé avec la réponse
const DIRS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
const windFrom = deg => { const d = DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; return (/^[eo]/.test(d) ? "d'" : "de ") + d; };
// samedi et dimanche à venir (aujourd'hui compris) ; le dimanche à partir de 17 h, c'est le week-end suivant
function weekendDays(now) {
  const t = new Date(now), dow = t.getDay(), base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const add = n => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  if (dow === 6) return [add(0), add(1)];
  if (dow === 0) return t.getHours() < 17 ? [add(0)] : [add(6), add(7)];
  return [add(6 - dow), add(7 - dow)];
}
// h : réponse horaire d'Open-Meteo (time en heure locale « AAAA-MM-JJTHH:MM ») ; days : dates locales
function weekendWx(h, days) {
  return days.map(dt => {
    // heure réelle de chaque étiquette (décalage unique d'Open-Meteo, faux de l'autre côté d'un changement d'heure)
    const key = ymd(dt), I = [], at = t => h.off != null ? new Date(Date.parse(t + "Z") - h.off * 1000) : new Date(t);
    (h.time || []).forEach((t, i) => { const d = at(t), hr = d.getHours(); if (ymd(d) === key && hr >= WX.from && hr < WX.to) I.push(i); });
    if (!I.length || I.some(i => h.temperature_2m[i] == null)) return { dt, key, ok: false };
    // pluie et risque : cumul de l'heure qui précède l'étiquette, donc l'étiquette suivante pour l'heure qui commence
    const v = k => I.map(i => +h[k][i] || 0), nx = k => I.map(i => +(h[k][i + 1] ?? h[k][i]) || 0);
    const T = v("temperature_2m"), P = nx("precipitation"), PP = nx("precipitation_probability"), W = v("wind_speed_10m"), G = v("wind_gusts_10m");
    const rain = P.reduce((a, b) => a + b, 0), pct = Math.max(...PP), wind = W.reduce((a, b) => a + b, 0) / W.length, gust = Math.max(...G);
    const dir = (() => { let x = 0, y = 0; I.forEach(i => { const r = (+h.wind_direction_10m[i] || 0) * Math.PI / 180; x += Math.sin(r); y += Math.cos(r); }); return Math.atan2(x, y) * 180 / Math.PI; })();
    const dry = I.map((_, k) => P[k] < WX.dryMm && PP[k] < WX.dryPct);
    let best = null, cur = null; dry.forEach((d, k) => { if (d) { if (!cur) cur = { a: k, b: k }; else cur.b = k; if (!best || cur.b - cur.a > best.b - best.a) best = { ...cur }; } else cur = null; });
    const dryH = dry.filter(Boolean).length, tmin = Math.min(...T), tmax = Math.max(...T);
    const g = WX.good, b = WX.bad;
    const verdict = rain < g.mm && pct < g.pct && wind < g.wind && gust < g.gust && tmax >= g.t ? "good"
      : rain >= b.mm || (dryH < b.dryH && rain >= g.mm) || wind >= b.wind || gust >= b.gust || tmax < b.t ? "bad" : "mid";
    const win = best ? { from: WX.from + best.a, to: WX.from + best.b + 1 } : null;
    const hours = I.map((i, k) => ({ h: at(h.time[i]).getHours(), t: T[k], mm: P[k], pct: PP[k], wind: W[k], gust: G[k], dir: +h.wind_direction_10m[i] || 0, dry: dry[k] }));
    return { dt, key, ok: true, verdict, rain, pct, wind, gust, dir, tmin, tmax, dryH, win, hours };
  });
}
const dayName = d => d.toLocaleDateString("fr-FR", { weekday: "long" });
const cap1 = t => t.charAt(0).toUpperCase() + t.slice(1);
// une ligne par jour : « sec, 12-17 °C, vent 15 km/h d'ouest »
function wxLine(d) {
  if (!d.ok) return "pas encore de prévision";
  const sky = d.verdict === "good" ? "sec" : d.rain < WX.good.mm ? (d.pct >= WX.good.pct ? `averses possibles (risque ${nf(d.pct)} %)` : "sec")
    : d.win && d.win.to - d.win.from >= WX.bad.dryH ? `sec de ${d.win.from} h à ${d.win.to} h, ${nf(d.rain)} mm de pluie sinon` : `pluie (${nf(d.rain, d.rain < 10 ? 1 : 0)} mm)`;
  return `${sky}, ${nf(d.tmin)}-${nf(d.tmax)} °C, vent ${nf(d.wind)} km/h ${windFrom(d.dir)}${d.gust >= WX.good.gust ? ` (rafales ${nf(d.gust)})` : ""}`;
}
// détail heure par heure d'un jour (déplié au clic) : heure, température, pluie, vent et rafales ; heure sèche ou non
const DIRS_S = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const dirShort = deg => DIRS_S[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
function wxHoursHtml(d) {
  if (!d.ok || !d.hours) return "";
  const kit = window.Equip ? `<p class="sywxkit"><b>Tenue à vélo</b> : ${window.Equip.wearLine({ tmin: d.tmin, tmax: d.tmax, wind: d.wind, speed: WX.speed, rain: d.rain, pp: d.pct })}</p>` : "";
  return kit + `<table class="sywxh"><thead><tr><th>heure</th><th>°C</th><th>pluie</th><th>vent km/h</th></tr></thead><tbody>${d.hours.map(x =>
    `<tr${x.dry ? "" : ' class="wet"'}><td>${x.h} h</td><td>${nf(x.t)}</td><td>${x.mm >= .1 ? `${nf(x.mm, 1)} mm` : "–"}${x.pct >= 30 ? ` <small>${nf(x.pct)} %</small>` : ""}</td><td>${nf(x.wind)} ${dirShort(x.dir)}${x.gust >= WX.good.gust ? ` <small>raf. ${nf(x.gust)}</small>` : ""}</td></tr>`).join("")}</tbody></table>`;
}
// page de prévisions complètes (meteoblue, 7 jours heure par heure) au centre de la ville de config.json : jamais le point de départ
const wxMoreUrl = (lat, lon) => `https://www.meteoblue.com/fr/meteo/semaine/${Math.abs(lat).toFixed(2)}${lat >= 0 ? "N" : "S"}${Math.abs(lon).toFixed(2)}${lon >= 0 ? "E" : "W"}`;
// phrase-réponse : faut-il prévoir le vélo dehors ou le home trainer ?
function weekendAnswer(L) {
  const D = L.filter(d => d.ok); if (!D.length) return "Pas encore de prévision pour le week-end.";
  const good = D.filter(d => d.verdict === "good"), mid = D.filter(d => d.verdict === "mid"), nm = d => dayName(d.dt);
  if (D.length === 1) { const d = D[0]; return d.verdict === "good" ? `Oui, ${nm(d)} s'annonce bon pour rouler dehors.` : d.verdict === "mid" ? `Possible ${nm(d)}, ${d.win && d.win.to - d.win.from >= WX.bad.dryH ? `en visant le créneau de ${d.win.from} h à ${d.win.to} h` : "avec un coupe-vent"}.` : `Plutôt home trainer ${nm(d)} : ${d.rain >= WX.bad.mm ? "pluie annoncée" : d.wind >= WX.bad.wind || d.gust >= WX.bad.gust ? "vent fort annoncé" : "météo peu engageante"}.`; }
  if (good.length === D.length) return "Oui, beau week-end pour rouler dehors : les deux jours s'annoncent secs.";
  if (good.length) { const o = D.find(d => d !== good[0]); return `Oui, mise sur ${nm(good[0])} pour rouler dehors : ${nm(o)} s'annonce ${o.verdict === "bad" ? "mauvais" : "plus incertain"}.`; }
  if (mid.length) { const m = mid.slice().sort((a, b) => b.dryH - a.dryH)[0]; return `Week-end mitigé : vise ${nm(m)}${m.win && m.win.to - m.win.from >= WX.bad.dryH ? `, sec de ${m.win.from} h à ${m.win.to} h` : ", avec un coupe-vent"}.`; }
  return "Plutôt home trainer ce week-end : pluie ou vent fort annoncés les deux jours.";
}

// ------------------------------------------------------------------ Rendu de l'onglet
function plotDetails(D) { plotCurve(D); plotWeeks(D); if (D.proj.ftp) projChart(document.querySelector(".syFtpPlot"), D.proj.ftp, D.proj.ftpSer, "W", PROJ.ftpDec, "Projection de la FTP"); if (D.proj.vo2) projChart(document.querySelector(".syVo2Plot"), D.proj.vo2, D.proj.vo2Ser, "", PROJ.vo2Dec, "Projection de la VO2max"); }
function render() {
  const box = document.getElementById("synthese"); if (!box) return;
  const per = +lsGet(K_PERIOD); S_.period = PERIODS.some(p => p[0] === per) ? per : 12;
  if (!(typeof S !== "undefined" && S.all.length)) { box.innerHTML = `<div class="card empty"><b>Pas encore de données</b>Lance le workflow « Mise à jour Garmin » puis reviens ici.</div>`; return; }
  const D = S_.D = gather();
  box.innerHTML = `<div class="grid">${blkReleve(D)}${blkProgress(D)}${blkToday(D)}${blkWx()}${blkGoals(D)}${blkDet(D)}${blkWeek(D)}${detailsHtml(D)}</div>`;
  if (D.prog) miniCurve(document.getElementById("syMini"), D.fit.slice(-CURVE_DAYS), D.prog.peak);
  const det = document.getElementById("syDetails"); if (det && det.open) plotDetails(D);
  bind(box);
  loadWx();
}
function bind(box) {
  box.querySelectorAll("[data-per]").forEach(b => b.onclick = () => { lsSet(K_PERIOD, b.dataset.per); S_.period = +b.dataset.per; box.querySelectorAll("[data-per]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); plotCurve(S_.D); });
  box.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { lsSet(b.dataset.close, "1"); const c = document.getElementById("syReleve"); if (c) c.remove(); });
  box.querySelectorAll("[data-help]").forEach(b => b.onclick = e => { e.stopPropagation(); const p = document.getElementById("syh-" + b.dataset.help), open = p.hidden; p.hidden = !open; b.setAttribute("aria-expanded", String(open)); });
  const det = document.getElementById("syDetails"); if (det) det.addEventListener("toggle", () => { lsSet(K_DETAILS, det.open ? "1" : "0"); if (det.open) plotDetails(S_.D); });
  box.querySelectorAll("[data-go]").forEach(el => { const go = () => {
    if (el.dataset.go === "course") { store.set("sport", "run"); S.sport = "run"; window.Nav.setTab("activites"); } else window.Nav.setTab(el.dataset.go); };
    el.onclick = go; el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
}
async function open() {
  const box = document.getElementById("synthese"); if (!box) return;
  document.getElementById("title").textContent = "Ma forme";
  if (!(window.Recup && window.Recup.data)) { box.innerHTML = `<div class="card"><p class="note">Chargement de ta forme…</p></div>`; if (window.loadProfile) await window.loadProfile(); }
  render();
}

window.Synthese = { open, render, _: { todaySessions, theilSen, ultraStat, ultraLine, palSummary, ULTRA, PAL, ftpOf, ftpPoints, goalsFrom, ftpCheckLine, FTPM, projection, detGray, detLoad, detHrv, detSleep, detResp, DETECTORS, alertHistory, detectAll, weekReport, showReleve, median, GOALS, PROJ, DET, fitAt, fitSeries, variation, formLabel, sportShare, weeklyBySport, weekStats, vsAvg, listSeries, valueBefore, listVariation, recupColor, mondayOf, FIT_DAYS, PERIODS,
  trendWord, progress, advice, weekendDays, weekendWx, weekendAnswer, wxLine, wxHoursHtml, wxMoreUrl, windFrom, WX, objective, objLine, objectivesAnswer, detAnswer, weekAnswer, shareAnswer, curveTitle, weeksTitle, projTitle, hmTxt, peakOf, partOfMonth, TREND, READY_LOW, DET_TXT, HELP } };
document.addEventListener("velo:loaded", () => { if (window.Nav && window.Nav.curTab() === "synthese") open(); });
let rt, lw = innerWidth; addEventListener("resize", () => { if (innerWidth === lw) return; lw = innerWidth; clearTimeout(rt); rt = setTimeout(() => { if (window.Nav && window.Nav.curTab() === "synthese" && S_.D) render(); }, 150); });
if (window.Nav && window.Nav.curTab() === "synthese") open();
})();
