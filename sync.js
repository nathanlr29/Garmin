"use strict";
// Synchro entre appareils : Google Sheet privée + Apps Script (apps-script/sync.gs).
// Générique : chaque « collection » est un ensemble d'éléments { id, ts, v } où, pour un même id,
// la version la plus récente gagne. Une collection déclare comment se lire depuis son localStorage
// (local) et comment intégrer l'état du serveur (apply). Sans configuration, rien ne s'exécute.
(() => {
const K_CFG = "syncCfg", K_Q = "syncQ", K_AT = "syncAt", K_INIT = "syncInit:";
const ls = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const cols = {};             // nom -> { local(), apply(items) }
const st = { s: "off", msg: "" };  // off | sync | ok | wait | err (fixé au chargement)
let running = null, again = false, retry = null;

function cfg() { const c = ls.get(K_CFG, null); return c && c.url && c.key ? c : null; }
function validUrl(u) {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u)
    || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(u));  // tests en local
}
function pending() { const q = ls.get(K_Q, {}); return Object.values(q).reduce((n, m) => n + Object.keys(m).length, 0); }
function enqueue(name, items) {
  const q = ls.get(K_Q, {}), m = q[name] || (q[name] = {});
  for (const it of items) if (!m[it.id] || it.ts >= m[it.id].ts) m[it.id] = it;
  ls.set(K_Q, q);
}
function setState(s, msg = "") {
  st.s = s; st.msg = msg;
  document.querySelectorAll(".syncdot").forEach(paintDot);
  document.querySelectorAll(".syncstate").forEach(el => el.textContent = stateText());
}
function stateText() {
  const at = ls.get(K_AT, 0), when = at ? new Date(at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return { off: "Non configurée : les données restent sur cet appareil.", sync: "Synchronisation…",
    ok: `Synchronisé${when ? ` (${when})` : ""}.`, wait: `En attente : ${pending()} modification(s) à envoyer${st.msg ? ` (${st.msg})` : ""}.`,
    err: `Erreur : ${st.msg || "inconnue"}.` }[st.s];
}

async function call(c, body) {
  // text/plain = requête « simple » : pas de preflight, qu'Apps Script ne sait pas gérer.
  const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ k: c.key, ...body }), credentials: "omit", redirect: "follow" });
  if (!r.ok) throw Object.assign(new Error(`le serveur répond ${r.status}`), { hard: true });
  let j; try { j = await r.json(); } catch (e) { throw Object.assign(new Error("réponse illisible (URL de déploiement ?)"), { hard: true }); }
  if (!j.ok) throw Object.assign(new Error({ cle: "clé refusée", config: "clé absente du script (SYNC_KEY)", occupe: "serveur occupé" }[j.err] || j.err || "refus"), { hard: j.err !== "occupe" });
  return j;
}

async function syncAll() {
  const c = cfg(); if (!c) { setState("off"); return; }
  if (running) { again = true; return running; }
  clearTimeout(retry);
  running = (async () => {
    setState("sync");
    try {
      for (const [name, col] of Object.entries(cols)) {
        if (!ls.get(K_INIT + name, false)) enqueue(name, col.local());  // migration : on envoie l'existant, le serveur fusionne
        const sent = Object.values(ls.get(K_Q, {})[name] || {});
        const j = await call(c, { op: "sync", c: name, items: sent });
        const q = ls.get(K_Q, {}), m = q[name] || {};
        for (const it of sent) if (m[it.id] && m[it.id].ts === it.ts) delete m[it.id];  // envoyé et pas modifié entre-temps
        if (!Object.keys(m).length) delete q[name];
        ls.set(K_Q, q); ls.set(K_INIT + name, true);
        try { col.apply(j.items || []); } catch (e) { console.error(e); }
      }
      ls.set(K_AT, Date.now());
      setState(pending() ? "wait" : "ok");
    } catch (e) {
      if (e.hard) setState("err", e.message);
      else { setState("wait", navigator.onLine === false ? "hors ligne" : "réseau indisponible"); retry = setTimeout(syncAll, 60e3); }
    } finally { running = null; }
    if (again) { again = false; syncAll(); }
  })();
  return running;
}

let soon;
function push(name, items) {  // à appeler après chaque enregistrement local
  if (!cfg()) return;
  enqueue(name, items);
  setState("wait");
  clearTimeout(soon); soon = setTimeout(syncAll, 300);
}
function register(name, col) { cols[name] = col; }

// ------------------------------------------------------------- Interface (réutilisable par n'importe quelle carte)
function paintDot(el) {
  const s = st.s; el.hidden = s === "off";
  el.dataset.s = s; el.textContent = { sync: "⟳", ok: "✓", wait: "…", err: "!" }[s] || "";
  el.title = stateText(); el.setAttribute("aria-label", "Synchro : " + stateText());
}
function dot() { const el = document.createElement("span"); el.className = "syncdot"; el.setAttribute("role", "status"); paintDot(el); return el.outerHTML; }
function settingsHtml() {
  const c = ls.get(K_CFG, {}) || {};
  return `<div class="syncbox"><div class="synch">Synchronisation</div>
    <p class="syncstate">${stateText()}</p>
    <label>URL de l'application web<input type="url" class="syncurl" value="${esc(c.url || "")}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"></label>
    <label>Clé secrète<input type="password" class="synckey" value="${esc(c.key || "")}" autocomplete="off"></label>
    <div class="syncbtns"><button class="btn primary syncsave">Activer la synchro</button><button class="btn synctest">Tester</button>
    ${cfg() ? `<button class="btn synclink">Copier le lien de configuration</button><button class="btn syncoff">Déconnecter</button>` : ""}</div>
    <div class="syncout"></div></div>`;
}
function bindSettings(root, rerender) {
  const $ = s => root.querySelector(s); if (!$(".syncbox")) return;
  const read = () => ({ url: $(".syncurl").value.trim(), key: $(".synckey").value.trim() });
  const check = c => { if (!validUrl(c.url)) return "L'URL doit être celle du déploiement : https://script.google.com/macros/s/…/exec"; if (c.key.length < 16) return "La clé doit faire au moins 16 caractères."; return ""; };
  const out = t => { $(".syncout").textContent = t; };
  $(".syncsave").onclick = () => { const c = read(), e = check(c); if (e) return out(e); configure(c); rerender && rerender(); };
  $(".synctest").onclick = async () => { const c = read(), e = check(c); if (e) return out(e); out("Test…");
    try { await call(c, { op: "ping" }); out("Connexion OK."); } catch (err) { out("Échec : " + err.message); } };
  if ($(".synclink")) $(".synclink").onclick = () => {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(cfg())))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}#sync=${code}`;
    const note = "Ce lien contient ta clé : ouvre-le seulement sur tes propres appareils.";
    const show = () => { $(".syncout").innerHTML = `${note}<input class="syncshare" readonly value="${esc(url)}" aria-label="Lien de configuration">`; $(".syncshare").select(); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => out("Lien copié. " + note), show); else show();
  };
  if ($(".syncoff")) $(".syncoff").onclick = () => {
    if (!confirm("Déconnecter cet appareil ? Les données restent ici et dans la Sheet, mais ne seront plus synchronisées.")) return;
    [K_CFG, K_Q, K_AT].forEach(ls.del); Object.keys(cols).forEach(n => ls.del(K_INIT + n));
    setState("off"); rerender && rerender();
  };
}
function configure(c) {
  const old = cfg();
  if (!old || old.url !== c.url) Object.keys(cols).forEach(n => ls.del(K_INIT + n));  // nouvelle Sheet : on renvoie l'historique local
  ls.set(K_CFG, { url: c.url, key: c.key });
  syncAll();
}
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 5000); }
function importLink() {  // #sync=<base64 de { url, key }> : configure un nouvel appareil en un clic
  const h = location.hash; if (!h.startsWith("#sync=")) return;
  try {
    const raw = h.slice(6).replace(/-/g, "+").replace(/_/g, "/"), o = JSON.parse(decodeURIComponent(escape(atob(raw + "===".slice((raw.length + 3) % 4)))));
    if (!o || !validUrl(o.url) || typeof o.key !== "string" || o.key.length < 16) throw 0;
    const old = cfg();
    if (old && (old.url !== o.url || old.key !== o.key) && !confirm("Remplacer la synchronisation déjà configurée sur cet appareil ?")) { /* on garde l'ancienne */ }
    else { configure(o); toast("Synchronisation configurée sur cet appareil."); }
  } catch (e) { toast("Lien de synchronisation illisible."); }
  history.replaceState(null, "", location.pathname + location.search);  // la clé ne reste pas dans l'URL
}

const css = document.createElement("style");
css.textContent = `.syncdot{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:11px;font-weight:800;line-height:1;color:#fff;background:var(--muted);cursor:help;flex:none}
.syncdot[data-s=ok]{background:var(--good)}.syncdot[data-s=wait]{background:var(--warn)}.syncdot[data-s=err]{background:var(--bad)}.syncdot[data-s=sync]{background:var(--muted)}
.syncdot[hidden]{display:none}
.syncbox{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;display:grid;gap:8px}
.syncbox .synch{font-weight:700}.syncbox .syncstate{margin:0;color:var(--muted);font-size:12.5px}
.syncbox label{display:grid;gap:4px;font-size:12.5px;color:var(--muted)}
.syncbox input{font:inherit;font-size:14px;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:var(--r-md);padding:6px 8px;min-width:0;width:100%;box-sizing:border-box}
.syncbox .syncbtns{display:flex;flex-wrap:wrap;gap:8px}
.syncbox .syncshare{margin-top:6px}
.syncbox .syncout{font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}.syncbox .syncout:empty{display:none}`;
document.head.appendChild(css);

window.Sync = { register, push, sync: syncAll, configured: () => !!cfg(), dot, settingsHtml, bindSettings, state: () => st.s };
if (cfg()) st.s = "sync";
addEventListener("load", () => { if (location.hash.startsWith("#sync=")) importLink(); else if (cfg()) syncAll(); });  // après le chargement : toutes les collections sont déclarées
addEventListener("hashchange", importLink);  // lien collé dans un onglet déjà ouvert
addEventListener("online", () => { if (cfg()) syncAll(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && cfg() && st.s !== "sync") syncAll(); });
})();
