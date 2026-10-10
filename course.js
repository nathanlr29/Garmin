"use strict";
// Carte « Progression course » (onglet Activités, filtre Course) : chronos prédits, efficacité à cardio égal,
// allure seuil (3 sources + réglage runThrPace), jauge de reprise, indicateurs Garmin.
// Deux parties : des fonctions pures (testées par tests/course.mjs, exposées dans Course._) puis le rendu.
// Données : profile.run (via Recup, chargé à la demande par loadProfile() de index.html) et S.all.
(() => {
const DAY = 864e5, WEEK = 7 * DAY;
const K_DIST = "courseDist", K_THR = "runThrPace", K_THR_AT = "runThrPaceAt";

// ------------------------------------------------------------------ Constantes
const RIEGEL = 1.06;                       // T2 = T1 × (D2 / D1)^1,06
// Efficacité à cardio égal
const EFF = { minSec: 25 * 60, hrLo: .75, hrHi: .88, hrLoFb: 131, hrHiFb: 154,   // sorties retenues : FC moyenne entre 75 et 88 % de la FC seuil (131-154 bpm sans seuil)
  maxClimbPerKm: 15, refHr: 145, medianDays: 56, medianMin: 3, months: 18, cmpWeeks: 4 };
// Allure seuil à partir de tes efforts
const THR = { minSec: 15 * 60, maxSec: 75 * 60, days: 180, hrFrac: .9, hrFb: 157, staleDays: 8 * 7 };
// Jauge de reprise
const GAUGE = { zones: [.8, 1.3, 1.5], acuteDays: 7, chronicDays: 28, resumeKm: 15, bigWeekKm: 25, weeks: 12, scaleMax: 2 };
const DISTS = { "5k": { l: "5 km", m: 5000 }, "10k": { l: "10 km", m: 10000 }, "hm": { l: "Semi", m: 21097.5 }, "m": { l: "Marathon", m: 42195 } };
const HIST_COL = { "5k": 1, "10k": 2, "hm": 3, "m": 4 };   // colonnes de races.hist : [date, 5k, 10k, semi, marathon]

// ------------------------------------------------------------------ Fonctions pures
const isRun = a => window.Charge.RUN_TYPES.has(a.t);
const isTapis = a => a.t === "treadmill_running" || a.t === "virtual_run";
const num = v => typeof v === "number" && isFinite(v) ? v : null;
const T = a => a.dt.getTime();
const dayMs = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };

// Distance tenable en 60 min (Riegel) d'après un effort de D mètres en T secondes ; allure seuil correspondante en s/km
function riegelD60(D, Tsec) { return D > 0 && Tsec > 0 ? D * Math.pow(3600 / Tsec, 1 / RIEGEL) : null; }
const paceOfD60 = d60 => d60 > 0 ? 3600 / (d60 / 1000) : null;

const ltOf = run => (run && run.lt) || {};
const thrMinHr = run => { const hr = num(ltOf(run).hr); return hr ? THR.hrFrac * hr : THR.hrFb; };
const hrBand = run => { const hr = num(ltOf(run).hr); return hr ? [EFF.hrLo * hr, EFF.hrHi * hr] : [EFF.hrLoFb, EFF.hrHiFb]; };

// Sorties retenues pour l'efficacité : course dehors, ≥ 25 min, FC moyenne dans la bande, D+ / km < 15 m.
// Valeur = allure équivalente à 145 bpm (s/km), vitesse corrigée du D+ avec la constante de Charge.
function effPoints(acts, run, now = Date.now()) {
  const [lo, hi] = hrBand(run), climb = window.Charge.RUN_CLIMB, since = now - EFF.months * 30.4375 * DAY;
  return acts.filter(a => isRun(a) && !isTapis(a) && a.mt >= EFF.minSec && a.m > 0 && a.hr >= lo && a.hr <= hi && (a.el || 0) / a.km < EFF.maxClimbPerKm && T(a) >= since && T(a) <= now)
    .map(a => { const v = (a.m + climb * (a.el || 0)) / a.mt * EFF.refHr / a.hr; return { t: T(a), v: 1000 / v, a }; })
    .sort((x, y) => x.t - y.t);
}
function median(arr) { const s = arr.slice().sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }
// médiane glissante sur 8 semaines, évaluée à t (au moins 3 points, sinon null)
function medianAt(pts, t, days = EFF.medianDays, minN = EFF.medianMin) {
  const w = pts.filter(p => p.t <= t && p.t > t - days * DAY); return w.length >= minN ? median(w.map(p => p.v)) : null;
}
function medianSeries(pts, t0, t1) { const out = []; for (let t = t0; t <= t1 + 1; t += WEEK) { const v = medianAt(pts, t); if (v != null) out.push({ t, v }); } return out; }
// 4 dernières semaines contre les 4 précédentes (moyenne des vitesses à 145 bpm) ; pct > 0 = plus rapide
function effChange(pts, now = Date.now()) {
  const w = EFF.cmpWeeks * WEEK, a1 = pts.filter(p => p.t > now - w && p.t <= now), a0 = pts.filter(p => p.t > now - 2 * w && p.t <= now - w);
  if (!a1.length || !a0.length) return null;
  const sp = A => A.reduce((s, p) => s + 1000 / p.v, 0) / A.length, s1 = sp(a1), s0 = sp(a0);
  return { n1: a1.length, n0: a0.length, pct: (s1 / s0 - 1) * 100, pace1: 1000 / s1, pace0: 1000 / s0 };
}

// sorties régulières des 4 dernières semaines : nombre et allure moyenne (moyenne des vitesses) à 145 bpm
function effRecent(pts, now = Date.now()) {
  const a = pts.filter(p => p.t > now - EFF.cmpWeeks * WEEK && p.t <= now);
  return a.length ? { n: a.length, pace: 1000 / (a.reduce((s, p) => s + 1000 / p.v, 0) / a.length) } : null;
}

// Allure seuil d'après tes efforts : sorties de 15 à 75 min des 180 derniers jours à FC moyenne ≥ 90 % de la FC seuil (157 bpm sans seuil),
// distance tenable en 60 min par Riegel, on garde la meilleure. stale = effort retenu vieux de plus de 8 semaines.
function thrFromEfforts(acts, run, now = Date.now()) {
  const min = thrMinHr(run);
  let best = null;
  for (const a of acts) {
    if (!isRun(a) || a.mt < THR.minSec || a.mt > THR.maxSec || !(a.m > 0) || !(a.hr >= min) || now - T(a) > THR.days * DAY || T(a) > now) continue;
    const d60 = riegelD60(a.m, a.mt); if (d60 && (!best || d60 > best.d60)) best = { d60, a };
  }
  return best ? { pace: paceOfD60(best.d60), d60: best.d60, a: best.a, stale: now - T(best.a) > THR.staleDays * DAY, minHr: min } : null;
}
// Allure seuil d'après le 10 km prédit par Garmin
function thrFromPrediction(run) {
  const t = num(run && run.races && run.races["10k"]); if (!t) return null;
  const d60 = riegelD60(10000, t); return d60 ? { pace: paceOfD60(d60), t, d: run.races.d || null } : null;
}
// Saisie « m:ss » de l'allure seuil : { ok, sec } ou { ok: false, msg }
function parsePace(str) {
  const [lo, hi] = window.Charge.RUN_PACE_RANGE, fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const m = /^\s*(\d{1,2})\s*[:'’]\s*(\d{2})\s*$/.exec(String(str == null ? "" : str));
  if (!m || +m[2] > 59) return { ok: false, msg: `Écris l'allure au format m:ss, par exemple 4:05 (entre ${fmt(lo)} et ${fmt(hi)} /km).` };
  const sec = +m[1] * 60 + +m[2];
  return sec >= lo && sec <= hi ? { ok: true, sec } : { ok: false, msg: `L'allure seuil doit être entre ${fmt(lo)} et ${fmt(hi)} /km.` };
}

// Chronos : série [{t, v}] d'une colonne de races.hist, sans les trous
function histSeries(hist, key) {
  const c = HIST_COL[key]; return (hist || []).map(r => ({ t: dayMs(r[0]), v: num(r[c]) })).filter(p => p.v != null && p.v > 0 && !isNaN(p.t)).sort((a, b) => a.t - b.t);
}
// valeur connue à la date t (dernière valeur à cette date ou avant), null si la série n'existait pas encore
const valueAt = (ser, t) => { let v = null; for (const p of ser) { if (p.t <= t) v = p; else break; } return v; };
// variation entre la valeur courante et celle d'il y a `days` jours (ou d'une date de référence `since`) ; delta < 0 = plus rapide
function variation(ser, now, days, since) {
  if (!ser.length) return null;
  const cur = ser[ser.length - 1], ref = valueAt(ser, since != null ? since : now - days * DAY);
  return ref ? { cur: cur.v, ref: ref.v, refT: ref.t, delta: cur.v - ref.v, pct: (cur.v - ref.v) / ref.v * 100 } : null;
}

// Jauge de reprise, sur les km courus : aigu = 7 derniers jours, chronique = moyenne hebdo des 28 jours précédents
const mondayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
function weeklyKm(acts, now, n) {
  const m0 = mondayOf(now), W = Array.from({ length: n }, (_, i) => { const d = new Date(m0); d.setDate(d.getDate() - 7 * (n - 1 - i)); return { t: d.getTime(), km: 0 }; });
  for (const a of acts) { if (!isRun(a) || T(a) > now) continue; const k = Math.round((m0 - mondayOf(T(a))) / WEEK); if (k >= 0 && k < n) W[n - 1 - k].km += a.km; }
  return W;
}
function gaugeZone(r) { return r < GAUGE.zones[0] ? 0 : r <= GAUGE.zones[1] ? 1 : r <= GAUGE.zones[2] ? 2 : 3; }   // sous-charge, sûre, vigilance, risque élevé
function gauge(acts, now = Date.now()) {
  const runs = acts.filter(a => isRun(a) && T(a) <= now), sum = (t0, t1) => runs.filter(a => T(a) > t0 && T(a) <= t1).reduce((s, a) => s + a.km, 0);
  const acute = sum(now - GAUGE.acuteDays * DAY, now), chronic = sum(now - (GAUGE.acuteDays + GAUGE.chronicDays) * DAY, now - GAUGE.acuteDays * DAY) / (GAUGE.chronicDays / 7);
  const ratio = chronic > 0 ? acute / chronic : null, resume = chronic < GAUGE.resumeKm;
  // semaines (lundi-dimanche) écoulées depuis la dernière semaine à plus de 25 km
  const first = runs.length ? Math.min(...runs.map(T)) : now, n = Math.max(1, Math.round((mondayOf(now) - mondayOf(first)) / WEEK) + 1), all = weeklyKm(runs, now, n);
  let since = null; for (let i = all.length - 1; i >= 0; i--) if (all[i].km > GAUGE.bigWeekKm) { since = all.length - 1 - i; break; }
  return { acute, chronic, ratio, zone: ratio == null ? null : gaugeZone(ratio), resume, since, advice: chronic > 0 ? [chronic * GAUGE.zones[0], chronic * GAUGE.zones[1]] : null, weeks: weeklyKm(runs, now, GAUGE.weeks) };
}
// Indicateurs Garmin : liste [[date, valeur]] → valeur courante et variations
function seriesVar(list, now = Date.now()) {
  const ser = (list || []).map(r => ({ t: dayMs(r[0]), v: num(r[1]) })).filter(p => p.v != null && !isNaN(p.t)).sort((a, b) => a.t - b.t);
  if (!ser.length) return null;
  const v = d => { const r = variation(ser, now, d); return r ? { delta: r.delta, ref: r.ref } : null; };
  return { ser, cur: ser[ser.length - 1], d30: v(30), d90: v(90) };
}

// ------------------------------------------------------------------ État et réglage runThrPace
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const C = { msg: "" };
const prof = () => (window.Recup && window.Recup.data && window.Recup.data.profile) || {};
const runP = () => prof().run || null;
const thrAt = () => +ls.get(K_THR_AT) || 0;
const thrOwn = () => { const v = +ls.get(K_THR), [lo, hi] = window.Charge.RUN_PACE_RANGE; return v >= lo && v <= hi ? v : null; };
function thrItem() { const own = thrOwn(), at = thrAt(); return own != null || at ? { id: K_THR, ts: at || Date.now(), v: own } : null; }
// Enregistre (sec) ou supprime (null) le réglage ; la collection « reglages » de sync.js reprend l'élément (suppression = valeur null horodatée)
function setThr(sec) {
  const ts = Date.now();
  if (sec == null) ls.del(K_THR); else ls.set(K_THR, String(Math.round(sec)));
  ls.set(K_THR_AT, String(ts));
  if (window.Sync && window.Sync.push) window.Sync.push("reglages", [{ id: K_THR, ts, v: sec == null ? null : Math.round(sec) }]);
}
if (window.Sync && window.Sync.register) window.Sync.register("reglages", {
  local() { const it = thrItem(); return it ? [it] : []; },
  apply(items) {
    const it = items.find(x => x.id === K_THR); if (!it || !(it.ts > thrAt())) return;
    const [lo, hi] = window.Charge.RUN_PACE_RANGE, before = thrOwn();
    if (it.v == null) ls.del(K_THR); else if (+it.v >= lo && +it.v <= hi) ls.set(K_THR, String(Math.round(+it.v))); else return;
    ls.set(K_THR_AT, String(it.ts));
    if (thrOwn() !== before && window.Nav && window.Nav.curTab() === "activites" && S.all.length) window.render();   // la charge course change : on recalcule l'onglet
  }
});

// ------------------------------------------------------------------ Rendu : outils
const paceT = s => window.paceTxt(s), timeT = s => window.timeTxt(s);
const dLong = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dShort = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const sgn = v => v < 0 ? "−" : "+";
const dTime = sec => { const a = Math.abs(Math.round(sec)); return `${sgn(sec)}${a >= 3600 ? `${Math.floor(a / 3600)}:${String(Math.floor(a % 3600 / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}` : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`}`; };
const note = t => `<p class="note">${t}</p>`;
function timeTicks(lo, hi) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600], st = steps.find(s => (hi - lo) / s <= 4) || 3600, out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(v); return out;
}
// Graphique SVG de la carte Progression (mêmes classes, couleurs et infobulles que Bilan.progress) :
// axe des valeurs inversé (plus rapide = plus haut), points / courbe, ligne de repère, survol par la date la plus proche.
function plot(box, o) {
  if (!box) return;
  const W = Math.max(280, box.clientWidth || 400), H = 190, m = { l: 44, r: 10, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = o.t0, t1 = o.t1, vals = [...o.lines.flatMap(l => l.pts.map(p => p.v)), ...o.dots.map(p => p.v), ...(o.ref ? [o.ref.v] : [])];
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * .12 || hi0 * .03, lo = lo0 - pad, hi = hi0 + pad;
  const x = t => m.l + (t - t0) / Math.max(1, t1 - t0) * iw, y = v => m.t + (v - lo) / (hi - lo) * ih;   // inversé : valeur faible = en haut
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}"><g class="axis">`;
  for (const v of timeTicks(lo, hi)) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${o.fmt(v)}</text>`;
  const span = (t1 - t0) / (30.4375 * DAY), stepM = span > 10 ? 3 : 1, d0 = new Date(t0);
  for (let k = 1; k < 40; k++) { const f = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (f.getTime() > t1) break; if ((f.getMonth() % stepM) && stepM > 1) continue;
    s += `<text x="${x(f.getTime())}" y="${H - 5}" text-anchor="middle">${MONTHS[f.getMonth()]}${f.getMonth() === 0 ? " " + String(f.getFullYear()).slice(2) : ""}</text>`; }
  s += "</g>";
  if (o.ref) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(o.ref.v)}" y2="${y(o.ref.v)}" stroke="var(--accent)" stroke-dasharray="5 4"/><text x="${W - m.r}" y="${y(o.ref.v) - 5}" text-anchor="end" font-size="11" font-weight="700" fill="var(--accent)">${o.ref.label}</text>`;
  for (const l of o.lines) { const d = l.pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(p.v).toFixed(1)).join(""); if (d) s += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.w || 2}" stroke-linejoin="round" stroke-linecap="round"${l.op ? ` opacity="${l.op}"` : ""}/>`; }
  o.dots.forEach((p, i) => s += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="4" fill="var(--accent)" fill-opacity=".75" stroke="var(--card)" stroke-width="1.5" data-i="${i}" style="cursor:pointer"/>`);
  s += `<line class="crCur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" stroke-width="1" opacity="0"/><rect class="crHit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  box.innerHTML = s + (o.legend ? `<div class="legend bm-leg">${o.legend}</div>` : "");
  const svg = box.querySelector("svg"), cur = box.querySelector(".crCur"), hov = o.hover;
  const near = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width; let b = -1, bd = 1e9; hov.forEach((p, i) => { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; b = i; } }); return bd < 40 ? b : -1; };
  svg.addEventListener("pointermove", e => { const i = near(e); if (i < 0) { hideTip(); cur.setAttribute("opacity", 0); return; } cur.setAttribute("x1", x(hov[i].t)); cur.setAttribute("x2", x(hov[i].t)); cur.setAttribute("opacity", .6); showTip(e, hov[i].html); });
  svg.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
  if (o.onClick) svg.addEventListener("click", e => { const i = near(e); if (i >= 0) o.onClick(hov[i]); });
}
function spark(ser, color) {
  if (ser.length < 2) return "";
  const W = 120, H = 34, t0 = ser[0].t, t1 = ser[ser.length - 1].t, lo = Math.min(...ser.map(p => p.v)), hi = Math.max(...ser.map(p => p.v)), r = hi - lo || 1;
  const d = ser.map((p, i) => (i ? "L" : "M") + (2 + (p.t - t0) / Math.max(1, t1 - t0) * (W - 4)).toFixed(1) + "," + (H - 3 - (p.v - lo) / r * (H - 6)).toFixed(1)).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="crSpark" role="img" aria-label="Évolution"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ------------------------------------------------------------------ Rendu : les 5 blocs
const GOOD = "var(--good)", BAD = "var(--bad)";
function blkChronos(P) {
  const races = P && P.races, hist = races && races.hist;
  const keys = Object.keys(DISTS).filter(k => histSeries(hist, k).length >= 2);
  if (!keys.length) return `<div class="pg-box pg-wide"><h4>Mes chronos <small>le cours de tes chronos prédits</small></h4>${note("Pas encore d'historique de prédictions Garmin (il demande quelques semaines de courses avec cardio).")}</div>`;
  let k = ls.get(K_DIST); if (!keys.includes(k)) k = keys.includes("10k") ? "10k" : keys[0];
  const D = DISTS[k], ser = histSeries(hist, k), now = Date.now(), last = ser[ser.length - 1], cur = num(races[k]) || last.v;
  const jan1 = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const vars = [["30 j", variation(ser, now, 30)], ["90 j", variation(ser, now, 90)], ["depuis le 1er janv.", variation(ser, now, 0, jan1)]];
  const pr = P && P.pr && Array.isArray(P.pr[k]) ? P.pr[k] : null;
  const chips = keys.map(x => `<button class="chip" aria-pressed="${x === k}" data-dist="${x}">${DISTS[x].l}</button>`).join("");
  const vh = vars.map(([l, v]) => v ? `<div class="crvar" style="--c:${v.delta <= 0 ? GOOD : BAD}"><span>${l}</span><b>${dTime(v.delta)}</b><small>${sgn(v.pct)}${nf(Math.abs(v.pct), 1)} %</small></div>` : `<div class="crvar"><span>${l}</span><b>–</b><small>pas assez de recul</small></div>`).join("");
  return `<div class="pg-box pg-wide" id="crChrono"><h4>Mes chronos <small>le cours de tes chronos prédits par Garmin</small></h4>
    <div class="chips crchips" role="group" aria-label="Distance">${chips}</div>
    <div class="crnow"><span class="crbig">${timeT(cur)}</span><span class="crsub">${paceT(cur / (D.m / 1000))} /km · ${D.l} prédit${races.d ? ` le ${dLong(dayMs(races.d))}` : ""}</span></div>
    <div class="crvars">${vh}</div><div id="crChronoPlot"></div></div>`;
}
function plotChronos(P) {
  const box = document.getElementById("crChronoPlot"); if (!box) return;
  const k = document.querySelector("#crChrono [aria-pressed=true]").dataset.dist, D = DISTS[k], ser = histSeries(P.races.hist, k), pr = P.pr && Array.isArray(P.pr[k]) ? P.pr[k] : null;
  plot(box, { label: `Chrono prédit sur ${D.l}`, t0: ser[0].t, t1: Date.now(), fmt: timeT, lines: [{ pts: ser, color: "var(--accent)", w: 2.4 }], dots: [],
    ref: pr ? { v: pr[0], label: `record ${timeT(pr[0])}${pr[1] ? " · " + dShort(dayMs(pr[1])) : ""}` } : null,
    legend: `<span><i style="background:var(--accent)"></i>chrono prédit (plus rapide = plus haut)</span>${pr ? `<span><i style="background:repeating-linear-gradient(90deg,var(--accent) 0 3px,transparent 3px 6px)"></i>record Garmin${pr[1] ? ` du ${dLong(dayMs(pr[1]))}` : ""}</span>` : ""}`,
    hover: ser.map(p => ({ t: p.t, html: `<b>${dLong(p.t)}</b><br>${timeT(p.v)} · ${paceT(p.v / (D.m / 1000))} /km` })) });
}
function blkEff(P, acts) {
  const pts = effPoints(acts, P), now = Date.now();
  const head = `<h4>Efficacité à cardio égal <small>allure équivalente à ${EFF.refHr} bpm, sorties régulières dehors</small></h4>`;
  if (pts.length < 2) return `<div class="pg-box pg-wide" id="crEff">${head}${note("Il faut au moins 2 sorties régulières (dehors, 25 min et plus, cardio entre 75 et 88 % de ton seuil, peu de dénivelé) pour suivre ta progression.")}</div>`;
  const ch = effChange(pts, now), med = medianAt(pts, now), rec = effRecent(pts, now);
  const txt = ch ? `Sur les 4 dernières semaines : <b>${ch.pct >= 0 ? "+" : "−"}${nf(Math.abs(ch.pct), 1)} %</b> de vitesse à cardio égal par rapport aux 4 précédentes (${paceT(ch.pace0)} → ${paceT(ch.pace1)} /km)${ch.pct > 2 ? " : à cardio égal, tu cours plus vite." : ch.pct < -2 ? " : fatigue, chaleur ou séances plus intenses ?" : "."} La chaleur et la fatigue jouent aussi.`
    : rec ? `Sur les 4 dernières semaines : ${rec.n} sortie${rec.n > 1 ? "s" : ""} régulière${rec.n > 1 ? "s" : ""}, <b>${paceT(rec.pace)} /km</b> à ${EFF.refHr} bpm en moyenne. Pas de comparaison possible : aucune sortie régulière les 4 semaines d'avant. La chaleur et la fatigue jouent aussi.`
    : "Pas de sortie régulière sur les 4 dernières semaines : la tendance reviendra avec quelques sorties.";
  return `<div class="pg-box pg-wide" id="crEff">${head}${med != null ? `<div class="crnow"><span class="crbig">${paceT(med)}</span><span class="crsub">/km à ${EFF.refHr} bpm · médiane des 8 dernières semaines</span></div>` : rec ? `<div class="crnow"><span class="crbig">${paceT(rec.pace)}</span><span class="crsub">/km à ${EFF.refHr} bpm · moyenne des 4 dernières semaines</span></div>` : ""}<div id="crEffPlot"></div><p class="bm-p">${txt}</p></div>`;
}
function plotEff(P, acts) {
  const box = document.getElementById("crEffPlot"); if (!box) return;
  const pts = effPoints(acts, P), now = Date.now(), t0 = pts[0].t;
  plot(box, { label: "Efficacité à cardio égal", t0, t1: now, fmt: paceT, lines: [{ pts: medianSeries(pts, t0, now), color: "var(--ink)", w: 2, op: .7 }], dots: pts,
    legend: `<span><i style="background:var(--accent)"></i>une sortie (allure à ${EFF.refHr} bpm)</span><span><i style="background:var(--ink)"></i>médiane glissante sur 8 semaines</span>`,
    hover: pts.map(p => ({ t: p.t, id: p.a.id, html: `<b>${dShort(p.t)}</b> · ${esc(p.a.n)}<br>${paceT(p.v)} /km à ${EFF.refHr} bpm<br>réel : ${paceT(p.a.mt / p.a.km)} /km à ${nf(p.a.hr)} bpm · ${nf(p.a.el)} m D+` })),
    onClick: p => p.id && window.Bilan && window.Bilan.open(p.id) });
}
function blkThr(P, acts) {
  const now = Date.now(), cp = window.Charge.params(), g = P && P.lt && P.lt.pace ? P.lt : null, own = thrOwn(), eff = thrFromEfforts(acts, P, now), pred = thrFromPrediction(P);
  const used = cp.runPace ? `<b>${paceT(cp.runPace)} /km</b> · ${own ? "ton réglage (runThrPace)" : "seuil Garmin"}${!own && g && g.d ? ` mesuré le ${dLong(dayMs(g.d))}` : ""}` : `aucune : la charge course est estimée à la fréquence cardiaque`;
  const row = (l, v, sub, btn) => `<div class="crsrc"><div><span class="crl">${l}</span><b>${v}</b></div><div class="crs">${sub}</div>${btn || ""}</div>`;
  let rows = row("Garmin", g ? `${paceT(g.pace)} /km` : "–", g ? `seuil lactique${g.hr ? ` · FC ${nf(g.hr)} bpm` : ""}${g.d ? ` · ${dLong(dayMs(g.d))}` : ""}` : "pas de seuil mesuré par la montre");
  if (eff) rows += row("Tes efforts", `${paceT(eff.pace)} /km`, `<button class="lnk" data-bilan="${eff.a.id}">${esc(eff.a.n)}</button> · ${dLong(T(eff.a))} · ${nf(eff.a.km, 1)} km en ${timeT(eff.a.mt)}, FC ${nf(eff.a.hr)} bpm (Riegel, 60 min)${eff.stale ? `<br><span class="crwarn">Effort ancien : refais un test.</span> <span>30 min à fond régulier : l'allure des 20 dernières minutes ≈ ton seuil.</span>` : ""}`, `<button class="btn crbtn" data-use="${Math.round(eff.pace)}">Utiliser</button>`);
  else rows += row("Tes efforts", "–", `aucune sortie de 15 à 75 min avec cardio ≥ ${nf(Math.round(thrMinHr(P)))} bpm sur les 6 derniers mois.<br><span>30 min à fond régulier : l'allure des 20 dernières minutes ≈ ton seuil.</span>`);
  if (pred) rows += row("Prédictions Garmin", `${paceT(pred.pace)} /km`, `d'après ton 10 km prédit en ${timeT(pred.t)}${pred.d ? ` · ${dLong(dayMs(pred.d))}` : ""} (Riegel, 60 min)`, `<button class="btn crbtn" data-use="${Math.round(pred.pace)}">Utiliser</button>`);
  return `<div class="pg-box pg-wide" id="crThr"><h4>Allure seuil <small>la référence de ta charge course (rTSS)</small></h4>
    <p class="crused">Utilisée en ce moment : ${used}</p><div class="crsrcs">${rows}</div>
    <form class="crown" autocomplete="off"><label>Ta valeur <input type="text" inputmode="numeric" class="crin" placeholder="m:ss" size="6" maxlength="5" aria-label="Allure seuil au format m:ss par km"></label><button class="btn crbtn" type="submit">Enregistrer</button>${own ? `<button class="btn crbtn" type="button" data-garmin>Revenir à Garmin</button>` : ""}</form>
    <p class="note crmsg" role="status">${C.msg || ""}</p>
    <p class="note">${window.Sync && window.Sync.configured && window.Sync.configured() ? "Ce réglage suit tes autres appareils (synchro activée)." : "Ce réglage reste sur cet appareil (active la synchro pour qu'il suive l'iPhone et le PC)."}</p></div>`;
}
function blkGauge(acts) {
  const G = gauge(acts), names = ["sous-charge", "zone sûre", "vigilance", "risque élevé"], cols = ["var(--info)", "var(--good)", "var(--warn)", "var(--bad)"];
  const head = `<h4>Jauge de reprise <small>km courus : les tendons suivent moins vite que le cardio entretenu par le vélo</small></h4>`;
  if (!acts.some(isRun)) return `<div class="pg-box pg-wide" id="crGauge">${head}${note("Pas encore de course enregistrée.")}</div>`;
  const z = GAUGE.zones, sc = GAUGE.scaleMax, bounds = [0, z[0], z[1], z[2], sc], bar = cols.map((c, i) => `<div style="width:${(bounds[i + 1] - bounds[i]) / sc * 100}%;background:${c}" title="${names[i]}"></div>`).join("");
  const mark = G.ratio != null ? `<div class="crmark" style="left:${Math.min(sc, G.ratio) / sc * 100}%"></div>` : "";
  const state = G.ratio == null ? "pas de course sur les 4 semaines précédentes : le ratio n'a pas de sens" : `${nf(G.ratio, 2)} · <b style="color:${cols[G.zone]}">${names[G.zone]}</b>`;
  const wk = G.weeks, mx = Math.max(...wk.map(w => w.km), 10);
  const bars = wk.map((w, i) => `<div class="crwk" data-i="${i}" title="${dShort(w.t)} : ${nf(w.km, 1)} km"><div class="crwkb" style="height:${w.km / mx * 100}%;${i === wk.length - 1 ? "opacity:.55" : ""}"></div><span>${i % 2 === (wk.length - 1) % 2 ? dShort(w.t).replace(" ", " ") : ""}</span></div>`).join("");
  return `<div class="pg-box pg-wide" id="crGauge">${head}
    <div class="crgauge"><div class="crgbar">${bar}${mark}</div><div class="crglab"><span>0</span><span>${nf(z[0], 1)}</span><span>${nf(z[1], 1)}</span><span>${nf(z[2], 1)}</span><span>${sc}</span></div></div>
    <p class="bm-p">Ratio aigu / chronique : ${state}. Aigu : <b>${nf(G.acute, 1)} km</b> sur 7 jours · chronique : <b>${nf(G.chronic, 1)} km/sem.</b> sur les 4 semaines d'avant.${G.advice && !G.resume ? ` Volume conseillé cette semaine : <b>${nf(G.advice[0])} à ${nf(G.advice[1])} km</b> (chronique × ${z[0]} à ${z[1]}).` : ""}</p>
    ${G.resume ? `<p class="bm-p crresume"><b>Mode reprise</b> (moins de ${GAUGE.resumeKm} km/sem. en moyenne) : reprise : 2 à 3 sorties faciles, +10 % par semaine au plus, garde du jus. ${G.since != null ? `Dernière semaine à plus de ${GAUGE.bigWeekKm} km : il y a ${G.since} semaine${G.since > 1 ? "s" : ""}.` : `Aucune semaine à plus de ${GAUGE.bigWeekKm} km dans l'historique.`}</p>` : ""}
    <div class="crwks" aria-label="Km par semaine, 12 dernières semaines">${bars}</div><p class="note">Kilomètres courus par semaine (lundi à dimanche), la semaine en cours est en clair.</p></div>`;
}
function blkIndic(P) {
  const defs = [["vo2", "VO2max course", "", 1], ["endu", "Score d'endurance", "", 0], ["hill", "Hill score", "", 0]];
  const T_ = defs.map(([k, l, , d]) => ({ k, l, d, s: seriesVar(P && P[k]) })).filter(x => x.s);
  const head = `<h4>Indicateurs Garmin <small>valeur actuelle, variation sur 30 et 90 jours</small></h4>`;
  if (!T_.length) return `<div class="pg-box pg-wide" id="crInd">${head}${note("Pas d'indicateur de course mesuré par la montre pour le moment.")}</div>`;
  const dv = (v, d) => v ? `<span style="color:${v.delta >= 0 ? GOOD : BAD}">${v.delta === 0 ? "=" : sgn(v.delta) + nf(Math.abs(v.delta), d)}</span>` : "–";
  return `<div class="pg-box pg-wide" id="crInd">${head}<div class="crtiles">${T_.map(x => `<div class="tile crtile"><div class="l">${x.l}</div><div class="v">${nf(x.s.cur.v, x.d)}</div>
    <div class="crd"><span>30 j ${dv(x.s.d30, x.d)}</span><span>90 j ${dv(x.s.d90, x.d)}</span></div>${spark(x.s.ser, "var(--accent)")}<div class="s">au ${dLong(x.s.cur.t)}</div></div>`).join("")}</div></div>`;
}

// ------------------------------------------------------------------ Rendu de la carte
function render(box) {
  box = box || document.getElementById("progCourseBody"); if (!box) return;
  C.box = box;
  if (!(window.Recup && window.Recup.data)) {   // profil Garmin pas encore chargé : on le demande une fois, la carte se complète dès qu'il est là
    box.innerHTML = note("Chargement du profil Garmin…");
    if (window.loadProfile) window.loadProfile().then(ok => { if (ok && window.Recup.data && C.box === box && document.body.contains(box)) render(box); });
    else { box.innerHTML = ""; }
    return;
  }
  const P = runP(), acts = S.all || [];
  box.innerHTML = `<div class="pg-grid crcard">${blkChronos(P)}${blkEff(P, acts)}${blkThr(P, acts)}${blkGauge(acts)}${blkIndic(P)}</div>`;
  if (P && document.getElementById("crChronoPlot")) plotChronos(P);
  if (document.getElementById("crEffPlot")) plotEff(P, acts);
  bind(box, P);
}
function bind(box, P) {
  const again = () => render(box);
  box.querySelectorAll("[data-dist]").forEach(b => b.onclick = () => { ls.set(K_DIST, b.dataset.dist); C.msg = ""; again(); });
  box.querySelectorAll("[data-bilan]").forEach(b => b.onclick = () => window.Bilan && window.Bilan.open(+b.dataset.bilan));
  const apply = (sec, what) => {   // la charge course change : on recalcule tout l'onglet (rTSS), Forme / Récup / Plan se recalculent à leur ouverture
    setThr(sec);
    C.msg = sec == null ? "Retour au seuil Garmin. La charge course est recalculée : Forme, Récup et Plan suivent." : `Allure seuil réglée sur ${paceT(sec)} /km (${what}). La charge course est recalculée : Forme, Récup et Plan suivent.`;
    if (window.render) window.render(); else again();
  };
  box.querySelectorAll("[data-use]").forEach(b => b.onclick = () => {
    const r = parsePace(paceT(+b.dataset.use));
    if (!r.ok) { C.msg = r.msg; return again(); }
    apply(r.sec, b.closest(".crsrc").querySelector(".crl").textContent.toLowerCase());
  });
  const g = box.querySelector("[data-garmin]"); if (g) g.onclick = () => apply(null);
  const f = box.querySelector(".crown");
  if (f) f.onsubmit = e => { e.preventDefault(); const r = parsePace(f.querySelector(".crin").value); if (!r.ok) { box.querySelector(".crmsg").textContent = r.msg; C.msg = r.msg; return; } apply(r.sec, "saisie"); };
}

window.Course = { render, _: { setThr, thrOwn, thrItem, riegelD60, paceOfD60, effPoints, median, medianAt, medianSeries, effChange, effRecent, thrFromEfforts, thrFromPrediction, parsePace, histSeries, valueAt, variation, weeklyKm, gauge, gaugeZone, seriesVar, mondayOf, EFF, THR, GAUGE, RIEGEL } };
})();
