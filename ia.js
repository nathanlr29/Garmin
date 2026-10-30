"use strict";
// L'entraîneur IA (Gemini par l'Apps Script de synchro, Sync.ai). Demandes de Nathan des 30/10/2026 : « intègre Gemini partout »,
// puis « que ce soit vraiment un assistant » : il reçoit les données brutes (profil, zones, forme, 14 dernières nuits, séances des
// 14 derniers jours, Plan des 7 prochains jours) en plus de la page ouverte, analyse les causes et propose des séances précises.
// - IA.chat() : conversation (bouton « Entraîneur » de la barre du haut, et la question de la Synthèse) ;
// - IA.mount() : encart à la demande dans une carte existante (récup, semaine, objectifs, sortie).
// Jamais d'appel automatique ; le script plafonne à 60 demandes par jour. Ni nom de sortie, ni lieu, ni point de départ envoyés.
(() => {
const K = "aiBox:", KEEP = 60, K_CHAT = "aiChat", MAX_CTX = 13000, MAX_TURNS = 20;
const esc_ = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function lsPut(k, v) {
  lsSet(k, v);
  try { const ks = Object.keys(localStorage).filter(x => x.startsWith(K)).sort((a, b) => ((lsGet(a) || {}).at || 0) - ((lsGet(b) || {}).at || 0));
    ks.slice(0, Math.max(0, ks.length - KEEP)).forEach(x => localStorage.removeItem(x)); } catch (e) {}
}
const n = (v, d = 0) => v == null || !isFinite(v) ? "?" : (+v).toFixed(d).replace(".", ",");
const hmn = s => { if (!(s > 0)) return "?"; const m = Math.round(s / 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const ymd = d => window.Charge ? Charge.ymd(d) : d.toISOString().slice(0, 10);
const day = d => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "numeric" });
const last = a => Array.isArray(a) && a.length ? a[a.length - 1][1] : null;

// ------------------------------------------------------------------ données envoyées (texte compact, sans nom ni lieu)
function data(now = new Date()) {
  const L = [], P = window.Plan, R = window.Recup && Recup.data, prof = (R && R.profile) || {}, hz = prof.hrZones || {};
  L.push(`Maintenant : ${now.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.`);
  // profil et zones
  let ftp = null; try { ftp = P && P.ftp ? Math.round(P.ftp()) : null; } catch (e) {}
  const kg = +(lsGet("bwWeight")) || null, age = +(lsGet("bwAge")) || null, fl = hz.floors || [];
  const zones = fl.length >= 5 ? ` ; zones cardio : Z1 ${fl[0]}-${fl[1] - 1}, Z2 ${fl[1]}-${fl[2] - 1}, Z3 ${fl[2]}-${fl[3] - 1}, Z4 ${fl[3]}-${fl[4] - 1}, Z5 ≥ ${fl[4]} bpm` : "";
  const run = prof.run || {}, lt = run.lt || {}, pace = lt.pace ? `${Math.floor(lt.pace / 60)}:${String(Math.round(lt.pace % 60)).padStart(2, "0")}/km` : null;
  L.push(`Profil : FTP de travail ${ftp || "?"} W${prof.ftp ? ` (FTP estimée par Garmin ${prof.ftp} W, souvent trop haute ; les séances se calent sur la FTP de travail)` : ""}${kg ? `, ${n(kg, kg % 1 ? 1 : 0)} kg` : ""}${age ? `, ${age} ans` : ""} ; `
    + `FC max ${hz.max || "?"}, FC au seuil ${hz.lthr || "?"}, FC repos ${hz.rest || "?"} bpm${zones} ; VO2max ${n(last(prof.vo2), 1)}${pace ? ` ; course : allure seuil ${pace}, FC seuil ${lt.hr || "?"}` : ""}.`);
  try { const g = P && P._cfg && P._cfg().goal; if (g) L.push(`Objectifs du Plan : FTP ${g.ftp || "?"} W, VO2max ${g.vo2 || "?"}${g.date ? `, pour le ${g.date}` : ""} ; ultra de 250 km à 28 km/h.`); } catch (e) {}
  // forme
  try { const f = Charge.fitness(); L.push(`Forme aujourd'hui : niveau d'entraînement ${n(f.ctl)}, fatigue récente ${n(f.atl)}, fraîcheur ${n(f.tsb)} (frais > 5, équilibré > −10, chargé > −25, très chargé en dessous).`); } catch (e) {}
  // nuits
  const days = (window.Recup && Recup.days) || [];
  const nights = days.filter(d => d.sl || d.hrv).slice(-14).reverse();
  if (nights.length) {
    L.push("Nuits (la plus récente d'abord) : date | coucher → lever | sommeil (profond / léger / paradoxal / éveillé) | score sommeil | VFC nuit (zone normale, moyenne 7 nuits) | cœur repos | respiration | stress sommeil | stress journée veille | température nuit | prêt à l'entraînement Garmin | récup Garmin restante au réveil | score récup du site");
    nights.forEach(d => {
      let sc = null; try { sc = Recup.recoScore(d).score; } catch (e) {}
      const t = s => s ? s.slice(11, 16) : "?", m = s => s ? Math.round(s / 60) + " min" : "?";
      L.push(`- ${d.d} | ${t(d.bed)} → ${t(d.wake)} | ${hmn(d.sl)} (${m(d.deep)} / ${m(d.light)} / ${m(d.rem)} / ${m(d.awake)}) | ${d.score ?? "?"} | ${d.hrv ?? "?"} ms (${d.hrvLo ?? "?"}-${d.hrvUp ?? "?"}, 7 nuits ${d.hrv7 ?? "?"}) | ${d.rhr ?? d.srhr ?? "?"} bpm | ${n(d.rx ?? d.resp, 1)} /min | ${d.sstress ?? "?"} | ${d.stress ?? "?"} | ${d.wx ? n(d.wx.tAvg, 1) + " °C" : "?"} | ${d.tr ?? "?"}${d.trLvl ? " " + d.trLvl : ""} | ${d.recov != null ? hmn(d.recov * 60) : "?"} | ${sc ?? "?"}`);
    });
  }
  // séances des 14 derniers jours
  const A = ((typeof S !== "undefined" && S.all) || []).filter(a => now - a.dt < 14 * 864e5 && a.dt <= now).sort((a, b) => b.dt - a.dt);
  if (A.length) {
    L.push("Séances des 14 derniers jours (la plus récente d'abord) : date heure | sport | durée | distance | D+ | puissance moy. / normalisée | cardio moy. | charge | effet aérobie Garmin | temps en zones cardio Z1-Z5");
    A.forEach(a => {
      const tot = (a.hz || []).reduce((s, x) => s + x, 0), Z = tot ? a.hz.map(x => Math.round(x / tot * 100) + " %").join(" ") : "?";
      let tss = null; try { tss = Math.round(Charge.tssOf(a)); } catch (e) {}
      L.push(`- ${a.d.slice(0, 16).replace("T", " ")} | ${a.tk || a.t} | ${hmn(a.mt)} | ${a.km ? n(a.km, 1) + " km" : "-"} | ${a.el || 0} m | ${a.w ? a.w + " W" : "-"} / ${a.np ? a.np + " W" : "-"} | ${a.hr || "?"} bpm | ${tss ?? "?"} | ${a.te ? n(a.te, 1) : "?"} | ${Z}`);
    });
  }
  // Plan des 7 prochains jours
  if (P && P.plannedFor) {
    const out = [], d0 = new Date(now.toDateString());
    for (let i = 0; i < 7; i++) {
      const d = new Date(d0); d.setDate(d.getDate() + i); let p = null; try { p = P.plannedFor(ymd(d)); } catch (e) {}
      if (!p) continue;
      const one = x => x ? `${(x.w && x.w.title) || x.label}${x.dur ? ` ${x.dur} min` : ""}${x.place === "out" ? " dehors" : x.place === "mw" ? " home trainer" : ""}${x.st === "done" ? " (faite)" : x.st === "missed" ? " (non faite)" : ""}${x.w && x.w.goal ? ` : ${x.w.goal}` : ""}` : "";
      out.push(`- ${i ? day(d) : "aujourd'hui"} : ${[one(p.sport === "run" ? null : p), p.sport === "run" ? "course " + one(p) : p.run ? "course " + one(p.run) : ""].filter(Boolean).join(" + ") || "repos"}`);
    }
    if (out.length) L.push("Plan des 7 prochains jours :", ...out);
  }
  return L.join("\n");
}

// texte lisible des éléments affichés (sélecteurs CSS) : libellés, valeurs et paragraphes séparés, sans graphiques ni boutons
function textOf(sels, root = document) {
  const out = [];
  sels.forEach(sel => root.querySelectorAll(sel).forEach(el => {
    const c = el.cloneNode(true);
    c.querySelectorAll("svg, canvas, button, input, select, script, style, .iabox, .leaflet-container, [hidden]").forEach(e => e.remove());
    c.querySelectorAll(".tile .l, .tile .v").forEach(e => e.append(" : "));
    c.querySelectorAll(".tile, p, h2, h3, h4, li, tr, summary, div").forEach(e => e.append("\n"));
    const t = c.textContent.replace(/[ \t ]+/g, " ").replace(/ *\n\s*/g, "\n").trim();
    if (t) out.push(t);
  }));
  return out.join("\n");
}
// ce que montre l'onglet ouvert (sans la carte, le nom du parcours ni le point de départ)
const PAGE = { synthese: ["#synthese .syblk"], recup: ["#rMorning", "#recup .rans"], plan: ["#plan .card"], sortie: ["#soTiles", "#soVerdict", "#soClimbs", "#soTips", "#soNut", "#soStops .stadv"], activites: ["#app .card"] };
function pageText() { const t = window.Nav && Nav.curTab ? Nav.curTab() : ""; return PAGE[t] ? textOf(PAGE[t]).slice(0, 4000) : ""; }
function full(extra) {  // la page d'abord (courte), puis les données : si c'est trop long, ce sont les plus vieilles lignes qui sautent
  const p = extra != null ? extra : pageText();
  return ((p ? `Ce qu'affiche la page ouverte :\n${p}\n\n` : "") + "Tes données :\n" + data()).slice(0, MAX_CTX);
}
const avail = () => !!(window.Sync && Sync.configured && Sync.configured() && Sync.ai);
async function ready() { if (!(window.Recup && Recup.data) && window.loadProfile) { try { await window.loadProfile(); } catch (e) {} } }

// ------------------------------------------------------------------ encart à la demande dans une carte
// o = { kind, title, button, ctx: () => texte de la page à joindre aux données }
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
    <button class="btn" type="button" data-ia>${esc_(o.button || "Demander")}</button><p class="iat" hidden></p><p class="note iam" hidden></p>`;
  el.appendChild(box);
  const out = box.querySelector(".iat"), msg = box.querySelector(".iam"), btn = box.querySelector("[data-ia]");
  const say = (t, err) => { const p = err ? msg : out; (err ? out : msg).hidden = true; p.hidden = !t; p.textContent = t || ""; };
  btn.onclick = async () => {
    btn.disabled = true; say("L'entraîneur analyse tes données…", true);
    await ready();
    const ctx = full(o.ctx ? o.ctx() : ""), key = K + o.kind + ":" + hash(ctx.replace(/^Maintenant : .*$/m, ""));
    const c = lsGet(key); if (c && c.t) { say(c.t); btn.disabled = false; return; }
    try { const j = await Sync.ai({ kind: o.kind, ctx }); lsPut(key, { t: j.text, at: Date.now() }); say(j.text + left(j)); }
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
      <div class="bm-sub">Il lit ton profil, tes 14 dernières nuits, tes séances des 14 derniers jours, ton Plan de la semaine et la page ouverte.</div></div>
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
    + C.m.map(x => `<div class="iamsg ${x.r === "u" ? "me" : "ia"}">${esc_(x.t)}</div>`).join("")
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
  try { const j = await Sync.ai({ kind: "chat", ctx: full(page0), msgs: C.m.slice(-10) }); C.m.push({ r: "m", t: j.text + left(j) }); lsSet(K_CHAT, C); drawChat(); }
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
window.IA = { mount, chat, data, textOf, full, ready };
})();
