"use strict";
// L'entraîneur IA (Gemini par l'Apps Script de synchro, Sync.ai). Refonte du 13/11/2026 (demande de Nathan : commentaires incohérents,
// un footing du jour appelé « d'hier soir », la séance du lendemain recopiée du Plan) : Gemini COMPLÈTE l'analyse de l'outil.
// Le texte envoyé est rangé en blocs : le sujet ; ce que la page affiche déjà (à ne pas redire) ; ce que la page n'affiche pas
// (déroulé par tranches, séances comparables, ce qui entoure la séance) ; les données générales. Chaque date porte son repère
// (aujourd'hui, hier, il y a 3 j) et chaque mesure son verdict (sous la zone, chargé) : le modèle ne calcule ni jour ni seuil.
// - IA.chat() : conversation (bouton « Entraîneur » de la barre du haut, et la question de la Synthèse) ;
// - IA.mount() : encart à la demande dans une carte existante (récup, semaine, objectifs, sortie) ;
// - IA.full() : texte envoyé (aussi utilisé par le bilan de séance).
// Jamais d'appel automatique ; le script plafonne à 60 demandes par jour. Ni nom de sortie, ni lieu, ni point de départ envoyés.
(() => {
const K = "aiBox:", KEEP = 60, K_CHAT = "aiChat", MAX_CTX = 15000, MAX_TURNS = 20, AI_V = 2;
const esc_ = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function lsPut(k, v) {
  lsSet(k, v);
  try { const ks = Object.keys(localStorage).filter(x => x.startsWith(K)).sort((a, b) => ((lsGet(a) || {}).at || 0) - ((lsGet(b) || {}).at || 0));
    ks.slice(0, Math.max(0, ks.length - KEEP)).forEach(x => localStorage.removeItem(x)); } catch (e) {}
}
const n = (v, d = 0) => v == null || !isFinite(v) ? "?" : (+v).toFixed(d).replace(".", ",").replace("-", "−");
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const last = a => Array.isArray(a) && a.length ? a[a.length - 1][1] : null;
const acts = () => (typeof S !== "undefined" && S && S.all) || [];
const tss = a => { try { return Charge.tssOf(a) || 0; } catch (e) { return 0; } };

// ------------------------------------------------------------------ repères de date et libellés (le modèle ne calcule aucun jour)
const DAY = 864e5, WD = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const day0 = d => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
const addD = (d, k) => { const x = day0(d); x.setDate(x.getDate() + k); return x; };
const fromYmd = s => { const p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
const gap = (d, now) => Math.round((day0(d) - day0(now)) / DAY);   // jours de calendrier
const dm = d => { d = new Date(d); return `${WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
function rel(d, now) {
  const g = gap(d, now);
  return `${g === 0 ? "aujourd'hui" : g === -1 ? "hier" : g === -2 ? "avant-hier" : g === 1 ? "demain" : g === 2 ? "après-demain" : g < 0 ? `il y a ${-g} j` : `dans ${g} j`} (${dm(d)})`;
}
const hh = d => { d = new Date(d); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`; };
const part = h => h < 5 ? "nuit" : h < 12 ? "matin" : h < 14 ? "midi" : h < 18 ? "après-midi" : h < 22 ? "soir" : "fin de soirée";
const dur = s => { if (!(s > 0)) return "?"; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const paceS = p => `${Math.floor(Math.round(p) / 60)}:${String(Math.round(p) % 60).padStart(2, "0")} /km`;
const pace = (m, s) => m > 0 && s > 0 ? paceS(s / (m / 1000)) : null;
const meters = a => a.m > 0 ? a.m : (a.km || 0) * 1000;
const sportOf = a => window.Charge && Charge.sportOf ? Charge.sportOf(a) : /run/i.test(a.t) ? "run" : /ride|cycl|bik/i.test(a.t) ? "bike" : /strength/.test(a.t) ? "strength" : "other";
const indoor = a => sportOf(a) === "run" ? /treadmill|virtual/.test(a.t) : a.t === "VirtualRide" || a.tr === 1;
const MUS = { push: "Push", pull: "Pull", legs: "Legs (jambes)", upper: "Upper" };
function sportFr(a) {
  const s = sportOf(a);
  if (s === "run") return indoor(a) ? "course sur tapis" : "course à pied";
  if (s === "bike") return indoor(a) ? "home trainer" : "vélo dehors";
  if (s !== "strength") return String(a.tk || a.t || "autre").replace(/_/g, " ");
  let l = (lsGet("muscuLbl") || {})[a.id];
  if (!l) try { const m = Plan.muscuOn(ymd(a.dt)); if (m && m.st === "done") l = m.s; } catch (e) {}
  return "muscu" + (MUS[l] ? " " + MUS[l] : "");
}
const ftpW = () => { try { return Math.round(Plan.ftp()) || null; } catch (e) { return null; } };
const zonesTxt = a => { const t = (a.hz || []).reduce((s, x) => s + x, 0); return t ? a.hz.map((x, i) => [i, Math.round(x / t * 100)]).filter(z => z[1] > 0).map(z => `Z${z[0] + 1} ${z[1]} %`).join(", ") : ""; };
const eff = a => sportOf(a) === "run" ? (a.hr && a.mt ? `${n(meters(a) / a.mt * 60 / a.hr, 2)} m par battement` : "") : (a.hr && (a.np || a.w) ? `${n((a.np || a.w) / a.hr, 2)} W par battement` : "");
// une séance en une ligne lisible seule : repère de date, sport en clair, puis seulement ce qui a du sens pour ce sport
function actLine(a, now, o = {}) {
  const s = sportOf(a), P = [`${rel(a.dt, now)} à ${hh(a.dt)}`, sportFr(a)], ftp = ftpW(), m = meters(a);
  if (s === "strength") P.push(dur(a.et || a.mt));
  else {
    const virt = s === "bike" && indoor(a);   // home trainer : km et dénivelé virtuels, sans intérêt
    P.push(dur(a.mt)); if (m >= 500 && !virt) P.push(`${n(m / 1000, 1)} km`);
    if (s === "run") { const p = pace(m, a.mt); if (p) P.push(p); }
    else if (a.w > 0) P.push(`${a.w} W moyens${a.np ? `, ${a.np} W normalisés` : ""}${s === "bike" && ftp ? ` (${Math.round((a.np || a.w) / ftp * 100)} % de la FTP)` : ""}`);
    if (a.el >= 20 && !virt) P.push(`D+ ${a.el} m`);
    if (a.hr) P.push(`${a.hr} bpm moyens`);
    const t = Math.round(tss(a)); if (t) P.push(`charge ${t}`);
    if (o.eff && eff(a)) P.push(eff(a));
    const z = o.zones === false ? "" : zonesTxt(a); if (z) P.push(`cardio ${z}`);
  }
  return "- " + P.join(" · ") + (o.mark ? `  ← ${o.mark}` : "");
}
const hrvWord = d => d.hrv == null || d.hrvLo == null ? "" : d.hrv < d.hrvLo ? "SOUS sa zone normale" : d.hrvUp != null && d.hrv > d.hrvUp ? "au-dessus de sa zone normale" : "dans sa zone normale";
const recoWord = s => s < 45 ? "bas" : s <= 65 ? "moyen" : "bon";
const formWord = t => t > 5 ? "frais" : t > -10 ? "équilibré" : t > -25 ? "chargé" : "très chargé";
// une nuit en une ligne, datée du matin du réveil ; les champs absents sont omis
function nightLine(d, now) {
  const t = s => s ? s.slice(11, 16) : "?", mn = s => Math.round(s / 60) + " min", P = [];
  if (d.sl) P.push(`couché ${t(d.bed)}, levé ${t(d.wake)}, ${dur(d.sl)} dormies${d.deep ? ` (profond ${mn(d.deep)}${d.rem ? `, paradoxal ${mn(d.rem)}` : ""}${d.awake ? `, éveillé ${mn(d.awake)}` : ""})` : ""}${d.score != null ? `, score sommeil ${d.score}` : ""}`);
  if (d.hrv != null) P.push(`VFC ${d.hrv} ms${d.hrvLo != null ? `, ${hrvWord(d)} (${d.hrvLo}-${d.hrvUp}${d.hrv7 != null ? `, moyenne 7 nuits ${d.hrv7}` : ""})` : ""}`);
  const rhr = d.rhr ?? d.srhr; if (rhr != null) P.push(`cœur au repos ${rhr} bpm`);
  const rs = d.rx ?? d.resp; if (rs != null) P.push(`respiration ${n(rs, 1)} /min`);
  if (d.stress != null) P.push(`stress de la veille ${d.stress}`);
  if (d.wx && d.wx.tAvg != null) P.push(`nuit à ${n(d.wx.tAvg, 1)} °C dehors`);
  if (d.tr != null) P.push(`Garmin : prêt à l'entraînement ${d.tr}${d.trLvl ? ` (${d.trLvl})` : ""}${d.recov > 0 ? `, ${dur(d.recov * 60)} de récupération restantes au réveil` : d.recov === 0 ? ", plus de récupération à faire au réveil" : ""}`);
  let sc = null; try { sc = Recup.recoScore(d).score; } catch (e) {}
  if (sc != null) P.push(`score de récup de l'outil ${sc} (${recoWord(sc)})`);
  return `- réveil ${rel(fromYmd(d.d), now)} : ${P.join(" ; ")}`;
}

// ------------------------------------------------------------------ données envoyées (texte, sans nom ni lieu)
// o = { nights, days, weeks, plan: [de, à] en jours autour d'aujourd'hui (« week » = depuis le lundi), focus: id de la séance analysée }
const KIND = {
  chat: { nights: 10, days: 14, weeks: 6, plan: [0, 6] }, question: { nights: 10, days: 14, weeks: 6, plan: [0, 6] },
  seance: { nights: 4, days: 14, weeks: 4, plan: [0, 5] }, recup: { nights: 14, days: 7, weeks: 3, plan: [0, 3] },
  semaine: { nights: 7, days: 14, weeks: 6, plan: ["week", 7] }, objectifs: { nights: 3, days: 10, weeks: 10, plan: [0, 7] },
  sortie: { nights: 3, days: 7, weeks: 3, plan: [0, 6] } };
function secWhen(now) {
  const L = [`Nous sommes ${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, c'est le ${part(now.getHours())}.`, `Heure : ${hh(now)}.`];
  const td = acts().filter(a => a.dt <= now && gap(a.dt, now) === 0).sort((a, b) => a.dt - b.dt);
  L.push(td.length ? `Déjà fait aujourd'hui : ${td.map(a => `${sportFr(a)} à ${hh(a.dt)} (${dur(sportOf(a) === "strength" ? a.et || a.mt : a.mt)})`).join(", ")}.` : "Aucune séance enregistrée aujourd'hui pour l'instant.");
  return L;
}
function secProfile(now) {
  const L = [], P = window.Plan, R = window.Recup && Recup.data, prof = (R && R.profile) || {}, hz = prof.hrZones || {};
  const ftp = ftpW(), kg = +(lsGet("bwWeight")) || null, age = +(lsGet("bwAge")) || null, fl = hz.floors || [];
  const zones = fl.length >= 5 ? ` ; zones cardio : Z1 ${fl[0]}-${fl[1] - 1}, Z2 ${fl[1]}-${fl[2] - 1}, Z3 ${fl[2]}-${fl[3] - 1}, Z4 ${fl[3]}-${fl[4] - 1}, Z5 ≥ ${fl[4]} bpm` : "";
  const run = prof.run || {}, lt = run.lt || {}, V = (prof.vo2 || []).filter(r => r && r[1] != null);
  const V30 = V.filter(x => x[0] >= ymd(addD(now, -30))).map(x => x[1]), rv = last((run.vo2 || []).filter(r => r && r[1] != null));
  // la série VO2max de Garmin change selon le sport de la dernière activité (vélo ≈ 61-63, course ≈ 58-60) : on donne la fourchette, pas une tendance
  const vo2 = V.length ? `VO2max Garmin ${n(last(V), 1)}${V30.length > 1 ? ` (de ${n(Math.min(...V30), 1)} à ${n(Math.max(...V30), 1)} sur 30 jours : la valeur change selon que la dernière séance est du vélo ou de la course, un écart d'un jour à l'autre ne veut rien dire)` : ""}${rv != null ? `, VO2max course ${n(rv, 1)}` : ""}` : "VO2max ?";
  L.push(`Profil : FTP de travail ${ftp || "?"} W (celle du Plan ; la FTP estimée par Garmin${prof.ftp ? `, ${prof.ftp} W,` : ""} est trop haute, ne t'en sers pas)${kg ? `, ${n(kg, kg % 1 ? 1 : 0)} kg` : ""}${age ? `, ${age} ans` : ""} ; `
    + `FC max ${hz.max || "?"}, FC au seuil ${hz.lthr || "?"}, FC repos ${hz.rest || "?"} bpm${zones} ; ${vo2}`
    + `${lt.pace ? ` ; course : allure seuil ${paceS(lt.pace)}, FC seuil ${lt.hr || "?"}` : ""}.`);
  try { const g = P && P._cfg && P._cfg().goal; if (g) L.push(`Objectifs du Plan : FTP ${g.ftp || "?"} W, VO2max ${g.vo2 || "?"}${g.date ? `, pour le ${g.date}` : ""} ; ultra de 250 km à 28 km/h.`); } catch (e) {}
  // course : programme de reprise (reprise.js) et volume récent (course.js)
  try { const X = window.Reprise._, Pg = X.progress(acts(), new Date(now));
    if (Pg.started) L.push("Course à pied : reprise après une blessure au tibia (périostite, arrêt en juin), en complément du vélo. Programme par paliers d'une semaine : footings faciles seulement (où il peut parler, sous 150 bpm environ), pas de fractionné, foulée courte. "
      + X.answer(Pg, X.week(Pg.k, X.weekRuns(acts(), X.mondayOf(+now)), X.longCap(acts(), +now)), +now)); } catch (e) {}
  try { const G = window.Course._.gauge(acts(), +now);
    if (G.acute || G.chronic) L.push(`Volume de course : ${n(G.acute, 1)} km sur les 7 derniers jours, ${n(G.chronic, 1)} km par semaine en moyenne sur les 28 jours d'avant${G.zone != null ? ` (rapport ${n(G.ratio, 2)} : ${["sous-charge", "zone sûre", "vigilance", "risque élevé"][G.zone]})` : ""}.`); } catch (e) {}
  try { const f = Charge.fitness(now); L.push(`Forme aujourd'hui : niveau d'entraînement ${n(f.ctl)}, fatigue récente ${n(f.atl)}, fraîcheur ${n(f.tsb)}, soit « ${formWord(f.tsb)} » (échelle de l'outil : frais > 5, équilibré > −10, chargé > −25, très chargé en dessous).`); } catch (e) {}
  return L;
}
function secNights(now, k) {
  const N = ((window.Recup && Recup.days) || []).filter(d => d.sl || d.hrv).slice(-k).reverse();
  return N.length ? ["Nuits, chacune datée du matin du réveil (la plus récente d'abord) :", ...N.map(d => nightLine(d, now))] : [];
}
function secActs(now, k, focus) {
  const A = acts().filter(a => a.dt <= now && gap(a.dt, now) > -k && (sportOf(a) === "strength" || a.mt >= 300)).sort((a, b) => b.dt - a.dt);
  return A.length ? [`Séances des ${k} derniers jours (la plus récente d'abord) :`, ...A.map(a => actLine(a, now, { mark: a.id === focus ? "la séance analysée" : "" }))] : [];
}
// une ligne par semaine (lundi → dimanche) : volume, charge, part de chaque sport, répartition du cardio
function secWeeks(now, k) {
  const mon0 = addD(now, -((day0(now).getDay() + 6) % 7)), out = [];
  for (let i = 0; i < k; i++) {
    const a0 = addD(mon0, -7 * i), a1 = addD(a0, 7), A = acts().filter(a => a.dt >= a0 && a.dt < a1 && a.dt <= now); if (!A.length && i) continue;
    const by = s => A.filter(a => sportOf(a) === s), B = by("bike"), R = by("run"), M = by("strength"), sum = (L, f) => L.reduce((s, a) => s + (f(a) || 0), 0);
    const Z = [0, 0, 0]; B.concat(R).forEach(a => (a.hz || []).forEach((x, j) => { Z[j < 2 ? 0 : j === 2 ? 1 : 2] += x || 0; })); const zt = Z[0] + Z[1] + Z[2];
    const out_ = B.filter(a => !indoor(a)), long = Math.max(0, ...out_.map(a => meters(a) / 1000));
    out.push(`- semaine du ${dm(a0)}${i ? "" : ` (en cours, jusqu'à aujourd'hui ${WD[now.getDay()]})`} : ${dur(sum(B.concat(R), a => a.mt))} de vélo et course, charge ${Math.round(sum(A, tss))}`
      + ` ; vélo ${B.length ? `${dur(sum(B, a => a.mt))}${out_.length ? `, dont ${n(sum(out_, a => meters(a) / 1000))} km dehors (plus longue sortie ${n(long)} km)` : ", tout sur home trainer"}` : "aucun"}`
      + ` ; course ${R.length ? `${dur(sum(R, a => a.mt))}, ${n(sum(R, a => meters(a) / 1000), 1)} km en ${R.length} sortie${R.length > 1 ? "s" : ""}` : "aucune"} ; muscu ${M.length}`
      + (zt ? ` ; cardio : ${Math.round(Z[0] / zt * 100)} % en Z1-Z2, ${Math.round(Z[1] / zt * 100)} % en Z3, ${Math.round(Z[2] / zt * 100)} % en Z4-Z5` : ""));
  }
  return out.length ? ["Semaines (lundi → dimanche, la plus récente d'abord) :", ...out] : [];
}
// le Plan fait foi pour ce qui vient : séances vélo, course et muscu de chaque jour, avec leur état pour les jours passés et aujourd'hui
function secPlan(now, from, to) {
  const P = window.Plan; if (!P || !P.plannedFor) return [];
  if (from === "week") { const wd = (day0(now).getDay() + 6) % 7; from = -wd - (wd <= 1 ? 7 : 0); }   // lundi et mardi : la semaine dernière aussi (relevé du lundi)
  const out = [];
  for (let i = from; i <= to; i++) {
    const d = addD(now, i), key = ymd(d); let p = null, m = null; try { p = P.plannedFor(key); } catch (e) {} try { m = P.muscuOn ? P.muscuOn(key) : null; } catch (e) {}
    const st = x => x.st === "done" ? ", faite" : x.st === "missed" ? ", non faite" : i < 0 ? "" : i === 0 ? ", reste à faire" : "";
    const one = x => { const ti = (x.w && x.w.title) || x.label || "", g = x.w && x.w.goal ? String(x.w.goal).split(/(?<=[.!?])\s/)[0].replace(/\.$/, "") : "";   // le but : sa première phrase seulement
      return `${ti}${x.dur && !/\d\s?min/.test(ti) ? ` ${x.dur} min` : ""}${x.place === "out" ? " dehors" : x.place === "mw" ? " sur home trainer" : ""}${x.w && x.w.tss ? `, charge prévue ${Math.round(x.w.tss)}` : ""}${st(x)}${g ? ` (${g.slice(0, 130)})` : ""}`; };
    const bike = p && p.sport !== "run" ? p : null, run = p ? (p.sport === "run" ? p : p.run) : null, B = [];
    if (m) B.push(`muscu ${MUS[m.s] || m.label || ""} le matin${st(m)}`);
    if (bike) B.push("vélo : " + one(bike)); if (run) B.push("course : " + one(run));
    if (B.length || (i >= 0 && out.length)) out.push(`- ${rel(d, now)} : ${B.join(" ; ") || "rien de prévu"}`);
  }
  return out.length ? ["Plan (il fait foi pour les séances à venir ; elles sont déjà affichées à Nathan avec leur détail) :", ...out] : [];
}
function data(now = new Date(), o = KIND.chat) {
  // le Plan avant les listes : si le texte est coupé, ce sont les semaines les plus anciennes qui sautent
  return [...secWhen(now), ...secProfile(now), ...secPlan(now, o.plan[0], o.plan[1]), ...secNights(now, o.nights), ...secActs(now, o.days, o.focus), ...secWeeks(now, o.weeks)].join("\n");
}

// ------------------------------------------------------------------ ce que le bilan d'une séance n'affiche pas
// déroulé par tranches à partir du flux (dt, v en km/h × 10, h, c, a, p) : 4 à 10 tranches égales, d'environ 6 min si la séance est courte
function splits(st, run, virt) {
  const N = st && (st.h || st.v || st.p || []).length, dt = st && st.dt; if (!N || !(dt > 0) || N * dt < 900) return [];
  const k = Math.max(4, Math.min(10, Math.round(N * dt / 360))), out = [];
  let ref = null;
  for (let s = 0; s < k; s++) {
    const i0 = Math.round(s * N / k), i1 = Math.round((s + 1) * N / k);
    const avg = (arr, ok) => { if (!arr) return null; let t = 0, c = 0; for (let i = i0; i < i1; i++) { const v = arr[i]; if (v != null && ok(v)) { t += v; c++; } } return c ? t / c : null; };
    const v = avg(st.v, x => x / 10 >= (run ? 3 : 5)), h = avg(st.h, x => x > 0), c = avg(st.c, x => x > 0), p = run ? null : avg(st.p, x => x >= 0);
    let up = 0, dn = 0; if (st.a) for (let i = i0; i < i1; i++) { const a = st.a[i]; if (a == null) continue; if (ref == null) ref = a; else if (a - ref >= 1) { up += a - ref; ref = a; } else if (ref - a >= 1) { dn += ref - a; ref = a; } }
    const P = [];
    if (p != null && st.p) P.push(`${Math.round(p)} W`);
    if (v != null && !virt) P.push(run ? paceS(36000 / v) : `${n(v / 10, 1)} km/h`);
    if (h != null) P.push(`${Math.round(h)} bpm`);
    if (c != null) P.push(`${Math.round(c)} ${run ? "pas/min" : "tr/min"}`);
    if (st.a && !virt && (up >= 2 || dn >= 2)) P.push(`+${Math.round(up)} m / −${Math.round(dn)} m`);
    if (P.length) out.push(`- ${Math.round(i0 * dt / 60)} à ${Math.round(i1 * dt / 60)} min : ${P.join(", ")}`);
  }
  return out;
}
// séances du même genre (même sport, dehors ou dedans, durée proche) des 10 semaines d'avant, la plus récente d'abord
function similar(a, k = 5) {
  const s = sportOf(a), ind = indoor(a);
  return acts().filter(b => b.id !== a.id && b.dt < a.dt && a.dt - b.dt < 70 * DAY && sportOf(b) === s && indoor(b) === ind && b.mt >= a.mt * .6 && b.mt <= a.mt * 1.6).sort((x, y) => y.dt - x.dt).slice(0, k);
}
// ce qui entoure la séance (repères de date par rapport à aujourd'hui, comme partout)
function around(a, now = new Date()) {
  const L = [], key = ymd(a.dt), s = sportOf(a);
  const nt = ((window.Recup && Recup.days) || []).find(d => d.d === key);
  if (nt) L.push("Nuit d'avant la séance : " + nightLine(nt, now).slice(2));
  const same = acts().filter(b => b.id !== a.id && ymd(b.dt) === key).sort((x, y) => x.dt - y.dt), bef = same.filter(b => b.dt < a.dt), aft = same.filter(b => b.dt > a.dt);
  const short = b => `${sportFr(b)} à ${hh(b.dt)} (${dur(sportOf(b) === "strength" ? b.et || b.mt : b.mt)}${Math.round(tss(b)) ? `, charge ${Math.round(tss(b))}` : ""})`;
  L.push(bef.length ? `Plus tôt le même jour : ${bef.map(short).join(", ")}.` : "Rien d'autre plus tôt le même jour.");
  if (aft.length) L.push(`Plus tard le même jour : ${aft.map(short).join(", ")}.`);
  const prev = [1, 2, 3].map(i => { const d = addD(a.dt, -i), A = acts().filter(b => ymd(b.dt) === ymd(d)).sort((x, y) => x.dt - y.dt);
    return `${rel(d, now)} ${A.length ? `charge ${Math.round(A.reduce((t, b) => t + tss(b), 0))} (${A.map(b => `${sportFr(b)} ${dur(sportOf(b) === "strength" ? b.et || b.mt : b.mt)}`).join(", ")})` : "repos"}`; });
  L.push(`Les 3 jours d'avant : ${prev.join(" ; ")}.`);
  try { const f = Charge.fitness(addD(a.dt, -1)); L.push(`Forme la veille au soir : niveau d'entraînement ${n(f.ctl)}, fraîcheur ${n(f.tsb)} (« ${formWord(f.tsb)} »).`); } catch (e) {}
  try { const p = Plan.plannedFor(key, s === "run" ? "run" : "bike");
    if (s === "run" || s === "bike") L.push(p ? `Prévu au Plan ce jour-là en ${s === "run" ? "course" : "vélo"} : ${(p.w && p.w.title) || p.label}${p.dur ? ` ${p.dur} min` : ""}${p.w && p.w.goal ? ` (${String(p.w.goal).split(/(?<=[.!?])\s/)[0].slice(0, 160)})` : ""}` : `Rien de prévu au Plan ce jour-là en ${s === "run" ? "course" : "vélo"}.`); } catch (e) {}
  return L;
}
// blocs « en plus » du bilan d'une séance : déroulé, séances comparables, contexte
function sessionExtra(a, st, now = new Date()) {
  const run = sportOf(a) === "run", L = [], sp = splits(st, run, !run && indoor(a)), sim = similar(a);
  if (sp.length) L.push("Déroulé par tranches (le bilan n'en montre que le graphique) :", ...sp);
  if (sim.length) L.push("Séances comparables d'avant (même sport, durée proche), pour situer celle-ci :", actLine(a, now, { eff: 1, zones: false, mark: "la séance analysée" }), ...sim.map(b => actLine(b, now, { eff: 1, zones: false })));
  else L.push("Aucune séance comparable dans les 10 semaines d'avant.");
  L.push("Ce qui entoure la séance :", ...around(a, now).map(x => "- " + x));
  return L.join("\n");
}
// phrase qui situe la séance par rapport à maintenant
function sessionAbout(a, now = new Date()) {
  const g = gap(a.dt, now), end = new Date(+a.dt + (a.et || a.mt || 0) * 1000), ago = Math.round((now - end) / 60000);
  return `Commentaire de la séance de ${sportFr(a)} faite ${rel(a.dt, now)}, commencée à ${hh(a.dt)} (${part(new Date(a.dt).getHours())})${g === 0 && ago >= 0 ? `, finie il y a ${ago < 90 ? ago + " min" : dur(ago * 60)}` : ""}. `
    + (g <= -2 ? "Nathan relit cette séance après coup : ce qui concerne la suite part d'aujourd'hui, pas du lendemain de la séance." : "Les repères de date (aujourd'hui, hier, demain) sont ceux écrits dans les données.");
}

// texte lisible des éléments affichés (sélecteurs CSS) : libellés, valeurs et paragraphes séparés, sans graphiques ni boutons
function textOf(sels, root = document) {
  const out = [];
  sels.forEach(sel => root.querySelectorAll(sel).forEach(el => {
    const c = el.cloneNode(true);
    c.querySelectorAll("svg, canvas, button, input, select, script, style, .iabox, .leaflet-container, [hidden]").forEach(e => e.remove());
    c.querySelectorAll("*").forEach(e => e.append(" "));   // « 100 » + « 8 h 25 dormies » ne se collent plus
    c.querySelectorAll(".tile .l, .tile .v").forEach(e => e.append(" : "));
    c.querySelectorAll(".tile, p, h2, h3, h4, li, tr, summary, div").forEach(e => e.append("\n"));
    const t = c.textContent.replace(/[ \t\u00a0]+/g, " ").replace(/ ([.,)])/g, "$1").replace(/\( /g, "(").replace(/ *\n\s*/g, "\n").trim();
    if (t) out.push(t);
  }));
  return out.join("\n");
}
// ce que montre l'onglet ouvert (sans la carte, le nom du parcours ni le point de départ)
const PAGE = { synthese: ["#synthese .syblk"], recup: ["#rMorning", "#recup .rans"], plan: ["#plan .card"], sortie: ["#soTiles", "#soVerdict", "#soClimbs", "#soTips", "#soNut", "#soStops .stadv"], activites: ["#app .card"] };
function pageText() { const t = window.Nav && Nav.curTab ? Nav.curTab() : ""; return PAGE[t] ? textOf(PAGE[t]).slice(0, 3500) : ""; }
// Le texte envoyé. o = { kind, about (le sujet), page (ce que l'outil affiche déjà), extra (ce qu'il n'affiche pas), focus, now }.
// Trop long : on raccourcit d'abord les listes (nuits, séances, semaines les plus anciennes), jamais le Plan ni le sujet.
function full(o = {}) {
  const now = o.now || new Date(), base = KIND[o.kind] || KIND.chat, page = o.page != null ? o.page : pageText();
  const head = (o.about ? `SUJET : ${o.about}\n\n` : "")
    + (page ? `CE QUE BREIZH WATTS AFFICHE DÉJÀ À NATHAN (calculé par l'outil, il l'a sous les yeux : ne le lui redis pas) :\n${String(page).slice(0, 4200)}\n\n` : "")
    + (o.extra ? `EN PLUS, CE QUE L'OUTIL N'AFFICHE PAS ICI (sers-t'en pour compléter son analyse) :\n${o.extra}\n\n` : "")
    + "DONNÉES DE NATHAN (chaque date porte son repère : aujourd'hui, hier, il y a 3 j, demain) :\n";
  let k = { ...base, focus: o.focus }, t = head + data(now, k);
  for (let i = 0; i < 12 && t.length > MAX_CTX; i++) { k = { ...k, nights: Math.max(2, k.nights - 2), days: Math.max(4, k.days - 2), weeks: Math.max(2, k.weeks - 1) }; t = head + data(now, k); }
  return t.slice(0, MAX_CTX);
}
// réponse de l'IA en HTML sûr : paragraphes, listes à tirets, intitulé en gras (« Pourquoi : … »), **gras** ; rien d'autre n'est interprété
function html(t) {
  const out = []; let ul = null;
  const inl = s => esc_(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*/g, "");
  String(t || "").replace(/\r/g, "").split("\n").forEach(raw => {
    let s = raw.trim().replace(/^#{1,4}\s*/, ""); if (!s) { ul = null; return; }
    const li = /^(?:[-•–]|\*(?!\*)|\d+[.)])\s+/.exec(s);
    if (li) { if (!ul) { ul = []; out.push(ul); } ul.push(inl(s.slice(li[0].length))); return; }
    ul = null;
    const lab = /^(?:\*\*)?([A-ZÀ-Ý][^\s:*]*(?:\s[^\s:*]+){0,3})\s?:(?:\*\*)?\s+(?=\S)/.exec(s);
    out.push(lab && lab[1].length <= 30 ? `<b>${esc_(lab[1])} :</b> ${inl(s.slice(lab[0].length))}` : inl(s));
  });
  return out.map(x => Array.isArray(x) ? `<ul>${x.map(i => `<li>${i}</li>`).join("")}</ul>` : `<p>${x}</p>`).join("");
}
// script de synchro pas encore à jour (les consignes de l'entraîneur sont dans sync.gs) : une ligne le dit
const stale = j => j && !(j.v >= AI_V) ? "Script de synchro ancien : colle la nouvelle version de sync.gs dans la Sheet (puis nouvelle version du déploiement) pour des commentaires plus justes." : "";
const stamp = at => at ? `${rel(new Date(at), new Date())} à ${hh(at)}` : "";
const avail = () => !!(window.Sync && Sync.configured && Sync.configured() && Sync.ai);
async function ready() { if (!(window.Recup && Recup.data) && window.loadProfile) { try { await window.loadProfile(); } catch (e) {} } }

// ------------------------------------------------------------------ encart à la demande dans une carte
// o = { kind, title, button, ctx: () => texte de la page (ce que l'outil affiche déjà), about: () => le sujet en une phrase }
function mount(el, o) {
  if (!el || !avail()) return;
  const old = el.querySelector(`.iabox[data-kind="${o.kind}"]`); if (old) old.remove();
  const box = document.createElement("div"); box.className = "iabox"; box.dataset.kind = o.kind;
  if (o.ask) {  // question libre : ouvre la conversation
    box.innerHTML = `<p class="iah"><b>${esc_(o.title)}</b> <small>IA (Gemini), à partir de tes données</small></p>
      <form class="iaq"><input type="text" maxlength="600" placeholder="${esc_(o.placeholder || "Ta question")}" aria-label="${esc_(o.title)}"><button class="btn" type="submit">Demander</button></form>`;
    box.querySelector("form").onsubmit = e => { e.preventDefault(); const i = e.target.querySelector("input"), q = i.value.trim(); if (q.length < 2) return; i.value = ""; chat(q); };
    el.appendChild(box); return;
  }
  box.innerHTML = `<p class="iah"><b>${esc_(o.title)}</b> <small>IA (Gemini), à partir de tes données</small></p>
    <button class="btn" type="button" data-ia>${esc_(o.button || "Demander")}</button><div class="iat iatx" hidden></div><p class="note iam" hidden></p>`;
  el.appendChild(box);
  const out = box.querySelector(".iat"), msg = box.querySelector(".iam"), btn = box.querySelector("[data-ia]");
  const say = (t, err) => { const p = err ? msg : out; (err ? out : msg).hidden = true; p.hidden = !t; if (err) p.textContent = t || ""; else p.innerHTML = html(t); };
  const note = t => { msg.hidden = !t; msg.textContent = t || ""; };   // sous la réponse : date de la réponse gardée, script ancien
  btn.onclick = async () => {
    btn.disabled = true; say("L'entraîneur analyse tes données…", true);
    await ready();
    const ctx = full({ kind: o.kind, about: o.about ? o.about() : "", page: o.ctx ? o.ctx() : "" }), key = K + o.kind + ":" + hash(ctx.replace(/^Heure : .*$/m, ""));
    const c = lsGet(key); if (c && c.t) { say(c.t); note(`Réponse gardée (${stamp(c.at)}) : rien n'a changé depuis.`); btn.disabled = false; return; }
    try { const j = await Sync.ai({ kind: o.kind, ctx }); lsPut(key, { t: j.text, at: Date.now() }); say(j.text + left(j)); note(stale(j)); }
    catch (err) { say("Indisponible : " + err.message + ".", true); }
    finally { btn.disabled = false; }
  };
}
const left = j => j.left != null && j.left < 10 ? `\n(${j.left} demande${j.left > 1 ? "s" : ""} restante${j.left > 1 ? "s" : ""} aujourd'hui)` : "";

// ------------------------------------------------------------------ conversation
const SUGG = ["Quelle séance je fais aujourd'hui ?", "Pourquoi ma VFC est basse alors que j'ai bien dormi ?", "Est-ce que je peux faire 150 km aujourd'hui ?", "Analyse ma dernière séance"];
function chatState() { const c = lsGet(K_CHAT); return c && c.d === ymd(new Date()) && Array.isArray(c.m) ? c : { d: ymd(new Date()), m: [] }; }  // une conversation par jour
function chatModal() {
  let m = document.getElementById("iaBack"); if (m) return m;
  m = document.createElement("div"); m.id = "iaBack"; m.className = "bm-back"; m.hidden = true;
  m.innerHTML = `<div class="bm iachat" role="dialog" aria-modal="true" aria-labelledby="iaTitle">
    <header class="bm-head"><div><div class="bm-k">Assistant IA (Gemini)</div><h3 id="iaTitle">Ton entraîneur</h3>
      <div class="bm-sub">Il lit la page ouverte, ton profil, tes nuits, tes séances des 14 derniers jours, tes semaines et ton Plan. Il complète ce que la page calcule déjà.</div></div>
      <button class="bm-x" data-iaclose aria-label="Fermer">✕</button></header>
    <div class="iamsgs" id="iaMsgs" aria-live="polite"></div>
    <div class="chips iasugg" id="iaSugg">${SUGG.map(s => `<button class="chip" type="button">${esc_(s)}</button>`).join("")}</div>
    <form class="iaq" id="iaForm"><input type="text" id="iaIn" maxlength="600" placeholder="Pose ta question à ton entraîneur" aria-label="Ta question" autocomplete="off"><button class="btn primary" type="submit">Envoyer</button></form>
    <p class="note iafoot">Conseils d'entraînement, pas un avis médical. <button class="linkbtn" type="button" id="iaNew">Nouvelle conversation</button></p>
  </div>`;
  document.body.appendChild(m);
  const close = () => { m.hidden = true; document.documentElement.classList.remove("bm-open"); };
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-iaclose]")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !m.hidden) close(); });
  m.querySelector("#iaForm").onsubmit = e => { e.preventDefault(); const i = m.querySelector("#iaIn"), q = i.value.trim(); if (q.length < 2) return; i.value = ""; send(q); };
  m.querySelectorAll("#iaSugg .chip").forEach(b => b.onclick = () => send(b.textContent));
  m.querySelector("#iaNew").onclick = () => { lsSet(K_CHAT, { d: ymd(new Date()), m: [] }); drawChat(); };
  return m;
}
let tick = 0;
function drawChat(busy, err) {
  clearInterval(tick);
  const m = chatModal(), C = chatState(), box = m.querySelector("#iaMsgs");
  box.innerHTML = (C.m.length ? "" : `<p class="note">Pose une question ou choisis une suggestion. Il répond avec tes données du jour.</p>`)
    + C.m.map(x => x.r === "u" ? `<div class="iamsg me">${esc_(x.t)}</div>` : `<div class="iamsg ia iatx">${html(x.t)}</div>`).join("")
    + (busy ? `<div class="iamsg ia busy">L'entraîneur analyse tes données… <span class="iasec"></span></div>` : "") + (err ? `<p class="note iaerr">${esc_(err)}</p>` : "");
  m.querySelector("#iaSugg").hidden = C.m.length > 0;
  m.querySelectorAll("#iaForm button, #iaSugg .chip").forEach(b => b.disabled = !!busy);
  if (busy) { const t0 = Date.now(); tick = setInterval(() => { const e = m.querySelector(".iasec"); if (e) e.textContent = Math.round((Date.now() - t0) / 1000) + " s"; else clearInterval(tick); }, 1000); }
  box.scrollTop = box.scrollHeight; const last_ = box.lastElementChild; if (last_ && last_.scrollIntoView) last_.scrollIntoView({ block: "nearest" });
}
let page0 = "";  // page ouverte au moment d'ouvrir la conversation
async function send(q) {
  const C = chatState(); C.m.push({ r: "u", t: q }); C.m = C.m.slice(-MAX_TURNS); lsSet(K_CHAT, C); drawChat(true);
  if (!avail()) { drawChat(false, "L'entraîneur passe par la synchronisation : configure-la sur cet appareil (carte Chaîne, réglages)."); return; }
  await ready();
  try { const j = await Sync.ai({ kind: "chat", ctx: full({ kind: "chat", about: "conversation avec Nathan ; sa question est dans son message.", page: page0 }), msgs: C.m.slice(-10) });
    C.m.push({ r: "m", t: j.text + left(j) }); lsSet(K_CHAT, C); drawChat(false, stale(j)); }
  catch (e) { C.m.pop(); lsSet(K_CHAT, C); drawChat(false, "Indisponible : " + e.message + "."); const i = document.getElementById("iaIn"); if (i && !i.value) i.value = q; }
}
function chat(q) {
  page0 = pageText();
  const m = chatModal(); m.hidden = false; document.documentElement.classList.add("bm-open"); drawChat();
  if (q) send(q); else setTimeout(() => { const i = document.getElementById("iaIn"); if (i && matchMedia("(hover:hover)").matches) i.focus(); }, 50);
}
// bouton « Entraîneur » dans la barre du haut (seulement si la synchro est configurée)
function addButton() {
  const bar = document.querySelector(".appbar-in"); if (!bar || document.getElementById("iaBtn") || !avail()) return;
  const b = document.createElement("button"); b.id = "iaBtn"; b.className = "iabtn"; b.type = "button"; b.setAttribute("aria-label", "Parler à ton entraîneur (IA)");
  b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Entraîneur</span>`;
  b.onclick = () => chat(); bar.appendChild(b);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton); else addButton();
const relOf = (d, now = new Date()) => rel(typeof d === "string" ? fromYmd(d) : d, now);   // « aujourd'hui (ven. 13/11) » pour les sujets des encarts
window.IA = { mount, chat, data, textOf, full, ready, html, stale, stamp, sessionExtra, sessionAbout, rel: relOf, hh, _: { rel, gap, splits, similar, around, actLine, nightLine, KIND, AI_V } };
})();
