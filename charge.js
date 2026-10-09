"use strict";
// Charge d'entraînement : classement des sports, TSS d'une activité, charge par jour (et par sport),
// série fond / fatigue / forme (CTL / ATL / TSB) et charge récente rapportée à l'habituelle.
// Un seul endroit pour le calcul : recup.js et plan.js (et plus tard la Synthèse) s'appuient dessus.
// Chargé avant recup.js ; lit S.all et RIDE_TYPES (index.html) au moment du calcul, jamais au chargement.
(() => {
const RUN_TYPES = new Set(["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]);
const pad = n => String(n).padStart(2, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t; };
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const all = () => S.all || [];

// vélo | run | strength | other
function sportOf(a) {
  if (RIDE_TYPES.has(a.t)) return "bike";
  if (RUN_TYPES.has(a.t)) return "run";
  if (a.t === "strength_training") return "strength";
  return "other";
}

// Seuils lus au moment du calcul : FTP = saisie dans le Plan, sinon FTP Garmin, sinon 250 ; LTHR = seuil Garmin, sinon 165
function params() {
  const p = (window.Recup && window.Recup.data && window.Recup.data.profile) || {};
  let own = 0; try { own = +localStorage.getItem("planFtp"); } catch (e) {}
  return { ftp: own || p.ftp || 250, lthr: (p.hrZones && p.hrZones.lthr) || 165 };
}

// Charge d'une activité en TSS : puissance si on l'a (vélo), sinon cardio rapporté au seuil
function tssOf(a, p = params()) {
  const h = (a.mt || 0) / 3600; if (!h) return 0;
  const pw = a.np || a.w, IF = pw > 0 && RIDE_TYPES.has(a.t) ? pw / p.ftp : a.hr > 0 ? a.hr / p.lthr : .65;
  return h * clamp(IF, .4, 1.2) ** 2 * 100;
}

// Charge par jour : { "2026-10-09": tss }
function dayLoads(acts = all(), p = params()) {
  const m = {}; acts.forEach(a => { const k = a.d.slice(0, 10); m[k] = (m[k] || 0) + tssOf(a, p); }); return m;
}
// Charge par jour et par sport : { "2026-10-09": { bike, run, strength, other } }
function dayLoadsBySport(acts = all(), p = params()) {
  const m = {}; acts.forEach(a => { const k = a.d.slice(0, 10), s = sportOf(a), d = m[k] || (m[k] = { bike: 0, run: 0, strength: 0, other: 0 }); d[s] += tssOf(a, p); }); return m;
}
function dayLoad(dt, acts = all(), p = params()) { const key = ymd(dt); return acts.filter(a => a.d.slice(0, 10) === key).reduce((s, a) => s + tssOf(a, p), 0); }

// Fond (42 j) / fatigue (7 j) / forme sur les `days` jours qui précèdent `today` (aujourd'hui exclu)
function series(loads, today = new Date(), days = 120) {
  let ctl = 0, atl = 0; const out = [];
  for (let d = addDays(today, -days); d < today; d = addDays(d, 1)) {
    const l = loads[ymd(d)] || 0; ctl += (l - ctl) / 42; atl += (l - atl) / 7;
    out.push({ d: ymd(d), ctl, atl, tsb: ctl - atl });
  }
  return { ctl, atl, tsb: ctl - atl, days: out };
}
function fitness(today = new Date(), acts = all()) { const s = series(dayLoads(acts), today); return { ctl: s.ctl, atl: s.atl, tsb: s.tsb }; }

// Charge des 2 jours précédents `dt` rapportée aux 4 semaines d'avant (score « Charge récente » de la récup)
function loadPart(dt, acts = all()) {
  const p = params(), day = k => addDays(dt, -k), dl = k => dayLoad(day(k), acts, p);
  const acute = dl(1) + .5 * dl(2);
  let chronic = 0; for (let k = 2; k <= 29; k++) chronic += dl(k); chronic = chronic / 28 * 1.5;
  if (!(chronic > 0)) return null;
  const ratio = acute / chronic, key = ymd(day(1)), km = acts.filter(a => a.d.slice(0, 10) === key).reduce((s, a) => s + a.km, 0);
  return { ratio, km, score: Math.round(clamp(100 - 35 * Math.max(0, ratio - .6), 0, 100)) };
}

window.Charge = { RUN_TYPES, sportOf, params, tssOf, dayLoads, dayLoadsBySport, dayLoad, series, fitness, loadPart, ymd };
})();
