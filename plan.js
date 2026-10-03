"use strict";
// Onglet « Plan » : génère les séances de la semaine (MyWhoosh ou dehors) selon la FTP,
// la forme du moment, les dernières activités et les habitudes. Objectif : FTP 300 W et VO2max 65-66 fin 2026.
(() => {
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t; };
const mondayOf = d => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() - (t.getDay() + 6) % 7); return t; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + pad(m % 60) : ""}` : `${m} min`;
const W5 = v => Math.round(v / 5) * 5;
const store2 = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

const GOAL = { ftp: 300, vo2: 65.5, end: new Date(2026, 11, 31) };
const START = new Date(2026, 9, 5);  // lundi 5 octobre : début du premier bloc
const DAYN = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DURS = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 270, 300];
const TYPES = {
  auto: { l: "Auto" },
  vo2: { l: "VO2max", c: "#d6336c", hard: 1 },
  vo2s: { l: "VO2max 30/30", c: "#c2255c", hard: 1 },
  thr: { l: "Seuil", c: "#e8501c", hard: 1 },
  ss: { l: "Sweet spot", c: "#f08c00", hard: 1 },
  tempo: { l: "Tempo", c: "#e0a800" },
  end: { l: "Endurance", c: "#2f9e44" },
  long: { l: "Sortie longue", c: "#1c7ed6" },
  longplus: { l: "Longue + seuil", c: "#1864ab", hard: 1 },
  rec: { l: "Récupération", c: "#868e96" },
  test: { l: "Test FTP", c: "#7048e8", hard: 1 },
};
const ZONES = [[.56, "Z1", "#a5b1bd"], [.76, "Z2", "#4aa3df"], [.88, "Z3", "#2fb380"], [1.05, "Z4", "#f2b134"], [1.2, "Z5", "#ef6c3a"], [9, "Z6", "#d6336c"]];
const zoneOf = f => ZONES.findIndex(z => f < z[0]);
const RPE = ["2/10, très facile", "3-4/10, conversation facile", "5-6/10, soutenu", "7/10, dur mais tenable", "8-9/10, très dur", "9-10/10, maximal"];

// ------------------------------------------------------------------ Données
const rides = () => (S.all || []).filter(a => RIDE_TYPES.has(a.t));
const isTraining = a => a.mt >= 1200;  // les trajets du quotidien (moins de 20 min) ne comptent pas comme séances
function profile() {
  const p = (window.Recup && Recup.data && Recup.data.profile) || {};
  const own = store2.get("planFtp");
  const est = estimateFtp();
  const ftp = own || p.ftp || est || 250;
  return { ...p, ftp, ftpSrc: own ? "saisie" : p.ftp ? `Garmin${p.ftpDate ? " · " + new Date(p.ftpDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}` : est ? "estimée sur tes séances" : "par défaut", est };
}
function estimateFtp() { // meilleure puissance normalisée sur 40 min et plus, ces 90 derniers jours
  const cut = addDays(new Date(), -90);
  const c = rides().filter(a => a.dt >= cut && (a.np || a.w) && a.mt >= 2400).map(a => (a.np || a.w) * (a.mt >= 3600 ? .97 : .93));
  return c.length ? W5(Math.max(...c)) : null;
}
function dayLoads() { const m = {}; (S.all || []).forEach(a => { const k = a.d.slice(0, 10); m[k] = (m[k] || 0) + (a.tl || a.mt / 60); }); return m; }
function fitness() {
  const m = dayLoads(), today = new Date(); let ctl = 0, atl = 0;
  for (let d = addDays(today, -120); d < today; d = addDays(d, 1)) { const l = m[ymd(d)] || 0; ctl += (l - ctl) / 42; atl += (l - atl) / 7; }
  const p = profile();
  const hard = rides().filter(a => a.te >= 3.8 || ((a.np || a.w) && (a.np || a.w) / p.ftp >= .85 && a.mt >= 1500)).pop();
  const wk = rides().filter(a => a.dt >= addDays(today, -7)), tr = wk.filter(isTraining);
  return { ctl, atl, tsb: ctl - atl, lastHard: hard ? Math.floor((today - hard.dt) / 864e5) : null, km7: wk.reduce((s, a) => s + a.km, 0), h7: wk.reduce((s, a) => s + a.mt, 0) / 3600, n7: tr.length, c7: wk.length - tr.length };
}
function readiness() {
  const days = (window.Recup && Recup.days) || [], last = days.filter(d => d.sl || d.tr != null).slice(-3);
  const sc = last.map(d => Recup.recoScore(d).score).filter(v => v != null);
  return { today: sc.length ? sc[sc.length - 1] : null, avg3: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null };
}
function habits() {
  const cut = addDays(new Date(), -56), R = rides().filter(a => a.dt >= cut && isTraining(a));
  const by = Array.from({ length: 7 }, () => ({ n: 0, inn: 0, mins: [] }));
  R.forEach(a => { const w = (a.dt.getDay() + 6) % 7; by[w].n++; if (isIndoor(a)) by[w].inn++; by[w].mins.push(a.mt / 60); });
  const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 60; };
  return { perWeek: R.length / 8, by: by.map(b => ({ n: b.n, indoor: b.n ? b.inn / b.n : .5, dur: med(b.mins) })) };
}
function phase(monday) {
  const wi = Math.floor((monday - START) / (7 * 864e5));
  if (monday >= mondayOf(new Date(2026, 11, 28))) return { wi, block: 4, wk: 1, deload: true, final: true, focus: "Semaine de tests : on mesure le chemin parcouru" };
  const w = Math.max(0, wi), block = Math.min(3, Math.floor(w / 4) + 1), wk = w % 4 + 1;
  const focus = ["", "Seuil et sweet spot, premières séances VO2max", "Bloc VO2max", "VO2max et seuil haut, on consolide"][block];
  return { wi, block, wk, deload: wk === 4, final: false, focus };
}

// ------------------------------------------------------------------ Réglages de la semaine
function defaults() {
  const h = habits();
  let order = h.by.map((b, i) => ({ i, n: b.n })).sort((a, b) => b.n - a.n);
  const count = h.perWeek >= 1 ? clamp(Math.round(h.perWeek), 2, 6) : 3;
  let days = order.filter(o => o.n > 0).slice(0, count).map(o => o.i);
  if (days.length < count) [1, 3, 5, 6, 2, 0, 4].forEach(d => { if (days.length < count && !days.includes(d)) days.push(d); });
  days.sort((a, b) => a - b);
  return days.map(d => { const b = h.by[d], out = d >= 5 && b.indoor < .6; let dur = DURS.reduce((a, x) => Math.abs(x - b.dur) < Math.abs(a - b.dur) ? x : a, 60);
    if (!b.n) dur = d >= 5 ? 180 : 60; return { day: d, dur: clamp(dur, 45, out ? 300 : 120), place: out || b.indoor < .4 ? "out" : "mw", type: "auto" }; });
}
function weekTarget() { const t = new Date(), mon = mondayOf(t); return (t.getDay() === 0 || t.getDay() === 6) ? addDays(mon, 7) : mon; }

// ------------------------------------------------------------------ Générateur
function chooseTypes(sess, ph, form, ready) {
  const n = sess.length; let K = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  if (n === 4 && ready.today >= 75 && form.tsb > -10 && !ph.deload) K = 3;
  if (ph.deload) K = 1;
  const tired = (ready.today != null && ready.today < 45) || form.tsb < -25;
  if (tired) K = Math.max(0, K - 1);
  const pools = { 1: ["thr", "vo2", "ss"], 2: ["vo2", "thr", "vo2s"], 3: ["vo2", "thr", "vo2s"], 4: ["test"] };
  let hardList = ph.deload ? (ph.final || ph.wk === 4 ? ["test"] : ["vo2"]) : pools[ph.block].slice(0, K);
  hardList = hardList.slice(0, K);
  const out = sess.map(s => ({ ...s, t: s.type !== "auto" ? s.type : null }));
  // séances imposées
  const forcedHard = out.filter(s => s.t && TYPES[s.t].hard).length;
  let remaining = hardList.slice(0, Math.max(0, K - forcedHard));
  // candidates : MyWhoosh d'abord (puissance maîtrisée), 45 min minimum
  const isLong = s => s.place === "out" && s.dur >= 150;
  const busy = () => out.filter(s => s.t && TYPES[s.t].hard).map(s => s.day);
  remaining.forEach(type => {
    const cands = out.filter(s => !s.t && s.dur >= (type === "test" ? 60 : 45) && !(isLong(s) && out.length > 1));
    if (!cands.length) return;
    const gapTo = s => { const hd = busy(); return hd.length ? Math.min(...hd.map(d => Math.abs(d - s.day))) : 7; };
    // deux séances dures collées : on préfère y renoncer et muscler la sortie longue
    if (busy().length && cands.every(c => gapTo(c) <= 1) && out.some(isLong)) { out.find(isLong).boost = true; return; }
    const score = s => { const hd = busy(), longD = out.filter(isLong).map(x => x.day);
      const gap = hd.length ? Math.min(...hd.map(d => Math.abs(d - s.day))) : 7;
      return (s.place === "mw" ? 10 : 0) + Math.min(gap, 3) * 3 - (gap === 1 ? 12 : 0) - (longD.includes(s.day + 1) ? 2 : 0) - (longD.includes(s.day - 1) ? 8 : 0) - (gap === 0 ? 50 : 0) + (type === "test" ? s.day : 0) * .1; };
    const best = cands.sort((a, b) => score(b) - score(a))[0];
    const longS = out.find(isLong);
    if (busy().length && score(best) < 5 && longS && !longS.boost && type !== "test") { longS.boost = true; return; }
    best.t = type;
  });
  // le reste : longue, endurance ou récup
  out.forEach((s, i) => {
    if (s.t) return;
    const prevHard = out.some(o => o.t && TYPES[o.t].hard && o.day === s.day - 1);
    if (isLong(s)) s.t = s.boost ? "longplus" : "long";
    else if ((prevHard && s.dur <= 60) || (tired && i === 0)) s.t = "rec";
    else s.t = (!ph.deload && s.dur >= 75 && !tired && K < 3) ? "tempo" : "end";
  });
  return { list: out, K, tired };
}

// pas : { d: secondes, lo, hi (fraction de FTP), free?, label }
function build(type, durMin, ph, form) {
  const T = durMin * 60, S = [], p = clamp(ph.wk, 1, 3) - 1, light = ph.deload ? .8 : 1;
  const ramp = (d, lo, hi, label) => S.push({ d, lo, hi, label });
  const st = (d, f, label) => S.push({ d, lo: f, hi: f, label });
  const hardWarm = () => { ramp(600, .5, .75, "Échauffement progressif"); st(60, 1.02, "Activation"); st(60, .55, "Récup"); st(60, 1.02, "Activation"); st(60, .55, "Récup"); };
  const cool = d => ramp(d, .65, .45, "Retour au calme");
  const used = () => S.reduce((a, s) => a + s.d, 0);
  const fill = (end, f = .65, label = "Endurance") => { const r = T - end - used(); if (r >= 120) st(r, f, label); };
  let title = TYPES[type].l, goal = "";
  if (type === "vo2") {
    const on = [240, 240, 300][p], off = Math.round(on * .75), pct = [1.15, 1.17, 1.18][p];
    hardWarm(); const M = T - used() - 480, reps = clamp(Math.floor((M + off) / (on + off) * light), 3, [5, 6, 5][p]);
    for (let i = 0; i < reps; i++) { st(on, pct, `Intervalle ${i + 1}/${reps}`); if (i < reps - 1) st(off, .5, "Récupération"); }
    fill(480); cool(480); title = `VO2max ${reps} × ${on / 60}'`; goal = `Le cœur du travail VO2max : ${reps} efforts de ${on / 60} min à ${Math.round(pct * 100)} % de FTP. Tenir la puissance jusqu'au bout, cadence 95-105.`;
  } else if (type === "vo2s") {
    hardWarm(); const M = T - used() - 480, sets = clamp(Math.floor((M + 300) / 900 * light), 1, 3);
    for (let k = 0; k < sets; k++) { for (let i = 0; i < 10; i++) { st(30, 1.3, `Série ${k + 1} · ${i + 1}/10`); st(30, .5, "Récup"); } if (k < sets - 1) st(300, .55, "Entre deux séries"); }
    fill(480); cool(480); title = `VO2max ${sets} × 10 × 30/30`; goal = `Des efforts courts à 130 % qui font monter la VO2 sans s'épuiser : ${sets} série${sets > 1 ? "s" : ""} de 10 × (30 s dur / 30 s facile).`;
  } else if (type === "thr") {
    const L = [12, 15, 20][p] * 60, pct = [.95, .97, 1.0][p];
    hardWarm(); const M = T - used() - 480, reps = clamp(Math.floor((M + 300) / (L + 300) * light), 2, 4);
    for (let i = 0; i < reps; i++) { st(L, pct, `Bloc seuil ${i + 1}/${reps}`); if (i < reps - 1) st(300, .55, "Récupération"); }
    fill(480); cool(480); title = `Seuil ${reps} × ${L / 60}'`; goal = `Repousser la FTP : ${reps} blocs de ${L / 60} min à ${Math.round(pct * 100)} %. Puissance régulière, pas de départ trop fort.`;
  } else if (type === "ss") {
    const L = [12, 15, 20][p] * 60, pct = .9;
    ramp(600, .5, .75, "Échauffement progressif"); const M = T - used() - 360, reps = clamp(Math.floor((M + 240) / (L + 240) * light), 2, 4);
    for (let i = 0; i < reps; i++) { st(L, pct, `Sweet spot ${i + 1}/${reps}`); if (i < reps - 1) st(240, .55, "Récupération"); }
    fill(360); cool(360); title = `Sweet spot ${reps} × ${L / 60}'`; goal = `Beaucoup de temps juste sous le seuil (88-92 %) : efficace pour faire monter la FTP sans trop de fatigue.`;
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
  } else if (type === "test") {
    ramp(600, .5, .75, "Échauffement"); st(180, 1.05, "Ouverture"); st(300, .55, "Récup"); st(300, 1.1, "Effort de 5 min pour vider l'anaérobie"); st(600, .55, "Récup");
    S.push({ d: 1200, lo: 1, hi: 1, free: true, label: "TEST : 20 min le plus fort possible, régulier" });
    fill(600, .55, "Souple"); cool(600); title = "Test FTP 20 min"; goal = "On mesure : ta nouvelle FTP = 95 % de ta puissance moyenne sur les 20 min. Pars prudemment les 5 premières minutes.";
  }
  for (let k = S.length - 1; k >= 0; k--) if (S[k].d < 30) S.splice(k, 1);
  const tss = Math.round(S.reduce((a, s) => { const f = s.free ? 1 : (s.lo + s.hi) / 2; return a + s.d / 3600 * f * f * 100; }, 0));
  return { title, goal, steps: S, tss };
}

// ------------------------------------------------------------------ Export MyWhoosh (.zwo)
function zwo(s, prof) {
  const x = v => v.toFixed(3), esc2 = t => String(t).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const lines = s.w.steps.map((st, i) => {
    if (st.free) return `    <FreeRide Duration="${st.d}" FlatRoad="1"/>`;
    if (st.lo !== st.hi) { const tag = i === 0 ? "Warmup" : i === s.w.steps.length - 1 ? "Cooldown" : "Ramp"; return `    <${tag} Duration="${st.d}" PowerLow="${x(st.lo)}" PowerHigh="${x(st.hi)}"/>`; }
    return `    <SteadyState Duration="${st.d}" Power="${x(st.lo)}"/>`;
  }).join("\n");
  return `<workout_file>\n  <author>Breizh Watts</author>\n  <name>${esc2(s.w.title)}</name>\n  <description>${esc2(s.w.goal + ` (FTP de référence : ${prof.ftp} W)`)}</description>\n  <sportType>bike</sportType>\n  <tags/>\n  <workout>\n${lines}\n  </workout>\n</workout_file>\n`;
}
function fileName(s) { return `${ymd(s.date)}_${s.w.title.replace(/[^A-Za-z0-9À-ÿ×' ]/g, "").replace(/[×' ]+/g, "-")}.zwo`; }
function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function downloadAll(list, prof) {
  if (!window.JSZip) await new Promise((ok, ko) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
  const z = new JSZip(); list.forEach(s => z.file(fileName(s), zwo(s, prof)));
  const blob = await z.generateAsync({ type: "blob" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `seances_${ymd(list[0].date)}.zip`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ------------------------------------------------------------------ Affichage
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
function stepsTable(s, prof) {
  const st = s.w.steps, same = (a, b) => a && b && a.d === b.d && a.lo === b.lo && a.hi === b.hi && !!a.free === !!b.free;
  const base = l => l.split(/ \d/)[0];
  const rows = []; let i = 0;
  while (i < st.length) {
    if (i + 3 < st.length && same(st[i], st[i + 2]) && same(st[i + 1], st[i + 3])) {
      let k = 1; while (i + 2 * k + 1 < st.length && same(st[i], st[i + 2 * k]) && same(st[i + 1], st[i + 2 * k + 1])) k++;
      let reps = k, j = i + 2 * k; if (same(st[j], st[i])) { reps++; j++; }
      rows.push({ on: st[i], off: st[i + 1], reps }); i = j;
    } else { rows.push({ on: st[i] }); i++; }
  }
  const out = s.place === "out";
  const tgt = x => { const f = (x.lo + x.hi) / 2;
    if (x.free) return out ? "à fond, régulier" : "libre : à fond, régulier";
    if (out) return `${hrRange(f, prof) ? hrRange(f, prof) + " · " : ""}RPE ${RPE[Math.min(5, zoneOf(f))]}`;
    return (x.lo === x.hi ? `${W5(x.lo * prof.ftp)} W` : `${W5(x.lo * prof.ftp)} → ${W5(x.hi * prof.ftp)} W`) + ` <small>${Math.round(x.lo * 100)}${x.lo !== x.hi ? "-" + Math.round(x.hi * 100) : ""} %</small>`; };
  const dot = x => `<i style="background:${ZONES[zoneOf(x.free ? 1.02 : Math.max(x.lo, x.hi))][2]}"></i>`;
  return `<table class="steps"><tbody>${rows.map(r => r.off
    ? `<tr><td>${dot(r.on)}${r.reps} × ${cleanDur(r.on.d)}</td><td>${base(r.on.label)}<small>récup ${cleanDur(r.off.d)} entre chaque</small></td><td class="tg">${tgt(r.on)}<small>récup : ${out ? "très facile" : W5(r.off.lo * prof.ftp) + " W"}</small></td></tr>`
    : `<tr><td>${dot(r.on)}${cleanDur(r.on.d)}</td><td>${base(r.on.label)}</td><td class="tg">${tgt(r.on)}</td></tr>`).join("")}</tbody></table>`;
}
function cleanDur(d) { return d < 60 ? `${d} s` : fmtMin(Math.round(d / 60)); }

function renderHead(prof, form, ready, ph) {
  const weeksLeft = Math.max(1, Math.round((GOAL.end - new Date()) / (7 * 864e5)));
  const ftp0 = (prof.ftpHist && prof.ftpHist.length ? prof.ftpHist[0][1] : prof.ftp) || prof.ftp;
  const need = GOAL.ftp - prof.ftp, perW = need / weeksLeft;
  const vo2 = prof.vo2 && prof.vo2.length ? prof.vo2[prof.vo2.length - 1][1] : null, vo2first = prof.vo2 && prof.vo2.length ? prof.vo2[0][1] : null;
  const pct = (v, a, b) => clamp((v - a) / (b - a || 1) * 100, 0, 100);
  const verdict = need <= 0 ? "objectif atteint" : perW <= 1.2 ? "rythme réaliste" : perW <= 2.5 ? "ambitieux mais jouable" : "très ambitieux";
  const r = ready.today, rc = r == null ? "var(--muted)" : r >= 75 ? "#2f9e44" : r >= 55 ? "#1c7ed6" : r >= 40 ? "#f08c00" : "#e03131";
  const tsbTxt = form.tsb > 5 ? "frais" : form.tsb > -10 ? "équilibré" : form.tsb > -25 ? "chargé" : "très chargé";
  return `
  <section class="card span12 goalcard">
    <div class="gc">
      <div class="g"><div class="gl">FTP</div><div class="gv"><input id="pFtp" type="number" min="80" max="600" step="1" value="${prof.ftp}" aria-label="FTP en watts"><span>W</span><span class="arrow">→ ${GOAL.ftp} W</span></div>
        <div class="pbar"><div style="width:${pct(prof.ftp, Math.min(ftp0, prof.ftp) - 20, GOAL.ftp)}%"></div></div>
        <div class="gs">${need > 0 ? `encore <b>+${need} W</b> en ${weeksLeft} semaines, soit +${perW.toFixed(1).replace(".", ",")} W/sem · ${verdict}` : "objectif atteint 🎯".replace(" 🎯", "")} · source : ${prof.ftpSrc}</div></div>
      <div class="g"><div class="gl">VO2max (Garmin)</div><div class="gv"><b>${vo2 != null ? String(vo2).replace(".", ",") : "–"}</b><span class="arrow">→ 65-66</span></div>
        <div class="pbar"><div style="width:${vo2 != null ? pct(vo2, Math.min(vo2first || vo2, vo2) - 3, GOAL.vo2) : 0}%"></div></div>
        <div class="gs">${vo2 != null ? `${vo2first != null && vo2first !== vo2 ? `${vo2 > vo2first ? "+" : ""}${(vo2 - vo2first).toFixed(1).replace(".", ",")} depuis janvier · ` : ""}encore ${Math.max(0, GOAL.vo2 - vo2).toFixed(1).replace(".", ",")} à prendre` : "pas encore de valeur Garmin"}</div></div>
    </div>
  </section>
  <section class="card span12">
    <div class="formrow">
      <div class="fi"><div class="l">Récupération</div><div class="v" style="color:${rc}">${r ?? "–"}<small>/100</small></div><div class="s">${ready.avg3 != null ? `moy. 3 j : ${Math.round(ready.avg3)}` : "onglet Récup"}</div></div>
      <div class="fi"><div class="l">Forme (charge Garmin)</div><div class="v">${form.tsb >= 0 ? "+" : ""}${Math.round(form.tsb)}</div><div class="s">${tsbTxt} · fond ${Math.round(form.ctl)} / fatigue ${Math.round(form.atl)}</div></div>
      <div class="fi"><div class="l">7 derniers jours</div><div class="v">${Math.round(form.km7)}<small> km</small></div><div class="s">${form.n7} séance${form.n7 > 1 ? "s" : ""}${form.c7 ? ` + ${form.c7} trajet${form.c7 > 1 ? "s" : ""}` : ""} · ${form.h7.toFixed(1).replace(".", ",")} h</div></div>
      <div class="fi"><div class="l">Dernière séance dure</div><div class="v sm">${form.lastHard == null ? "–" : form.lastHard === 0 ? "aujourd'hui" : form.lastHard === 1 ? "hier" : `il y a ${form.lastHard} j`}</div><div class="s">intensité ou effet aérobie élevé</div></div>
      <div class="fi wide"><div class="l">Cycle d'entraînement</div><div class="v sm">${ph.final ? "Semaine finale" : `Bloc ${ph.block} · semaine ${ph.wk}/4`}${ph.deload && !ph.final ? " (allégée)" : ""}</div><div class="s">${ph.focus}</div></div>
    </div>
  </section>`;
}

function renderForm(sets, mon) {
  const opt = (v, cur, l) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`;
  const thisMon = mondayOf(new Date());
  return `
  <section class="card span12">
    <h2>Ta semaine <span class="wsel"><button class="chip" data-w="0" aria-pressed="${+mon === +thisMon}">Cette semaine</button><button class="chip" data-w="7" aria-pressed="${+mon === +addDays(thisMon, 7)}">Semaine prochaine</button></span></h2>
    <div class="srows" id="pRows">${sets.map((s, i) => `<div class="srow" data-i="${i}">
      <select data-k="day" aria-label="Jour">${DAYN.map((d, j) => opt(j, s.day, `${d} ${addDays(mon, j).getDate()}`)).join("")}</select>
      <select data-k="dur" aria-label="Durée">${DURS.map(d => opt(d, s.dur, fmtMin(d))).join("")}</select>
      <select data-k="place" aria-label="Lieu">${opt("mw", s.place, "MyWhoosh")}${opt("out", s.place, "Dehors")}</select>
      <select data-k="type" aria-label="Type">${Object.entries(TYPES).map(([k, t]) => opt(k, s.type, k === "auto" ? "Type : auto" : t.l)).join("")}</select>
      <button class="del" data-del="${i}" aria-label="Retirer la séance">✕</button></div>`).join("")}</div>
    <div class="factions"><button class="btn2" id="pAdd" ${sets.length >= 7 ? "disabled" : ""}>+ Ajouter une séance</button><button class="btn2 ghost" id="pReset">Selon mes habitudes</button><button class="btn2 primary" id="pGen">Générer le plan</button></div>
  </section>`;
}

function renderPlan(plan, prof) {
  if (!plan) return "";
  const mw = plan.list.filter(s => s.place === "mw");
  const tot = plan.list.reduce((a, s) => a + s.w.tss, 0), mins = plan.list.reduce((a, s) => a + s.dur, 0);
  return `
  <section class="card span12">
    <h2>Le plan <small>${plan.list.length} séances · ${fmtMin(mins)} · charge ≈ ${tot} TSS${plan.tired ? " · version allégée (fatigue détectée)" : ""}</small></h2>
    ${plan.note ? `<p class="pnote">${plan.note}</p>` : ""}
    <div class="sessions">${plan.list.map((s, i) => { const T = TYPES[s.t];
      return `<article class="sess" style="--tc:${T.c}">
        <div class="sh"><div><div class="sd">${DAYN[s.day]} ${s.date.getDate()} ${s.date.toLocaleDateString("fr-FR", { month: "short" })} · ${s.place === "mw" ? "MyWhoosh" : "Dehors"}</div><div class="st">${s.w.title}</div></div><span class="badge">${T.l}</span></div>
        <div class="sm2">${fmtMin(s.dur)} · ≈ ${s.w.tss} TSS${s.place === "out" ? " · au cardio et aux sensations" : ` · FTP ${prof.ftp} W`}</div>
        ${profileSvg(s.w.steps)}
        <p class="sg">${s.w.goal}</p>
        <details><summary>Détail de la séance</summary>${stepsTable(s, prof)}</details>
        ${s.place === "mw" ? `<button class="btn2 dl" data-dl="${i}">Télécharger pour MyWhoosh (.zwo)</button>` : `<div class="outnote">${s.t === "vo2" || s.t === "vo2s" ? "Sans capteur de puissance, pilote les intervalles courts à la sensation : le cœur met 1 à 2 min à monter." : "Garde un œil sur le cardio : il dérive un peu à la chaleur et en fin de sortie."}</div>`}
      </article>`; }).join("")}</div>
    ${mw.length ? `<div class="factions">${mw.length > 1 ? `<button class="btn2 primary" id="pZip">Tout télécharger pour MyWhoosh (.zip)</button>` : ""}</div>
    <details class="howto"><summary>Importer dans MyWhoosh</summary><ol>
      <li>Va sur <a href="https://workout.mywhoosh.com" target="_blank" rel="noopener">workout.mywhoosh.com</a> et connecte-toi.</li>
      <li>Importe le fichier .zwo (décompresse le .zip d'abord), vérifie l'aperçu, puis « Export to MyWhoosh ».</li>
      <li>La séance apparaît dans le dossier <b>MyWorkout</b> de l'appli (redémarre MyWhoosh s'il était ouvert).</li>
      <li>Les puissances sont en % de FTP : règle ta FTP MyWhoosh sur <b>${prof.ftp} W</b> pour retrouver les watts indiqués ici.</li></ol></details>` : ""}
  </section>`;
}

// ------------------------------------------------------------------ Logique de page
const PS = { mon: null, sets: null, plan: null };
const sortSets = () => PS.sets.sort((a, b) => a.day - b.day || b.dur - a.dur);  // toujours dans l'ordre de la semaine
function generate() {
  const prof = profile(), form = fitness(), ready = readiness(), ph = phase(PS.mon);
  const sorted = [...PS.sets].sort((a, b) => a.day - b.day || b.dur - a.dur);
  const { list, K, tired } = chooseTypes(sorted, ph, form, ready);
  list.forEach(s => { s.date = addDays(PS.mon, s.day); s.w = build(s.t, s.dur, ph, form); });
  let note = "";
  if (tired) note = `Ta récupération est basse (${ready.today ?? "?"}/100) ou ta charge élevée : j'ai retiré une séance intense cette semaine.`;
  else if (ph.deload && !ph.final) note = "Semaine allégée : volume réduit et test FTP pour mesurer les progrès du bloc. Mets à jour ta FTP ici après le test.";
  else if (ph.final) note = "Dernière semaine de l'année : test FTP. Si tu as 300 W ou plus, c'est gagné !";
  else note = `Focus du moment : ${ph.focus.toLowerCase()}. ${K} séance${K > 1 ? "s" : ""} intense${K > 1 ? "s" : ""}, le reste en endurance pour récupérer et construire la base.`;
  PS.plan = { list, tired, note, mon: ymd(PS.mon), at: new Date().toISOString() };
  savePlan();
}
function savePlan() { if (PS.plan) store2.set("planSaved", { mon: PS.plan.mon, note: PS.plan.note, tired: PS.plan.tired, items: PS.plan.list.map(s => ({ day: s.day, dur: s.dur, place: s.place, t: s.t, type: s.type })) }); }
function restorePlan() { // le plan reste figé pour la semaine : on reconstruit les mêmes séances
  const sv = store2.get("planSaved"); if (!sv || sv.mon !== ymd(PS.mon)) return;
  const ph = phase(PS.mon), form = fitness();
  const list = sv.items.map(it => ({ ...it, date: addDays(PS.mon, it.day), w: build(it.t, it.dur, ph, form) }));
  PS.plan = { list, tired: sv.tired, note: sv.note, mon: sv.mon };
}
function render() {
  const box = $("plan"); if (!box) return;
  const prof = profile(), form = fitness(), ready = readiness(), ph = phase(PS.mon);
  // conseil du jour si la séance prévue aujourd'hui est dure et que la récup est basse
  let alert = "";
  if (PS.plan) { const today = PS.plan.list.find(s => ymd(s.date) === ymd(new Date()));
    if (today && TYPES[today.t].hard && ready.today != null && ready.today < 45) { const easy = PS.plan.list.find(s => s.date > today.date && !TYPES[s.t].hard);
      alert = `<section class="card span12 alert">Ta récupération est à <b>${ready.today}/100</b> ce matin alors que tu as « ${today.w.title} » au programme.${easy ? ` <button class="btn2" id="pSwap">L'échanger avec ${DAYN[easy.day].toLowerCase()}</button>` : " Une sortie facile serait plus raisonnable."}</section>`; } }
  box.innerHTML = `<div class="grid">${renderHead(prof, form, ready, ph)}${alert}${renderForm(PS.sets, PS.mon)}${renderPlan(PS.plan, prof)}</div>`;
  // événements
  $("pFtp").onchange = e => { const v = Math.round(+e.target.value); if (v >= 80 && v <= 600) { store2.set("planFtp", v === (Recup.data?.profile?.ftp) ? null : v); if (PS.plan) generate(); render(); } };
  box.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { PS.mon = addDays(mondayOf(new Date()), +b.dataset.w); PS.plan = null; restorePlan(); render(); });
  $("pRows").onchange = e => { const r = e.target.closest(".srow"), k = e.target.dataset.k; if (!r || !k) return; const v = e.target.value; PS.sets[+r.dataset.i][k] = k === "day" || k === "dur" ? +v : v; if (k === "day") sortSets(); store2.set("planSets", PS.sets); if (k === "day") render(); };
  box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { PS.sets.splice(+b.dataset.del, 1); store2.set("planSets", PS.sets); render(); });
  $("pAdd").onclick = () => { const used = PS.sets.map(s => s.day), d = [1, 3, 5, 6, 2, 4, 0].find(x => !used.includes(x)) ?? 0; PS.sets.push({ day: d, dur: 60, place: "mw", type: "auto" }); sortSets(); store2.set("planSets", PS.sets); render(); };
  $("pReset").onclick = () => { PS.sets = defaults(); store2.set("planSets", PS.sets); render(); };
  $("pGen").onclick = () => { if (!PS.sets.length) return; generate(); render(); document.querySelector(".sessions")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  box.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => { const s = PS.plan.list[+b.dataset.dl]; download(fileName(s), zwo(s, prof)); });
  if ($("pZip")) $("pZip").onclick = () => downloadAll(PS.plan.list.filter(s => s.place === "mw"), prof).catch(() => alertBox("Téléchargement groupé impossible : télécharge les séances une par une."));
  if ($("pSwap")) $("pSwap").onclick = () => { const L = PS.plan.list, a = L.find(s => ymd(s.date) === ymd(new Date())), b = L.find(s => s.date > a.date && !TYPES[s.t].hard);
    [a.t, b.t] = [b.t, a.t]; a.w = build(a.t, a.dur, ph, form); b.w = build(b.t, b.dur, ph, form); savePlan(); render(); };
}
function alertBox(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); }

async function open() {
  $("title").textContent = "Mon plan";
  const ok = await Recup.ensure("plan", () => open());
  if (!ok) return;
  if (!PS.mon) PS.mon = weekTarget();
  if (!PS.sets) { PS.sets = store2.get("planSets") || defaults(); sortSets(); }
  if (!PS.plan) restorePlan();
  render();
}
window.Plan = { open, _build: build, _choose: chooseTypes, _zwo: zwo };
document.addEventListener("velo:loaded", () => { if (Recup.curTab() === "plan") open(); });
let rt3, lw3 = innerWidth; addEventListener("resize", () => { if (innerWidth === lw3) return; lw3 = innerWidth; clearTimeout(rt3); rt3 = setTimeout(() => { if (Recup.curTab() === "plan" && PS.sets) render(); }, 200); });
if (Recup.curTab() === "plan") open();
})();
