"use strict";
// Encart « l'entraîneur (IA) » réutilisable : Gemini par l'Apps Script de synchro (Sync.ai), demande de Nathan du 30/10/2026.
// Toujours à la demande (un bouton, jamais d'appel automatique) ; le texte envoyé = les phrases et chiffres que la page affiche déjà,
// sans nom de sortie ni lieu. Réponse gardée sur l'appareil par contexte (aiBox:<usage>:<empreinte>) : redemander sur les mêmes
// chiffres ne rappelle pas Gemini. Le script plafonne à 60 demandes par jour. Un commentaire qui cite un chiffre absent des
// données envoyées est écarté (même contrôle que le bilan de séance).
(() => {
const K = "aiBox:", KEEP = 60, MAX_CTX = 5500;
const esc_ = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numsOf = t => (String(t).replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(",", "."));
function check(text, base) { const have = new Set(numsOf(base).map(x => String(+x))); return numsOf(text).filter(x => (+x >= 10 || /\./.test(x)) && !have.has(String(+x))); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
function lsPut(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v));
    const ks = Object.keys(localStorage).filter(x => x.startsWith(K)).sort((a, b) => ((lsGet(a) || {}).at || 0) - ((lsGet(b) || {}).at || 0));
    ks.slice(0, Math.max(0, ks.length - KEEP)).forEach(x => localStorage.removeItem(x)); } catch (e) {}
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
  return out.join("\n").slice(0, MAX_CTX);
}
const avail = () => !!(window.Sync && Sync.configured && Sync.configured() && Sync.ai);
// el : conteneur ; o = { kind, title, button, ctx: () => texte, ask: bool, placeholder }
function mount(el, o) {
  if (!el || !avail()) return;
  const old = el.querySelector(`.iabox[data-kind="${o.kind}"]`); if (old) old.remove();
  const box = document.createElement("div"); box.className = "iabox"; box.dataset.kind = o.kind;
  box.innerHTML = `<p class="iah"><b>${esc_(o.title)}</b> <small>IA (Gemini), à partir des chiffres de la page</small></p>
    ${o.ask ? `<form class="iaq"><input type="text" maxlength="300" placeholder="${esc_(o.placeholder || "Ta question")}" aria-label="${esc_(o.title)}"><button class="btn" type="submit">Demander</button></form>`
      : `<button class="btn" type="button" data-ia>${esc_(o.button || "Demander")}</button>`}
    <p class="iat" hidden></p><p class="note iam" hidden></p>`;
  el.appendChild(box);
  const out = box.querySelector(".iat"), msg = box.querySelector(".iam"), say = (t, err) => { const p = err ? msg : out; (err ? out : msg).hidden = true; p.hidden = !t; p.textContent = t || ""; };
  const go = async (btn, q = "") => {
    const ctx = o.ctx(), base = ctx + "\n" + q, key = K + o.kind + ":" + hash(base);
    if (ctx.length < 20) { say("Pas encore assez de données sur la page.", true); return; }
    const c = lsGet(key); if (c && c.t) { say(c.t); return; }
    btn.disabled = true; say("L'entraîneur lit tes chiffres…", true);
    try {
      const j = await Sync.ai({ kind: o.kind, ctx, q }), bad = check(j.text, base);
      if (bad.length) { say(`Réponse écartée : elle cite des chiffres absents de la page (${bad.slice(0, 3).join(", ")}). Redemande.`, true); return; }
      lsPut(key, { t: j.text, at: Date.now() });
      say(j.text + (j.left != null && j.left < 10 ? `\n(${j.left} demande${j.left > 1 ? "s" : ""} restante${j.left > 1 ? "s" : ""} aujourd'hui)` : ""));
    } catch (err) { say("Indisponible : " + err.message + ".", true); }
    finally { btn.disabled = false; }
  };
  if (o.ask) { const f = box.querySelector("form"); f.onsubmit = e => { e.preventDefault(); const q = f.querySelector("input").value.trim(); if (q.length >= 3) go(f.querySelector("button"), q); }; }
  else { const b = box.querySelector("[data-ia]"); b.onclick = () => go(b); }
}
window.IA = { mount, textOf, _check: check, _numsOf: numsOf };
})();
