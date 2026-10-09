"use strict";
// Onglet « Synthèse » : le tableau de bord de ta forme, façon « patrimoine » : fond / fatigue / forme, répartition de la charge
// par sport, indicateurs (FTP, VO2max, allure seuil, récup du jour) et ta semaine.
// Deux parties : des fonctions pures (testées par tests/synthese.mjs, exposées dans Synthese._) puis le rendu.
// Données : Charge (dayLoadsBySport, series, fitness), Recup (profile, jours), Plan (FTP). Même style SVG que Bilan.progress et la carte Progression course.
(() => {
const DAY = 864e5;

// ------------------------------------------------------------------ Constantes
// Le fond (CTL), la fatigue (ATL) et la forme (TSB) sont calculés comme la carte Forme du Plan : 120 jours glissants (Charge.series).
// Une série sur 365 jours donnerait un fond plus haut (≈ +4 points aujourd'hui) : on garde la définition du Plan partout,
// y compris pour la courbe et les variations, pour que le chiffre en grand soit EXACTEMENT celui du Plan.
const FIT_DAYS = 120;
const PERIODS = [[3, 92], [6, 183], [12, 365]];           // puces de la courbe : mois → jours
const SHARE_DAYS = 30, WEEKS = 12;                          // répartition par sport : barre sur 30 jours, 12 semaines empilées
const MIN_SESSION = 600;                                    // « séance » de la ligne « Ta semaine » : 10 min et plus
const SPORTS = [["bike", "Vélo", "var(--accent)"], ["run", "Course", "#1c7ed6"], ["strength", "Muscu", "#7048e8"], ["other", "Autre", "var(--ghost)"]];
const LINE = { ctl: "var(--accent)", atl: "#c2255c", tsb: "#2f9e44" };
const RECUP_COL = ["#3cc9b4", "#5aa9f2", "#f2a93b", "#f2708a"];   // couleurs du score de récup de l'onglet Récup (thème nuit), valables dans tous les thèmes
const K_PERIOD = "synPeriod";
// Objectifs de fin d'année (projection)
const GOALS = { ftp: 300, vo2: 65, date: "2026-12-31" };
const PROJ = { days: 120, justFrac: .6, rampFrac: .75, ftpDec: 0, vo2Dec: 1 };   // tendance sur 120 jours ; « un peu juste » si le rythme actuel couvre au moins 60 % du rythme nécessaire ; test rampe : FTP = 75 % de la meilleure minute (comme le Plan)
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
const mondayOf = d => { const t = dayStart(d); t.setDate(t.getDate() - (t.getDay() + 6) % 7); return t; };

// fond / fatigue / forme tels que la carte Forme du Plan les affiche pour le jour t (charges des 120 jours d'avant, le jour t exclu)
function fitAt(loads, t) { const s = window.Charge.series(loads, new Date(t), FIT_DAYS); return { ctl: s.ctl, atl: s.atl, tsb: s.tsb }; }
// une valeur par jour sur les n derniers jours, aujourd'hui compris (le dernier point = Charge.fitness(aujourd'hui))
function fitSeries(loads, today, n) {
  const day = dayStart(today), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = i ? addDays(day, -i) : today, f = fitAt(loads, d); out.push({ t: addDays(day, -i).getTime(), ...f }); }
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
  const m0 = mondayOf(today), blank = () => ({ hours: 0, tss: 0, n: 0, bike: 0, run: 0, strength: 0, other: 0 }), cur = blank(), prev = Array.from({ length: 4 }, blank);
  for (const a of acts) {
    if (!(a.mt >= MIN_SESSION) || a.dt > today) continue;
    const i = Math.round((m0 - mondayOf(a.dt)) / (7 * DAY)); if (i < 0 || i > 4) continue;
    const w = i === 0 ? cur : prev[i - 1]; w.hours += a.mt / 3600; w.tss += tssOf(a); w.n++; w[window.Charge.sportOf(a)]++;
  }
  const avg = Object.fromEntries(Object.keys(cur).map(k => [k, prev.reduce((s, w) => s + w[k], 0) / 4]));
  return { cur, avg, prev };
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
// FTP de test (test rampe, séances nommées « … Ramp Test ») : 75 % de la meilleure minute
function rampPoints(acts, now) {
  const byDay = {};   // plusieurs tests le même jour (un « Lite » interrompu avant le vrai) : on garde le meilleur
  for (const a of acts) { if (!(/ramp/i.test(a.n || "") && /test/i.test(a.n || "") && a.pc && a.pc["60"] > 0 && a.dt.getTime() <= now)) continue;
    const k = ymd(a.dt), v = Math.round(a.pc["60"] * PROJ.rampFrac); if (!byDay[k] || v > byDay[k].v) byDay[k] = { t: a.dt.getTime(), v }; }
  return Object.values(byDay).sort((x, y) => x.t - y.t);
}
// Projection vers un objectif. ser : [{ t, v }] ; cur : valeur actuelle (la FTP utilisée par le Plan, la dernière VO2max) ; tendance sur les 120 derniers jours.
// Le rythme actuel est la pente de Theil-Sen ; verdict : atteint / dans les temps / un peu juste / hors de portée au rythme actuel.
function projection(ser, goal, dateStr, now, cur, dec = 0) {
  const t0 = now - PROJ.days * DAY, pts = ser.filter(p => p.t >= t0 && p.t <= now).map(p => ({ x: (p.t - now) / DAY, y: p.v })), ts = theilSen(pts);
  const end = dayMs(dateStr), daysLeft = (end - now) / DAY, weeksLeft = Math.max(daysLeft / 7, 0), base = cur != null ? cur : pts.length ? pts[pts.length - 1].y : null;
  if (!ts || base == null) return null;
  const rate = ts.slope * 7, projected = base + ts.slope * Math.max(daysLeft, 0), need = weeksLeft > 0 ? (goal - base) / weeksLeft : null, f = x => Math.round(x * 10 ** dec) / 10 ** dec;
  let verdict = base >= goal ? "atteint" : weeksLeft <= 0 ? "hors de portée au rythme actuel" : projected >= goal ? "dans les temps" : rate > 0 && rate >= PROJ.justFrac * need ? "un peu juste" : "hors de portée au rythme actuel";
  return { n: pts.length, slope: ts.slope, intercept: ts.intercept, rate, cur: base, projected, need, weeksLeft, verdict, goal, end,
    trendAt: x => ts.intercept + ts.slope * x, text: { cur: f(base), projected: f(projected), rate: f(rate * 10) / 10, need: need == null ? null : f(need * 10) / 10 } };
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
const DETECTORS = [["gray", "Zone grise", detGray], ["load", "Charge qui monte trop vite", detLoad], ["hrv", "VFC basse", detHrv], ["sleep", "Dette de sommeil", detSleep]];
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
  const alerts = []; for (const [k, name, fn] of DETECTORS) { let act = null; for (let i = 0; i < 7; i++) { const d = addDays(m0, i); if (fn(ctx, d).active) act = d.getTime(); } if (act != null) alerts.push({ k, name, last: act }); }
  return { m0, end, hours, tss, per, fond: { from: f0.ctl, to: f1.ctl, delta: f1.ctl - f0.ctl }, keys: { planned, done, hasPlan }, alerts, n: inWeek.filter(a => a.mt >= MIN_SESSION).length };
}

// ------------------------------------------------------------------ Rendu : outils
const S_ = { period: 12, box: null };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const dLong = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dShort = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const sg = v => v < 0 ? "−" : "+";
const sgn = (v, d = 0) => Math.abs(v) < 5 * Math.pow(10, -d - 1) ? nf(0, d) : `${v < 0 ? "−" : "+"}${nf(Math.abs(v), d)}`;   // un écart qui arrondit à zéro s'écrit « 0 », sans signe
const note = t => `<p class="note">${t}</p>`;
const col = v => v >= 0 ? "var(--good)" : "var(--bad)";

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

// ------------------------------------------------------------------ Rendu : les cartes
function cardForme(D) {
  const ser = D.fit, f = ser[ser.length - 1], v7 = variation(ser, 7, "ctl"), v30 = variation(ser, 30, "ctl");
  const vh = (l, v) => v ? `<div class="crvar" style="--c:${col(v.delta)}"><span>${l}</span><b>${sgn(v.delta, 1)} pts</b><small>${v.pct == null ? "" : `${sgn(v.pct, 1)} %`}</small></div>` : `<div class="crvar"><span>${l}</span><b>–</b><small>pas assez de recul</small></div>`;
  const chips = PERIODS.map(([mo]) => `<button class="chip" aria-pressed="${mo === S_.period}" data-per="${mo}">${mo} mois</button>`).join("");
  return `<section class="card span12 syforme" id="syForme"><h2>Ta forme <small>fond, fatigue et forme, en charge d'entraînement (TSS) · mêmes calculs que le Plan</small></h2>
    <div class="syhead"><div class="crnow"><span class="crbig syctl">${nf(f.ctl)}</span><span class="crsub">fond (CTL, 42 jours)</span></div>
    <div class="syfat"><div><span>Fatigue (ATL, 7 j)</span><b>${nf(f.atl)}</b></div><div><span>Forme (TSB)</span><b>${f.tsb >= 0 ? "+" : ""}${nf(f.tsb)}</b><small>${formLabel(f.tsb)}</small></div></div></div>
    <div class="crvars sy2">${vh("Fond, 7 jours", v7)}${vh("Fond, 30 jours", v30)}</div>
    <div class="chips crchips" role="group" aria-label="Période">${chips}</div><div id="syPlot"></div></section>`;
}
function plotForme(D) {
  const days = PERIODS.find(p => p[0] === S_.period)[1], pts = D.fit.slice(-days);
  lines(document.getElementById("syPlot"), { label: "Fond, fatigue et forme", pts, keys: ["ctl", "atl", "tsb"], colors: LINE,
    legend: `<span><i style="background:${LINE.ctl}"></i>fond</span><span><i style="background:${LINE.atl}"></i>fatigue</span><span><i style="background:${LINE.tsb}"></i>forme</span>`,
    tip: p => `<b>${dLong(p.t)}</b><br>Fond ${nf(p.ctl)} · Fatigue ${nf(p.atl)} · Forme ${p.tsb >= 0 ? "+" : ""}${nf(p.tsb)}` });
}
function cardShare(D) {
  const sh = D.share, active = SPORTS.filter(([k]) => sh[k] > 0);
  if (!sh.total) return `<section class="card span12" id="syShare"><h2>Répartition de la charge <small>par sport</small></h2>${note("Pas de séance sur les 30 derniers jours.")}</section>`;
  const bar = active.map(([k, l, c]) => `<div style="width:${sh.pct[k]}%;background:${c}" title="${l} : ${nf(sh.pct[k])} %"></div>`).join("");
  const leg = active.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} <b>${nf(sh.pct[k])} %</b> <small>${nf(sh[k])} TSS</small></span>`).join("");
  return `<section class="card span12" id="syShare"><h2>Répartition de la charge <small>par sport, ${SHARE_DAYS} derniers jours · ${nf(sh.total)} TSS</small></h2>
    <div class="bm-zbar sybar" role="img" aria-label="Répartition par sport">${bar}</div><div class="bm-zleg sylegend">${leg}</div>
    <h3 class="syh3">Charge par semaine <small>${WEEKS} dernières semaines</small></h3><div id="syWeeks"></div></section>`;
}
function plotWeeks(D) {
  const box = document.getElementById("syWeeks"); if (!box) return;
  const W = D.weeks, mx = Math.max(...W.map(w => w.total), 50);
  const bars = W.map((w, i) => `<div class="sywk" data-i="${i}"><div class="sywkb" style="height:${w.total / mx * 100}%">${SPORTS.map(([k, , c]) => w[k] > 0 ? `<div style="height:${w[k] / w.total * 100}%;background:${c}"></div>` : "").join("")}</div><span>${i % 2 === (W.length - 1) % 2 ? dShort(w.t).replace(" ", " ") : ""}</span></div>`).join("");
  box.innerHTML = `<div class="sywks" aria-label="Charge par semaine et par sport">${bars}</div><div class="legend bm-leg">${SPORTS.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>`;
  box.querySelectorAll(".sywk").forEach(el => { const w = W[+el.dataset.i], tipf = e => showTip(e, `<b>semaine du ${dShort(w.t)}</b>${i18(w)}<br>Total ${nf(w.total)} TSS`); el.addEventListener("pointermove", tipf); el.addEventListener("pointerdown", tipf); el.addEventListener("pointerleave", hideTip); });
}
const i18 = w => SPORTS.filter(([k]) => w[k] > 0).map(([k, l]) => `<br>${l} ${nf(w[k])}`).join("");
function cardIndic(D) {
  const tile = (go, l, v, u, sub, d, sp, c) => `<div class="tile crtile syind" role="button" tabindex="0" data-go="${go}" title="Ouvrir"><div class="l">${l}</div><div class="v"${c ? ` style="color:${c}"` : ""}>${v}<small>${u}</small></div>
    <div class="crd">${d}</div>${sp}<div class="s">${sub}</div></div>`;
  const dv = (v, dg, unit = "") => v ? `<span>30 j <span style="color:${col(v.delta)}">${v.delta === 0 ? "=" : sgn(v.delta, dg)}${unit}</span></span>` : `<span>30 j –</span>`;
  const T = [];
  T.push(tile("plan", "FTP", D.ftp.cur ? nf(D.ftp.cur) : "–", " W", "utilisée par le Plan", dv(D.ftp.v30, 0, " W"), spark(D.ftp.ser)));
  T.push(tile("plan", "VO2max", D.vo2.cur != null ? nf(D.vo2.cur, 1) : "–", "", D.vo2.date ? `mesurée le ${dLong(D.vo2.date)}` : "", dv(D.vo2.v30, 1), spark(D.vo2.ser)));
  T.push(tile("course", "Allure seuil", D.thr.pace ? window.paceTxt(D.thr.pace) : "–", D.thr.pace ? " /km" : "", D.thr.src, `<span>pas d'historique (seuil unique)</span>`, ""));
  T.push(tile("recup", "Récup du jour", D.rec.score != null ? nf(D.rec.score) : "–", D.rec.score != null ? " /100" : "", D.rec.label || "pas de nuit enregistrée", D.rec.v ? `<span>vs 30 j <span style="color:${col(D.rec.v.delta)}">${D.rec.v.delta === 0 ? "=" : sgn(D.rec.v.delta, 0)}</span></span>` : `<span>vs 30 j –</span>`, spark(D.rec.ser, D.rec.color), D.rec.color));
  return `<section class="card span12" id="syInd"><h2>Indicateurs <small>valeur, courbe et variation sur 30 jours · un clic ouvre l'onglet</small></h2><div class="crtiles syinds">${T.join("")}</div></section>`;
}
function cardWeek(D) {
  const { cur, avg } = D.week, line = (l, v, a, d = 0, u = "") => { const p = vsAvg(v, a); return `<div class="crvar"><span>${l}</span><b>${nf(v, d)}${u}</b><small>moy. ${nf(a, d)}${u}${p == null ? "" : ` · ${sgn(p)} %`}</small></div>`; };
  const per = SPORTS.filter(([k]) => cur[k] > 0 || avg[k] >= .5).map(([k, l, c]) => `<div class="crvar"><span><i class="sydot" style="background:${c}"></i>${l}</span><b>${nf(cur[k])} séance${cur[k] > 1 ? "s" : ""}</b><small>moy. ${nf(avg[k], 1)}</small></div>`).join("");
  return `<section class="card span12" id="syWeek"><h2>Ta semaine <small>depuis lundi, contre la moyenne des 4 semaines complètes d'avant</small></h2>
    <div class="crvars sy4">${line("Heures", cur.hours, avg.hours, 1, " h")}${line("Charge", cur.tss, avg.tss, 0, " TSS")}${line("Séances", cur.n, avg.n, 0)}</div>${per ? `<div class="crvars sy4 sy4s">${per}</div>` : ""}</section>`;
}


// 4b : projection, détecteurs, relevé
function projChart(box, P, ser, unit, dec, label) {
  if (!box) return;
  const W = Math.max(280, box.clientWidth || 400), H = 200, m = { l: 44, r: 12, t: 12, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, now = S_.D.now;
  const t0 = now - 150 * DAY, t1 = P.end, hist = ser.filter(p => p.t >= t0), xs = t => (t - now) / DAY;
  const vals = [...hist.map(p => p.v), P.goal, P.trendAt(xs(t1)), P.trendAt(xs(Math.max(t0, now - PROJ.days * DAY)))], lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * .12 || 1, lo = lo0 - pad, hi = hi0 + pad;
  const x = t => m.l + (t - t0) / (t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih, f = v => nf(v, dec);
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><g class="axis">`;
  const st = niceTicks(hi - lo, 4)[1] || 1; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${f(v)}</text>`;
  const d0 = new Date(t0); for (let k = 1; k < 14; k++) { const q = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (q.getTime() > t1) break; g += `<text x="${x(q.getTime())}" y="${H - 5}" text-anchor="middle">${MONTHS[q.getMonth()]}</text>`; }
  g += `</g><line x1="${m.l}" x2="${W - m.r}" y1="${y(P.goal)}" y2="${y(P.goal)}" stroke="var(--accent)" stroke-dasharray="5 4"/><text x="${m.l + 4}" y="${y(P.goal) - 5}" font-size="11" font-weight="700" fill="var(--accent)">objectif ${f(P.goal)} ${unit}</text>`;
  const ta = Math.max(t0, now - PROJ.days * DAY);
  g += `<line x1="${x(now)}" x2="${x(now)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" stroke-width="1" opacity=".4"/>`;
  g += `<path d="M${x(ta).toFixed(1)},${y(P.trendAt(xs(ta))).toFixed(1)}L${x(now).toFixed(1)},${y(P.trendAt(0)).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="2" opacity=".55"/>`;
  g += `<path d="M${x(now).toFixed(1)},${y(P.trendAt(0)).toFixed(1)}L${x(t1).toFixed(1)},${y(P.trendAt(xs(t1))).toFixed(1)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>`;
  g += `<text x="${W - m.r}" y="${y(P.trendAt(xs(t1))) + (P.trendAt(xs(t1)) < P.goal ? 14 : -6)}" text-anchor="end" font-size="11" font-weight="700" fill="var(--ink)">≈ ${f(P.projected)} ${unit}</text>`;
  hist.forEach((p, i) => g += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="3.6" fill="var(--accent)" fill-opacity=".75" stroke="var(--card)" stroke-width="1.5" data-i="${i}"/>`);
  box.innerHTML = g + `</svg><div class="legend bm-leg"><span><i style="background:var(--accent)"></i>mesures</span><span><i style="background:var(--ink);opacity:.6"></i>tendance (Theil-Sen, 120 j)</span><span><i style="background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 6px)"></i>projection au ${dShort(P.end)}</span></div>`;
  const svg = box.querySelector("svg"), tipf = e => { const c = e.target.closest("circle[data-i]"); if (!c) return hideTip(); const p = hist[+c.dataset.i]; showTip(e, `<b>${dLong(p.t)}</b><br>${f(p.v)} ${unit}`); };
  svg.addEventListener("pointermove", tipf); svg.addEventListener("pointerdown", tipf); svg.addEventListener("pointerleave", hideTip);
}
const verdictCol = v => v === "atteint" || v === "dans les temps" ? "var(--good)" : v === "un peu juste" ? "#c77700" : "var(--bad)";
function projBlock(id, title, P, unit, dec, what) {
  if (!P) return `<div class="pg-box pg-wide" id="${id}"><h4>${title}</h4>${note("Pas assez de mesures sur les 120 derniers jours pour dégager une tendance.")}</div>`;
  const u = unit ? " " + unit : "", t = P.text, r = (v, d) => `${v < 0 ? "−" : "+"}${nf(Math.abs(v), d)}`, endTxt = dLong(P.end);
  const phrase = P.verdict === "atteint" ? `Objectif de ${nf(P.goal, dec)}${u} déjà atteint.` :
    `${what} ${nf(t.cur, dec)}${u} aujourd'hui, objectif ${nf(P.goal, dec)}${u} au ${endTxt} : il faut <b>${r(t.need, dec ? 2 : 1)}${u}/semaine</b>, la tendance actuelle est de <b>${r(t.rate, dec ? 2 : 1)}${u}/semaine</b>, soit ≈ <b>${nf(t.projected, dec)}${u}</b> au ${endTxt}.`;
  return `<div class="pg-box pg-wide" id="${id}"><h4>${title} <small>${P.n} mesures sur 120 jours</small></h4>
    <p class="bm-p syverdict"><b style="color:${verdictCol(P.verdict)}">${P.verdict === "atteint" ? "Objectif atteint" : P.verdict === "dans les temps" ? "Dans les temps" : P.verdict === "un peu juste" ? "Un peu juste" : "Hors de portée au rythme actuel"}.</b> ${phrase}</p><div class="${id}Plot"></div></div>`;
}
function cardProj(D) {
  return `<section class="card span12" id="syProj"><h2>Projection vers tes objectifs <small>${nf(GOALS.ftp)} W de FTP et VO2max ${nf(GOALS.vo2)} au ${dLong(dayMs(GOALS.date))} · tendance robuste (Theil-Sen)</small></h2><div class="pg-grid">
    ${projBlock("syFtp", "FTP", D.proj.ftp, "W", PROJ.ftpDec, "Tu es à")}${projBlock("syVo2", "VO2max", D.proj.vo2, "", PROJ.vo2Dec, "Tu es à")}</div></section>`;
}
function plotProj(D) {
  if (D.proj.ftp) projChart(document.querySelector(".syFtpPlot"), D.proj.ftp, D.proj.ftpSer, "W", PROJ.ftpDec, "Projection de la FTP");
  if (D.proj.vo2) projChart(document.querySelector(".syVo2Plot"), D.proj.vo2, D.proj.vo2Ser, "", PROJ.vo2Dec, "Projection de la VO2max");
}
const DET_TXT = {
  gray: r => ({ why: `${r.count} séances « ni faciles ni dures » en ${DET.grayDays} jours (plus de ${DET.grayShare * 100} % du temps en zone 3) : fatigantes sans apporter le stimulus d'une vraie séance dure.`, tip: "Garde les séances faciles vraiment faciles (zones 1-2) et réserve l'intensité aux séances clés." }),
  load: r => ({ why: `Ta charge des 7 derniers jours (${nf(r.acute)} TSS) est ${nf(r.ratio, 1)}× la moyenne hebdomadaire des 28 jours d'avant (${nf(r.chronic)} TSS).`, tip: "Évite d'ajouter de l'intensité cette semaine et garde une journée vraiment facile." }),
  hrv: r => ({ why: `VFC sous ta normale Garmin ${DET.hrvDays} jours de suite : ${r.vals.slice().reverse().map(v => `${nf(v.hrv)} ms (normale à partir de ${nf(v.lo)})`).join(", ")}.`, tip: "Regarde d'abord le sommeil et la fatigue des derniers jours ; si la récup reste basse, garde la séance du jour facile." }),
  sleep: r => ({ why: `Il te manque ${nf(r.debt / 3600, 1)} h de sommeil sur ${r.nights} nuits par rapport à ta médiane des ${DET.sleepBase} nuits d'avant (${nf(r.med / 3600, 1)} h par nuit).`, tip: "Récupère avec environ 1 h de plus par nuit cette semaine." }),
};
function cardDet(D) {
  const rows = DETECTORS.map(([k, name]) => { const r = D.det.res[k], h = D.det.hist[k];
    const hist = h.last == null ? `aucune alerte sur ${DET.history} jours` : `dernière alerte : ${dLong(h.last)} · ${nf(h.count)} jour${h.count > 1 ? "s" : ""} en alerte sur ${DET.history}`;
    const st = r.status === "actif" ? `<span class="sydot2" style="background:#e8501c"></span><b>${name}</b>` : r.status === "nodata" ? `<span class="sydot2" style="background:var(--ghost)"></span><b>${name}</b> <small>pas assez de données</small>` : `<span class="sydot2" style="background:var(--good)"></span><b>${name}</b> <small>rien à signaler</small>`;
    const t = r.active ? DET_TXT[k](r) : null;
    return `<div class="sydet${r.active ? " on" : ""}"><div class="syd1">${st}</div>${t ? `<p class="bm-p">${t.why}</p><p class="bm-p sytip">Piste : ${t.tip}</p>` : ""}<div class="syd2">${hist}</div></div>`; }).join("");
  const any = DETECTORS.some(([k]) => D.det.res[k].active);
  return `<section class="card span12" id="syDet"><h2>Frais cachés <small>quatre détecteurs, chacun avec son historique sur ${DET.history} jours</small></h2>
    ${any ? "" : `<div class="syok"><b>Rien à signaler</b> · aucun détecteur n'est actif aujourd'hui.</div>`}<div class="sydets">${rows}</div></section>`;
}
function cardReleve(D) {
  const R = D.report, key = K_RELEVE + ymd(mondayOf(D.today));
  if (!R || lsGet(key) || !showReleve(D.today)) return "";
  const km = SPORTS.filter(([k]) => R.per[k].n > 0 && (k === "bike" || k === "run")).map(([k, l, c]) => `<div class="crvar"><span><i class="sydot" style="background:${c}"></i>${l}</span><b>${nf(R.per[k].km)} km</b><small>${nf(R.per[k].n)} séance${R.per[k].n > 1 ? "s" : ""} · ${nf(R.per[k].tss)} TSS</small></div>`).join("");
  const other = SPORTS.filter(([k]) => (k === "strength" || k === "other") && R.per[k].n > 0).map(([k, l, c]) => `<div class="crvar"><span><i class="sydot" style="background:${c}"></i>${l}</span><b>${nf(R.per[k].n)} séance${R.per[k].n > 1 ? "s" : ""}</b><small>${nf(R.per[k].tss)} TSS</small></div>`).join("");
  const keys = R.keys.hasPlan ? `${nf(R.keys.done)} faite${R.keys.done > 1 ? "s" : ""} / ${nf(R.keys.planned)} prévue${R.keys.planned > 1 ? "s" : ""}` : "pas de plan enregistré";
  const al = R.alerts.length ? R.alerts.map(a => `${a.name} (jusqu'au ${dShort(a.last)})`).join(" · ") : "aucune";
  return `<section class="card span12 syreleve" id="syReleve"><h2>Relevé de la semaine dernière <small>du ${dShort(R.m0.getTime())} au ${dShort(R.end.getTime())}</small><button class="btn" data-close="${key}" aria-label="Refermer le relevé">Refermer</button></h2>
    <div class="crvars sy4"><div class="crvar"><span>Heures</span><b>${nf(R.hours, 1)} h</b><small>${nf(R.n)} séances</small></div><div class="crvar"><span>Charge</span><b>${nf(R.tss)} TSS</b><small>tous sports</small></div>
    <div class="crvar" style="--c:${col(R.fond.delta)}"><span>Fond</span><b>${sgn(R.fond.delta, 1)} pts</b><small>${nf(R.fond.from)} → ${nf(R.fond.to)}</small></div></div>
    <div class="crvars sy4 sy4s">${km}${other}<div class="crvar"><span>Séances clés</span><b>${keys}</b><small>selon le Plan</small></div></div>
    <p class="bm-p">Alertes de la semaine : ${al}.</p></section>`;
}

// ------------------------------------------------------------------ Données de la page
function gather() {
  const today = new Date(), acts = (typeof S !== "undefined" && S.all) || [], ch = window.Charge, loads = ch.dayLoads(acts), daily = ch.dayLoadsBySport(acts);
  const profile = (window.Recup && window.Recup.data && window.Recup.data.profile) || {}, now = today.getTime();
  const fit = fitSeries(loads, today, 365);
  const ftpSer = listSeries(profile.ftpHist), ftpNow = window.Plan && window.Plan.ftp ? window.Plan.ftp() : profile.ftp || null;
  const vo2Ser = listSeries(profile.vo2), p = ch.params();
  const own = (() => { try { const v = +localStorage.getItem("runThrPace"), [lo, hi] = ch.RUN_PACE_RANGE; return v >= lo && v <= hi; } catch (e) { return false; } })();
  const lt = (profile.run && profile.run.lt) || {};
  const thrSrc = !p.runPace ? "aucune : charge estimée à la FC" : own ? "ta saisie (runThrPace)" : `Garmin${lt.d ? `, mesuré le ${dLong(dayMs(lt.d))}` : ""}`;
  // récup du jour : dernier jour avec une nuit ou une disponibilité, même couleur que l'onglet Récup
  const days = ((window.Recup && window.Recup.days) || []).filter(d => d.sl || d.tr != null), last = days[days.length - 1];
  const scores = days.slice(-31).map(d => ({ t: d.dt ? d.dt.getTime() : dayMs(d.d), v: window.Recup.recoScore(d).score })).filter(p => p.v != null);
  const rs = last ? window.Recup.recoScore(last) : null, prev = scores.slice(0, -1);
  const rec = { score: rs && rs.score != null ? rs.score : null, label: rs && rs.label ? rs.label : "", ser: scores, color: rs && rs.score != null ? recupColor(rs.score) : null,
    v: rs && rs.score != null && prev.length >= 5 ? { delta: rs.score - prev.reduce((s, q) => s + q.v, 0) / prev.length } : null };
  // 4b : projection, détecteurs, relevé
  const planAPI = window.Plan && window.Plan.plannedFor ? window.Plan : null, recDays = (window.Recup && window.Recup.days) || [];
  const dctx = { acts, loads, days: recDays, hardRide: a => planAPI ? planAPI.hardRide(a) : false, tssOf: a => ch.tssOf(a) };
  const ftpTrend = ftpSer.concat(rampPoints(acts, now)).sort((a, b) => a.t - b.t);
  const proj = { ftp: projection(ftpTrend, GOALS.ftp, GOALS.date, now, ftpNow, PROJ.ftpDec), ftpSer: ftpTrend, vo2: projection(vo2Ser, GOALS.vo2, GOALS.date, now, vo2Ser.length ? vo2Ser[vo2Ser.length - 1].v : null, PROJ.vo2Dec), vo2Ser };
  const res = detectAll(dctx, today), hist = Object.fromEntries(DETECTORS.map(([k, , fn]) => [k, alertHistory(fn, dctx, today)]));
  const report = acts.length ? weekReport(dctx, today, planAPI) : null;
  return { today, now, acts, loads, daily, profile, proj, det: { res, hist }, report, dctx, fit, share: sportShare(daily, today), weeks: weeklyBySport(daily, today), week: weekStats(acts, today, a => ch.tssOf(a)),
    ftp: { cur: ftpNow, ser: ftpSer, v30: ftpNow ? listVariation(ftpSer, now, 30, ftpNow) : null },
    vo2: { cur: vo2Ser.length ? vo2Ser[vo2Ser.length - 1].v : null, date: vo2Ser.length ? vo2Ser[vo2Ser.length - 1].t : null, ser: vo2Ser, v30: listVariation(vo2Ser, now, 30) },
    thr: { pace: p.runPace, src: thrSrc }, rec };
}

// ------------------------------------------------------------------ Rendu de l'onglet
function render() {
  const box = document.getElementById("synthese"); if (!box) return;
  const per = +lsGet(K_PERIOD); S_.period = PERIODS.some(p => p[0] === per) ? per : 12;
  if (!(typeof S !== "undefined" && S.all.length)) { box.innerHTML = `<div class="card empty"><b>Pas encore de données</b>Lance le workflow « Mise à jour Garmin » puis reviens ici.</div>`; return; }
  const D = S_.D = gather();
  box.innerHTML = `<div class="grid">${cardReleve(D)}${cardForme(D)}${cardDet(D)}${cardShare(D)}${cardIndic(D)}${cardProj(D)}${cardWeek(D)}</div>`;
  plotForme(D); plotWeeks(D); plotProj(D); bind(box);
}
function bind(box) {
  box.querySelectorAll("[data-per]").forEach(b => b.onclick = () => { lsSet(K_PERIOD, b.dataset.per); S_.period = +b.dataset.per; box.querySelectorAll("[data-per]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); plotForme(S_.D); });
  box.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { lsSet(b.dataset.close, "1"); const c = document.getElementById("syReleve"); if (c) c.remove(); });
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

window.Synthese = { open, render, _: { theilSen, rampPoints, projection, detGray, detLoad, detHrv, detSleep, DETECTORS, alertHistory, detectAll, weekReport, showReleve, median, GOALS, PROJ, DET, fitAt, fitSeries, variation, formLabel, sportShare, weeklyBySport, weekStats, vsAvg, listSeries, valueBefore, listVariation, recupColor, mondayOf, FIT_DAYS, PERIODS } };
document.addEventListener("velo:loaded", () => { if (window.Nav && window.Nav.curTab() === "synthese") open(); });
let rt, lw = innerWidth; addEventListener("resize", () => { if (innerWidth === lw) return; lw = innerWidth; clearTimeout(rt); rt = setTimeout(() => { if (window.Nav && window.Nav.curTab() === "synthese" && S_.D) render(); }, 150); });
if (window.Nav && window.Nav.curTab() === "synthese") open();
})();
