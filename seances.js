"use strict";
/* Séances clés de course à pied (demande de Nathan du 23/11/2026 : « reprendre des fractionnés, seuils, les meilleures séances
   physiologiquement, et les mettre sur ma montre sans les retaper »).
   - Allures : formules de Jack Daniels (VDOT) à partir de ta forme du moment (10 km prédit par Garmin), pas du seuil Garmin qui sert
     à la charge : en novembre 2026 il donnait 4:12 /km pour un 10 km prédit en 43:35 (4:21 /km), soit des blocs « au seuil »
     plus rapides que l'allure 10 km. Une allure seuil réglée à la main (runThrPace, carte Progression course) reste prioritaire.
   - Séances : seuil en fractionné court (« cruise intervals » de Daniels, principe norvégien : beaucoup de temps au seuil, récup
     courte, jamais dans le rouge), VO2max (30/30 de Billat puis 3-4 min, Helgerud), côtes (sprints de 10 s puis 45 à 90 s),
     lignes droites, allure semi. Échelles de paliers comme le programme FTP du vélo (suivi « Réussi / À refaire » dans palLog).
   - Volume de qualité borné par tes km de la semaine (règle de Daniels : seuil ≤ 10 %, VO2max ≤ 8 %), avec un plancher.
   - Montre : description neutre de chaque séance (spec), encodée en .fit (copie par câble) ou envoyée par le workflow dans le
     calendrier Garmin Connect (scripts/montre.py), via la collection `montre` de sync.js. La même empreinte (sig) des deux côtés
     dit au site si la séance est arrivée sur Garmin (data/montre.json).
   API : window.Seances ; fonctions pures dans Seances._ (node tests/seances.mjs). */
(() => {
const DAY = 864e5;
const pad = n => String(n).padStart(2, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtPace = s => { const r = Math.round(s); return `${Math.floor(r / 60)}:${pad(r % 60)}`; };
const fmtD = s => s < 60 ? `${s}"` : s % 60 ? `${Math.floor(s / 60)}'${pad(s % 60)}` : `${s / 60}'`;
const fmtT = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.round(s % 60); return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const nf = (n, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ Allures (Daniels & Gilbert, « Oxygen Power », 1979)
// coût en oxygène d'une vitesse v (m/min) et part de la VO2max tenable pendant t minutes ; VDOT = coût / part
const vo2 = v => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
const vdot = (m, s) => m > 0 && s > 0 ? vo2(m / (s / 60)) / pctMax(s / 60) : null;
const velOf = o => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (o + 4.6))) / (2 * 0.000104);   // m/min pour un coût donné
const paceAt = (V, f) => 60000 / velOf(f * V);                                                            // s/km à f × VDOT
// temps de course prédit sur m mètres (vdot décroît avec le temps : dichotomie)
function raceTime(V, m) { let lo = m / 600 * 60, hi = m / 80 * 60; for (let i = 0; i < 60; i++) { const t = (lo + hi) / 2; if (vdot(m, t) > V) lo = t; else hi = t; } return (lo + hi) / 2; }
// parts de la VDOT (tables de Daniels) : seuil 88 %, intervalles « I » 97,5 %, vitesse à VO2max 100 %, footing 63 à 72 %
const PCT = { E: [.72, .63], T: .88, I: .975, VV: 1 };
const TOL = { T: 6, I: 6, VV: 8, HM: 8 };   // fourchette d'allure envoyée à la montre (± s/km) : le GPS bouge de 5 à 10 s/km, ±4 faisait biper sans arrêt
const OK_RACE = { "10k": [1500, 4800], "5k": [720, 2400] };
const PACE_OK = [180, 480];

// d'où viennent les allures : réglage à la main (allure seuil), sinon 10 km prédit par Garmin, sinon 5 km, sinon seuil Garmin, sinon repli
function source(o = {}) {
  const own = +o.own, races = o.races || {}, lt = o.lt || {};
  if (own >= PACE_OK[0] && own <= PACE_OK[1]) return { V: vo2(60000 / own) / PCT.T, how: "own", txt: `ton allure seuil réglée à la main (${fmtPace(own)} /km)` };
  for (const [k, m, l] of [["10k", 10000, "10 km"], ["5k", 5000, "5 km"]]) { const t = +races[k];
    if (t >= OK_RACE[k][0] && t <= OK_RACE[k][1]) return { V: vdot(m, t), how: k, txt: `ton ${l} prédit par Garmin (${fmtT(t)})` }; }
  const p = +lt.pace, fb = +o.fallback;
  if (p >= PACE_OK[0] && p <= PACE_OK[1]) return { V: vo2(60000 / p) / PCT.T, how: "lt", txt: `ton seuil Garmin (${fmtPace(p)} /km)` };
  const q = fb >= PACE_OK[0] && fb <= PACE_OK[1] ? fb : 300;
  return { V: vo2(60000 / q) / PCT.T, how: "fallback", txt: `une allure seuil de ${fmtPace(q)} /km (pas de prédiction Garmin)` };
}
function paces(src) {
  const V = src.V, r = Math.round;
  return { V, src, E: [r(paceAt(V, PCT.E[0])), r(paceAt(V, PCT.E[1]))], T: r(paceAt(V, PCT.T)), I: r(paceAt(V, PCT.I)), VV: r(paceAt(V, PCT.VV)),
    HM: r(raceTime(V, 21097.5) / 21.0975), M: r(raceTime(V, 42195) / 42.195), k10: r(raceTime(V, 10000)) };
}
// allure « sous le seuil » des répétitions de seuil (demande de Nathan du 25/11/2026, façon norvégienne : 2 à 3,5 mmol de lactate, un cran
// sous le seuil pour en faire plus) : l'allure semi, entre 4 et 12 s/km plus lente que le seuil
const subT = P => Math.min(P.T + 12, Math.max(P.T + 4, P.HM));
const range = (p, tol) => [p - tol, p + tol];

// ------------------------------------------------------------------ Échelles de paliers
// { n: répétitions, on / off : effort / récup (s), sets / rs : séries et récup entre séries (s) }
// Seuil : on allonge le temps au seuil (12 → 30 min) avant d'allonger les blocs ; récup ≈ 1 min pour 4 à 5 min d'effort (Daniels).
// VO2max : 30/30 de Billat (temps près de la VO2max sans trop de casse) puis blocs de 2 à 4 min (Helgerud 2007 : 4 × 4).
// Côtes : sprints de 10 s (force, foulée, presque sans fatigue) puis 45 à 90 s à l'effort 5 km (puissance aérobie, moins d'impact qu'à plat).
const LADDERS = {
  // seuil court façon norvégienne (demande de Nathan du 25/11/2026) : répétitions de 4 min, 1 min de trot, on ajoute des répétitions
  // (+4 min de seuil par palier) ; la règle des 10 % de Daniels (CAP) coupe le nombre de répétitions tant que le volume de la semaine ne suit pas
  rthr: [3, 4, 5, 6, 7, 8, 9].map(n => ({ n, on: 240, off: 60 })),
  rvo2: [{ n: 12, on: 30, off: 30 }, { n: 16, on: 30, off: 30 }, { n: 10, on: 30, off: 30, sets: 2, rs: 180 },
    { n: 5, on: 120, off: 120 }, { n: 5, on: 180, off: 150 }, { n: 4, on: 240, off: 180 }, { n: 5, on: 240, off: 180 }],
  rhill: [{ n: 6, on: 10, off: 120 }, { n: 8, on: 10, off: 120 }, { n: 8, on: 45, off: 90 }, { n: 10, on: 45, off: 90 },
    { n: 8, on: 60, off: 120 }, { n: 10, on: 60, off: 120 }, { n: 6, on: 90, off: 150 }],
};
const NAME = { rthr: "Seuil", rvo2: "VO2max", rhill: "Côtes", rstrides: "Lignes droites", rtempo: "Allure semi" };
const NMIN = { rthr: 3, rvo2: 3, rhill: 4 };                 // en dessous, la séance n'a plus de sens : on garde ce minimum
const CAP = { rthr: [.15, 2.7], rvo2: [.08, 1.5] };          // km de qualité ≤ part des km de la semaine, jamais sous le plancher (km) : VO2max 8 % (Daniels),
// sous le seuil 15 % (Daniels met 10 % à l'allure seuil ; un cran plus lent, les Norvégiens en font bien plus, sur 2 à 3 séances)
const KEY = new Set(["rstrides", "rtempo", "rthr", "rvo2", "rhill"]);   // séances structurées : celles qui vont sur la montre
const is3030 = s => s.on <= 30 && s.off === s.on;
function stepL(t, k) {
  const s = LADDERS[t][k], set = s.sets ? `${s.sets} × ` : "";
  if (t === "rhill") return `#${k + 1} · ${s.n} × ${fmtD(s.on)} en côte`;
  if (t === "rvo2" && is3030(s)) return `#${k + 1} · ${set}${s.n} × 30/30`;
  return `#${k + 1} · ${s.n} × ${fmtD(s.on)}${t === "rthr" ? " sous le seuil" : ""}`;
}

// durée naturelle d'un palier (15 min d'échauffement, 10 de retour au calme), arrondie à 5 min : fichier .fit d'un palier hors du Plan
function fullMin(t, k) { const s = LADDERS[t][k], set = s.sets || 1; return Math.ceil((900 + 600 + set * (s.n * s.on + (s.n - 1) * s.off) + (set - 1) * (s.rs || 0)) / 300) * 5; }

// ------------------------------------------------------------------ Contenu d'une séance
// o : { P (allures), k (palier), wkKm (km courus par semaine, 4 dernières semaines), hr (seuil cardio course) }
// Renvoie { title, goal, steps (lignes du tableau du Plan), km, k, cut, spec (pour la montre) }.
// Lignes : { d (s), label, sub, v (part de la vitesse au seuil, pour la couleur), pace (s/km ou null), plo, phi (fourchette, s/km), rpe, km, n?, on? }
const RPE = { easy: "3-4/10, tu peux parler", thr: "7/10, dur mais contrôlé", vo2: "8-9/10, dur", hill: "effort 5 km", sprint: "vite mais relâché", strides: "7/10, relâché", hm: "6/10, soutenu" };
function build(type, durMin, o = {}) {
  const P = o.P || paces(source({})), T = Math.round(durMin * 60), E = P.E, eMid = (E[0] + E[1]) / 2, S = [], spec = [];
  const km = (d, pace) => pace ? d / pace : d / eMid;
  const row = (d, label, sub, pace, rpe, lohi, x = {}) => S.push({ d, label, sub, v: P.T / (pace || eMid), pace, ...(lohi ? { plo: lohi[0], phi: lohi[1] } : {}), rpe, km: km(d, pace), ...x });
  const L = LADDERS[type], k = L ? clamp(Number.isInteger(o.k) ? o.k : 0, 0, L.length - 1) : null;
  let lastOff = 0, s = L ? { ...L[k] } : null, cut = null, warm = durMin >= 45 ? 900 : 720, cool = durMin >= 45 ? 600 : 480;
  const sets = () => (s.sets || 1), work = () => sets() * (s.n * s.on + (s.n - 1) * s.off) + (sets() - 1) * (s.rs || 0);
  const pFor = { rthr: s && subT(P), rvo2: s && (is3030(s) ? P.VV : P.I) }[type];
  if (s) {
    const n0 = s.n, full = Math.ceil((900 + 600 + work()) / 300) * 5;
    // volume de qualité : règle de Daniels (km de la semaine), avec un plancher pour que le palier 1 passe toujours
    if (CAP[type] && o.wkKm != null) { const capKm = Math.max(CAP[type][0] * o.wkKm, CAP[type][1]), nCap = Math.floor(capKm * pFor / (sets() * s.on));
      if (Math.max(NMIN[type], nCap) < s.n) { s.n = Math.max(NMIN[type], nCap); cut = `volume ${type === "rthr" ? "sous le seuil" : "rapide"} limité à ${Math.round(CAP[type][0] * 100)} % de tes km de la semaine (${nf(o.wkKm, 0)} km en moyenne sur 4 semaines${type === "rthr" ? "" : ", règle de Daniels"})`; } }
    // séance trop courte : moins de répétitions, puis échauffement et retour au calme plus courts
    while (warm + cool + work() > T && s.n > NMIN[type]) { s.n--; if (!cut) cut = `séance trop courte pour le palier complet (il demande ${full} min)`; }
    if (warm + cool + work() > T) { warm = 600; cool = 300; }
    if (cut) cut += ` : ${s.n} répétitions au lieu de ${n0}${sets() > 1 ? " par série" : ""}`;
    if (warm + cool + work() > T) cut = `séance trop courte : même réduite à ${s.n} répétitions, elle dure ${Math.ceil((warm + cool + work()) / 60)} min`;
  }
  // le temps qui reste va d'abord à l'échauffement (20 min au plus), puis au retour au calme
  const fill = w => { const left = Math.max(0, T - warm - cool - w); const a = Math.min(left, Math.max(0, 1200 - warm)); warm += a; cool += left - a; };
  const wu = (sub, lap) => { row(warm, lap ? "Échauffement, jusqu'à la côte" : "Échauffement", sub, null, RPE.easy, E); spec.push({ t: "warmup", s: lap ? 0 : warm, p: null, n: lap ? "Vers la côte" : "Échauffement" }); };
  // sur la montre, la dernière récup d'un bloc répété est comptée dans le retour au calme (ou la récup entre séries) : même durée totale
  const cd = () => { row(cool, "Retour au calme", "footing très facile", null, RPE.easy, E); spec.push({ t: "cooldown", s: Math.max(60, cool - lastOff), p: null, n: "Retour au calme" }); };
  const reps = (n, on, off, pace, tol, label, sub, rpe, note, offNote) => {
    const lohi = pace ? range(pace, tol) : null;
    S.push({ d: n * on + (n - 1) * off, n, on, label, sub, v: pace ? P.T / pace : 1.05, pace, ...(lohi ? { plo: lohi[0], phi: lohi[1] } : {}), rpe, km: (pace ? n * on / pace : n * on / P.I) + (n - 1) * off / E[1] });
    spec.push({ rep: n, steps: [{ t: "interval", s: on, p: lohi, n: note }, { t: "recovery", s: off, p: null, n: offNote }] }); lastOff = off;
  };
  let title = NAME[type] || type, goal = "";
  const hrTxt = o.hr ? `, le cardio finit vers ${o.hr - 8}-${o.hr} bpm en fin de bloc, pas au-dessus` : "";
  if (type === "rthr") {
    fill(work()); wu("footing facile, finis par 3 accélérations de 15 s");
    reps(s.n, s.on, s.off, subT(P), TOL.T, `${s.n} × ${fmtD(s.on)} sous le seuil`, `récup ${fmtD(s.off)} en trottinant`, RPE.thr, `Sous-seuil ${fmtPace(subT(P))}`, "Trot");
    cd();
    title = `Seuil #${k + 1} · ${s.n} × ${fmtD(s.on)}`;
    goal = `Seuil à la norvégienne : des répétitions de 4 min à ${fmtPace(subT(P))} /km, un cran sous ton seuil (${fmtPace(P.T)} /km), avec 1 min de trot. Courir un peu moins vite permet d'en faire plus sans passer dans le rouge : jusqu'à 15 % de tes km de la semaine. On progresse en ajoutant des répétitions, jamais en les allongeant ni en accélérant. Régulier du premier au dernier bloc${hrTxt} ; tu dois finir en te disant que tu en avais encore un.`;
  } else if (type === "rvo2") {
    fill(work()); wu("footing facile, finis par 3 accélérations de 15 s");
    const p = pFor, short = is3030(s), lab = short ? `${s.n} × 30/30` : `${s.n} × ${fmtD(s.on)} vite`, sub = short ? "30 s vite, 30 s en trottinant" : `récup ${fmtD(s.off)} en trottinant`;
    for (let i = 0; i < sets(); i++) {
      reps(s.n, s.on, s.off, p, short ? TOL.VV : TOL.I, sets() > 1 ? `Série ${i + 1} : ${lab}` : lab, sub, RPE.vo2, `${short ? "30 s" : "Vite"} ${fmtPace(p)}`, "Trot");
      if (i < sets() - 1) { row(s.rs, "Récup entre les séries", "trot ou marche", null, RPE.easy, null); spec.push({ t: "recovery", s: Math.max(30, s.rs - lastOff), p: null, n: "Récup séries" }); }
    }
    cd();
    title = `VO2max #${k + 1} · ${sets() > 1 ? `${sets()} × ` : ""}${short ? `${s.n} × 30/30` : `${s.n} × ${fmtD(s.on)}`}`;
    goal = short ? `30/30 de Billat à ta vitesse VO2max (${fmtPace(P.VV)} /km) : 30 s vite, 30 s en trottinant. Le cœur reste haut pendant les trots, donc beaucoup de temps près de la VO2max pour peu de fatigue et de chocs : la meilleure porte d'entrée. Même allure du premier au dernier, sans sprinter.`
      : `Intervalles longs à l'allure « I » de Daniels (${fmtPace(P.I)} /km, ton allure 3 à 5 km) : chaque bloc doit amener le cœur vers son maximum dans les dernières minutes (Helgerud : 4 × 4 min font progresser la VO2max plus qu'un volume égal d'endurance ou de seuil). Récup en trottinant, assez pour tenir l'allure jusqu'au dernier.`;
  } else if (type === "rhill") {
    const sprint = s.on <= 15;
    fill(work()); wu(sprint ? "footing facile jusqu'à une côte raide (6 à 10 %)" : "footing facile jusqu'à une côte régulière (4 à 6 %, 200 m au moins)", true);
    reps(s.n, s.on, s.off, null, 0, `${s.n} × ${fmtD(s.on)} en côte`, sprint ? `récup ${fmtD(s.off)} en redescendant au pas` : `récup ${fmtD(s.off)} : redescente en trottinant très doucement`, sprint ? RPE.sprint : RPE.hill,
      sprint ? "Sprint côte" : "Côte effort 5k", sprint ? "Descente au pas" : "Descente trot");
    cd();
    title = `Côtes #${k + 1} · ${s.n} × ${fmtD(s.on)}`;
    goal = sprint ? "Sprints en côte de 10 s : force des mollets et des fessiers, foulée plus économique, presque sans fatigue. La pente limite la vitesse et le choc au sol : c'est la façon la plus douce de remettre de l'intensité après une périostite. Récup complète en redescendant au pas."
      : "Côtes de 45 à 90 s à l'effort d'un 5 km (pas à l'allure : en côte, la montre ne veut rien dire) : puissance aérobie et force spécifique, avec moins d'impact qu'à plat. Monte en poussant, buste droit, cadence vive. La descente charge le tibia : redescends en trottinant très doucement, ou en marchant.";
  } else if (type === "rstrides") {
    const n = 6, on = 20, off = 60, w = n * on + (n - 1) * off;
    cool = 300; warm = Math.max(300, T - w - cool); wu("footing facile"); S[S.length - 1].label = "Footing"; spec[spec.length - 1].n = "Footing";
    reps(n, on, off, null, 0, `${n} lignes droites de ${on} s`, `récup ${fmtD(off)} en marchant ou trottinant`, RPE.strides, "Ligne droite", "Récup");
    cd();
    title = `Footing + ${n} lignes droites`;
    goal = "Un footing facile terminé par 6 lignes droites de 20 s à l'allure d'un 1 500 m, sur du plat, en accélérant progressivement : on réveille la foulée et l'économie de course sans fatigue ni acide. Récup complète entre chaque, ce n'est pas un fractionné.";
  } else if (type === "rtempo") {
    const nFit = () => clamp(Math.floor((T - warm - cool + 120) / 720), 1, 3), wk = n => n * 600 + (n - 1) * 120;
    let n = nFit(); if (warm + cool + wk(n) > T) { warm = 600; cool = 300; n = nFit(); }
    const w = wk(n);
    fill(w); wu("footing facile");
    reps(n, 600, 120, P.HM, TOL.HM, `${n} × 10 min allure semi`, "récup 2 min en trottinant", RPE.hm, `Semi ${fmtPace(P.HM)}`, "Trot");
    cd();
    title = `Allure semi · ${n} × 10'`;
    goal = `Des blocs de 10 min à ton allure semi (${fmtPace(P.HM)} /km), un cran sous le seuil : ça élargit le moteur aérobie pour une fatigue modérée.`;
  } else return null;
  const name = title.replace(/ × /g, "×").slice(0, 31);
  return { title, goal, steps: S, km: S.reduce((a, x) => a + x.km, 0), k, cut, spec: { v: 1, name, steps: spec } };
}

// ------------------------------------------------------------------ Montre : empreinte et fichier .fit
// FNV-1a 32 bits du JSON de la séance (même calcul dans scripts/montre.py, sur json.dumps(separators=(",", ":"), ensure_ascii=False))
function sig(spec) { const b = new TextEncoder().encode(JSON.stringify(spec)); let h = 0x811c9dc5; for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const total = steps => steps.reduce((a, x) => a + (x.rep ? x.rep * total(x.steps) : x.s), 0);
// FIT « workout » (profil FIT : file_id type 5, workout, workout_step) ; aucun numéro de série ni identifiant d'appareil
const DUR = { time: 0, open: 5, repeat: 6 }, TGT = { speed: 0, open: 2 }, INT = { warmup: 2, cooldown: 3, interval: 0, recovery: 4 };
function fit(spec, created = Date.now()) {
  const F = window.FitCourse; if (!F || !F.writer) throw new Error("encodeur FIT absent");
  const w = F.writer(), flat = [];
  const put = st => { if (st.rep) { const from = flat.length; st.steps.forEach(put); flat.push({ repeat: from, times: st.rep }); } else flat.push(st); };
  spec.steps.forEach(put);
  w.msg(0, 0, [[0, "enum", 5], [1, "uint16", 255], [2, "uint16", 0], [4, "uint32", Math.round(created / 1000) - 631065600]]);   // file_id : séance
  w.msg(1, 26, [[4, "enum", 1], [6, "uint16", flat.length], [8, "string", spec.name, 32]]);                                     // workout : course à pied
  flat.forEach((x, i) => {
    if (x.repeat != null) { w.msg(3, 27, [[254, "uint16", i], [1, "enum", DUR.repeat], [2, "uint32", x.repeat], [4, "uint32", x.times]]); return; }
    const mps = p => Math.round(1e6 / p);   // s/km → mm/s
    w.msg(2, 27, [[254, "uint16", i], [0, "string", (x.n || "").slice(0, 15), 16], [1, "enum", x.s ? DUR.time : DUR.open], [2, "uint32", x.s ? x.s * 1000 : 0],
      [3, "enum", x.p ? TGT.speed : TGT.open], [4, "uint32", 0], [5, "uint32", x.p ? mps(x.p[1]) : 0], [6, "uint32", x.p ? mps(x.p[0]) : 0], [7, "enum", INT[x.t] ?? 0]]);
  });
  return w.done();
}
const fileName = (spec, date) => `${date ? date + "_" : ""}${spec.name.replace(/×/g, "x").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9#]+/g, "-").replace(/#/g, "").replace(/^-|-$/g, "")}.fit`;
function download(spec, date) {
  const blob = new Blob([fit(spec)], { type: "application/octet-stream" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fileName(spec, date); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------------ Envoi vers Garmin Connect (collection `montre` de sync.js)
// Une séance clé par semaine, sans jour fixe (demande du 24/11/2026) : le site dépose { id: "key:<lundi>", v: { mon, days, done, v, name, steps, sig } }
// (days = jours conseillés restants, done = faite, null = pas de séance clé cette semaine). Le workflow (scripts/montre.py) la crée dans Garmin Connect
// et la met au calendrier le premier jour conseillé à partir d'aujourd'hui : elle devient la « séance du jour » de la montre, et passe au jour
// conseillé suivant tant qu'elle n'est pas faite. Faite (suivie sur la montre, ou validée sur le site) : elle ne bouge plus.
const COL = "montre", K_SRV = "montreSrv2";
const ls = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
let want = null, registered = false, state = null, stateP = null;
const srv = () => ls.get(K_SRV, null);   // { lundi: empreinte | null } d'après la Sheet ; null = jamais synchronisé sur cet appareil
const fp = v => v ? JSON.stringify([v.sig, v.days, !!v.done]) : null;
const ymdOf = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// semaine encore utile : son dimanche n'est pas passé et son lundi est dans les 8 jours
// en dates du calendrier (AAAA-MM-JJ) : un calcul en millisecondes perdait une heure le dimanche du passage à l'heure d'hiver
const addD = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymdOf(new Date(y, m - 1, d + n, 12)); };
function inWin(mon, today) { return addD(mon, 6) >= today && mon < addD(today, 8); }
// éléments à envoyer : ce qui diffère de la Sheet pour les semaines utiles (le passé ne bouge jamais)
function diff(wanted, server, today, now = Date.now()) {
  if (!wanted || !server) return [];
  const out = [];
  for (const m of new Set([...Object.keys(wanted), ...Object.keys(server)])) { if (!inWin(m, today)) continue;
    const w = wanted[m] || null; if (fp(w) !== (server[m] || null)) out.push({ id: "key:" + m, ts: now, v: w }); }
  return out;
}
function flush() { if (!window.Sync || !Sync.configured() || !want) return; const items = diff(want.items, srv(), want.today); if (items.length) Sync.push(COL, items); }
function register() {
  if (registered || !window.Sync) return; registered = true;
  Sync.register(COL, { local: () => [], apply(items) { const m = {}; items.forEach(it => { const d = /^key:(\d{4}-\d\d-\d\d)$/.exec(it.id); if (d) m[d[1]] = fp(it.v); }); ls.set(K_SRV, m); flush(); } });
}
// le Plan donne ses séances clés : [{ mon, spec, days, done }] (semaine en cours et suivante) ; une semaine absente = pas de séance clé
function offer(today, weeks) {
  const items = {};
  weeks.forEach(x => { if (x && x.spec) items[x.mon] = { mon: x.mon, days: x.days || [], done: !!x.done, ...x.spec, sig: sig(x.spec) }; });
  want = { today, items }; register(); flush();
}
// état côté Garmin écrit par le workflow (data/montre.json), lu une fois par page
function loadState(onDone) {
  if (!stateP) stateP = fetch(`data/montre.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => { state = j || { none: true }; if (onDone) onDone(); return state; });
  return stateP;
}
const dLong = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
// où en est la séance de la semaine côté Garmin : { k: "ok" | "done" | "wait" | "nocfg" | "nolink" | "err" | "load", txt, date? }
function status(mon, spec) {
  const S = state, got = S && S.w && S.w[mon];
  if (got && got.done) return { k: "done", txt: got.site ? "Validée sur le site : retirée de ta montre." : `Faite en suivant la séance de la montre${got.date ? ` (${dLong(got.date)})` : ""}.`, date: got.date };
  if (got && got.s === sig(spec) && got.date) return { k: "ok", txt: `Sur ta montre comme séance du jour, ${dLong(got.date)} : si tu ne la fais pas ce jour-là, elle passe au jour conseillé suivant.`, date: got.date };
  if (!window.Sync || !Sync.configured()) return { k: "nocfg", txt: "Envoi automatique arrêté : la synchro n'est pas configurée sur cet appareil (réglages de la carte Chaîne)." };
  if (!S) return { k: "load", txt: "…" };
  if (S.none || S.cfg === false) return { k: "nolink", txt: "Le workflow n'a pas encore le secret SYNC_LINK : vois « Sur ta montre » plus bas." };
  if (S.err) return { k: "err", txt: `Dernier envoi à Garmin en échec (${S.err}) : nouvel essai au prochain passage.` };
  return { k: "wait", txt: "Elle part sur ta montre au prochain passage du workflow (toutes les heures, vers la 17e minute)." };
}

// ------------------------------------------------------------------ Carte « Tes séances clés course » (onglet Plan)
// o : { P, key (séance de la semaine, voir weekKey de plan.js) | null, next (celle de la semaine suivante) | null, reprise: { k, light, nextKey } | null,
//       pal / palDone (paliers en cours et réussis), lt }
const list = a => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} et ${a[a.length - 1]}`;
const dayName = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long" });
function answer(o) {
  const K = o.key;
  if (!K && o.skip && o.skip.cur) return "Pas de séance clé cette semaine : tu l'as passée. Elle est retirée de ta montre ; tes footings restent.";
  if (K && K.done) return `Séance clé de la semaine faite ✓ : ${K.w.title}${K.done.ok === true ? ", réussie" : K.done.ok === false ? ", à refaire" : ""}.`;
  const g = K && !K.done && state && state.w && state.w[K.mon];
  if (g && g.done && !g.site) return `Séance clé de la semaine faite ✓ en suivant ta montre${g.date ? ` (${dLong(g.date)})` : ""} : ${K.w.title}. Dis si elle est réussie, pour passer au palier suivant.`;
  if (K) { const main = K.w.steps.find(x => x.n && x.pace), pace = main ? ` à ${fmtPace(main.pace)} /km` : "";
    if (!K.days.length) return `Séance clé de la semaine : ${K.w.title}${pace}. Plus de jour idéal d'ici dimanche (vélo dur, sortie longue ou jambes à côté) : fais-la seulement si tu te sens frais, sinon laisse-la.`;
    return `Séance clé de la semaine : ${K.w.title}${pace}, le jour qui t'arrange : ${K.days.length >= 5 ? "n'importe quel jour" : list(K.days.map(dayName))}${K.loose ? " (sans jour idéal, choisis le moins chargé)" : ""}.`; }
  const R = o.reprise;
  if (R && R.nextKey) return `Pas de séance clé cette semaine (palier ${R.k + 1} de ta reprise${R.light ? ", semaine allégée" : ""}) : que des footings. La prochaine arrive au palier ${R.nextKey.k + 1} : ${NAME[R.nextKey.t].toLowerCase()}.`;
  return "Pas de séance clé cette semaine (semaine allégée) : que des footings.";
}
function cardHtml(o) {
  const P = o.P, K = o.key;
  const bar = t => { const N = LADDERS[t].length, cur = o.pal[t], done = o.palDone[t] || new Set();
    return `<li><b>${NAME[t]}</b><span class="pgseg" role="img" aria-label="palier ${cur + 1} sur ${N}">${LADDERS[t].map((_, k) => `<i class="${done.has(k) ? "ok" : k === cur ? "cur" : ""}"></i>`).join("")}</span>
      <span class="pgnext">${cur + 1}/${N} · ${stepL(t, cur).slice(stepL(t, cur).indexOf("·") + 2)}</span><button class="lnk" data-kfit="${t}:${cur}" title="Fichier .fit du palier en cours, pour le copier sur la montre par câble">.fit</button></li>`; };
  let body = "";
  if (K) {
    const st = K.done ? null : status(K.mon, K.w.spec);
    // validation : la course de la semaine qui a servi de séance clé (la plus récente, ou celle suivie sur la montre)
    const R = K.run, ask = !K.done && R ? `<p class="sg">Tu l'as faite${R.label ? ` (${esc(R.label)})` : ""} ? <button class="btn2 primary" data-kdone="${K.mon}:${R.d}:1">Réussie</button> <button class="btn2" data-kdone="${K.mon}:${R.d}:0">À refaire</button></p>` : "";
    const undo = K.done ? `<p class="note">${K.done.ok === true ? "Réussie" : K.done.ok === false ? "À refaire" : "Faite"} le ${dLong(K.done.d)}. <button class="lnk" data-kdone="${K.mon}:${K.done.d}:x">Annuler</button></p>` : "";
    body = `<div class="keyw">${runTableHtml(K.w)}</div>
      ${K.w.cut ? `<p class="note">${esc(K.w.cut.charAt(0).toUpperCase() + K.w.cut.slice(1))}.</p>` : ""}
      ${K.avoid ? `<p class="note">${esc(K.avoid)}</p>` : ""}
      ${ask}${undo}${K.done ? "" : `<p class="note">Pas le moment cette semaine ? <button class="lnk" data-kskip="${K.mon}:1">Passer cette séance</button> (elle sera retirée de ta montre).</p>`}
      ${st ? `<div class="kwline"><span class="kst ${st.k}">${st.k === "ok" ? "✓ " : ""}${esc(st.txt)}</span><button class="btn2" data-kfitw="${K.mon}">Fichier pour la montre (.fit)</button></div>` : ""}`;
  }
  const sk = o.skip || {}, N = o.next, nextTxt = (sk.cur ? `<p class="note">Séance clé de cette semaine passée. <button class="lnk" data-kskip="${sk.cur}:0">La remettre</button></p>` : "")
    + (N ? `<p class="note">Semaine prochaine : ${esc(N.w.title)}${N.days.length && N.days.length < 5 ? `, de préférence ${list(N.days.map(dayName))}` : ""}. <button class="lnk" data-kskip="${N.mon}:1">La passer</button></p>`
      : sk.next ? `<p class="note">Séance clé de la semaine prochaine passée. <button class="lnk" data-kskip="${sk.next}:0">La remettre</button></p>` : "");
  const gLt = o.lt && o.lt.pace ? o.lt.pace : null;
  const allures = `Footing ${fmtPace(P.E[0])}-${fmtPace(P.E[1])} · allure semi ${fmtPace(P.HM)} · <b>sous le seuil ${fmtPace(subT(P))}</b> · seuil ${fmtPace(P.T)} · VO2max ${fmtPace(P.I)} · 30/30 ${fmtPace(P.VV)} (/km)`;
  const ltNote = gLt && P.src.how !== "own" && P.src.how !== "lt" && Math.abs(gLt - P.T) >= 6 ? ` Le seuil Garmin (${fmtPace(gLt)} /km) reste celui de la charge ; il est ${gLt < P.T ? "plus rapide" : "plus lent"} de ${Math.abs(gLt - P.T)} s que ta forme du moment${gLt < P.T ? " : tes blocs au seuil seraient à l'allure d'un 10 km" : ""}.` : "";
  const repTxt = o.reprise ? "Pendant ta reprise, une séance clé par semaine au plus, jamais en semaine allégée : lignes droites au palier 5, côtes au 6, seuil au 7, puis seuil et côtes en alternance, VO2max à partir du palier 14. Tibia au-dessus de 2/10 pendant ou le lendemain : la séance suivante redevient un footing." : "";
  return `<section class="card span12 pgram keyrun" id="pKey"><h2>Tes séances clés course <small>une par semaine, sans jour fixe</small></h2>
    <p class="tdmsg">${answer(o)}</p>
    ${body}${nextTxt}
    <p class="note">Tes allures : ${allures}. Calculées avec les formules de Daniels (VDOT ${nf(P.V, 1)}) d'après ${esc(P.src.txt)}, elles suivent ta forme.${ltNote}</p>
    <ul class="pgbars">${["rthr", "rhill", "rvo2"].map(bar).join("")}</ul>
    ${repTxt ? `<p class="note">${repTxt}</p>` : ""}
    <details class="pgall"><summary>Sur ta montre</summary><div class="kwatch">
      <p><b>Automatique</b> : la séance clé de la semaine part dans ton calendrier Garmin Connect et devient la « séance du jour » de ta montre le premier jour conseillé ; si tu ne la fais pas ce jour-là, elle passe au jour conseillé suivant. Au départ d'une course, la montre te la propose : tu la suis, ou tu fais ton footing. Une fois faite, elle ne bouge plus.</p>
      <ol><li>La synchro doit être active sur l'appareil où tu ouvres le site (carte Chaîne › réglages › Synchronisation).</li>
      <li>Une seule fois : dans les mêmes réglages, « Copier le lien de configuration », puis sur GitHub : dépôt › Settings › Secrets and variables › Actions › New repository secret, nom <code>SYNC_LINK</code>, valeur = ce lien.</li>
      <li>Ouvre le site au moins une fois par semaine : c'est lui qui calcule la séance et ses jours conseillés.</li></ol>
      <p><b>Par câble</b> (sans attendre) : bouton .fit, montre branchée à l'ordinateur, copie le fichier dans le dossier <code>GARMIN/NewFiles</code> ; elle apparaît dans Entraînement › Entraînements. Sur Mac, une montre récente demande l'appli OpenMTP pour voir ses dossiers.</p>
    </div></details></section>`;
}
// tableau des étapes d'une séance (même rendu que le détail d'une course du Plan, fourni par plan.js)
let runTableHtml = () => "";

window.Seances = { LADDERS, NAME, KEY, stepL, fullMin, build, source, paces, fit, fileName, download, sig, offer, status, loadState, cardHtml,
  setTable: f => { runTableHtml = f; },
  _: { vdot, raceTime, paceAt, velOf, PCT, TOL, CAP, NMIN, total, diff, inWin, fp, answer, fmtPace, is3030, srv: () => srv() } };
if (window.Sync) register(); else addEventListener("DOMContentLoaded", register);
})();
