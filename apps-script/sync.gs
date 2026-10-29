// Breizh Watts — synchro entre appareils (Google Sheet + Apps Script).
// À coller dans Extensions > Apps Script d'une Google Sheet privée, puis déployer en application web.
// Aucun secret ici : la clé est lue dans les propriétés du script (SYNC_KEY).
//
// Stockage générique : un onglet par collection, une ligne par élément { id, ts, v }.
// Pour un même id, la version la plus récente (ts, en ms) gagne. La logique propre à
// chaque collection (fusion de l'historique, etc.) est faite côté site (sync.js).
//
// Requête : POST text/plain (pas de preflight CORS), corps JSON :
//   { k: "<clé>", op: "ping" }
//   { k: "<clé>", op: "sync", c: "<collection>", items: [{ id, ts, v }, …] }
//   { k: "<clé>", op: "ai", kind: "seance", ctx: "<bilan en texte>" }   → { ok: true, text, model }
// Réponse : { ok: true, items: [...] } ou { ok: false, err: "...", msg? }.
//
// Commentaire IA (Google Gemini, palier gratuit) : la clé Gemini est dans les propriétés du script (GEMINI_KEY),
// jamais sur le site ni dans le dépôt. Le modèle Flash-Lite le plus récent est choisi tout seul (GEMINI_MODEL pour l'imposer).

var MAX_ITEMS = 500;      // éléments par requête
var MAX_V = 40000;        // caractères par valeur (une cellule en accepte 50 000)
var NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;

function doGet() {
  // Permet de vérifier que l'URL répond. Aucune donnée n'est lue ici.
  return out_({ ok: true, service: "breizh-sync" });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, err: "json" }); }
  var key = PropertiesService.getScriptProperties().getProperty("SYNC_KEY");
  if (!key || key.length < 16) return out_({ ok: false, err: "config" });
  if (!req || typeof req.k !== "string" || !same_(req.k, key)) return out_({ ok: false, err: "cle" });

  if (req.op === "ping") return out_({ ok: true });
  if (req.op === "ai") return out_(ai_(req));
  if (req.op !== "sync") return out_({ ok: false, err: "op" });
  if (typeof req.c !== "string" || !NAME_RE.test(req.c)) return out_({ ok: false, err: "collection" });
  var items = Array.isArray(req.items) ? req.items : [];
  if (items.length > MAX_ITEMS) return out_({ ok: false, err: "trop" });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return out_({ ok: false, err: "occupe" }); }
  try {
    return out_({ ok: true, items: upsert_(sheet_(req.c), items) });
  } finally {
    lock.releaseLock();
  }
}

// Écrit les éléments plus récents que ceux déjà stockés et renvoie l'état complet de la collection.
function upsert_(sh, items) {
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
  var at = {};
  rows.forEach(function (r, i) { at[String(r[0])] = i; });
  items.forEach(function (it) {
    if (!it || typeof it.id !== "string" || !it.id || it.id.length > 200) return;
    var ts = Number(it.ts);
    if (!isFinite(ts)) return;
    var v = JSON.stringify(it.v === undefined ? null : it.v);
    if (v.length > MAX_V) return;
    var i = at[it.id];
    if (i === undefined) { at[it.id] = rows.length; rows.push([it.id, ts, v]); }
    else if (ts > Number(rows[i][1])) rows[i] = [it.id, ts, v];
  });
  if (rows.length) {
    var rg = sh.getRange(2, 1, rows.length, 3);
    rg.setNumberFormats(rows.map(function () { return ["@", "0", "@"]; }));  // texte brut : pas de conversion en date
    rg.setValues(rows);
  }
  return rows.map(function (r) {
    var v = null;
    try { v = JSON.parse(r[2]); } catch (err) {}
    return { id: String(r[0]), ts: Number(r[1]), v: v };
  });
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 3).setValues([["id", "ts", "v"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function same_(a, b) {  // comparaison sans sortie anticipée
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ Commentaire IA (Gemini)
var AI_MAX_CTX = 6000;
var AI_SYS = {
  seance: "Tu es l'entraîneur de Nathan, cycliste sur route (il court aussi). On te donne le bilan d'une de ses séances, déjà calculé par son tableau de bord, "
    + "avec parfois ses objectifs et sa forme du moment. Commente-le en 3 ou 4 phrases, en français, en le tutoyant : ce qui est bien, ce qui l'est moins, "
    + "et une chose concrète pour la prochaine séance. Règles strictes : n'utilise que les chiffres fournis, n'en calcule et n'en invente aucun ; "
    + "pas de sigles (CTL, ATL, TSB, TSS) ; aucun conseil médical (si quelque chose paraît anormal, dis d'en parler à un médecin) ; "
    + "pas de titre, pas de liste, pas de mise en forme, pas de formule de politesse."
};

function ai_(req) {
  var props = PropertiesService.getScriptProperties(), key = props.getProperty("GEMINI_KEY");
  if (!key) return { ok: false, err: "config_ia" };
  var sys = AI_SYS[req.kind];
  if (!sys) return { ok: false, err: "op" };
  var ctx = String(req.ctx || "").slice(0, AI_MAX_CTX);
  if (ctx.length < 20) return { ok: false, err: "vide" };
  var model = model_(key, props), body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: ctx }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  };
  var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "post", contentType: "application/json", headers: { "x-goog-api-key": key }, payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = r.getResponseCode(), j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (code === 429) return { ok: false, err: "quota_ia" };
  if (code !== 200) {
    if (code === 404) CacheService.getScriptCache().remove("gemini_model");  // modèle retiré : on en recherchera un autre
    return { ok: false, err: "ia", msg: String((j.error && j.error.message) || ("Gemini " + code)).slice(0, 200) };
  }
  var c = j.candidates && j.candidates[0], parts = c && c.content && c.content.parts || [];
  var text = parts.map(function (p) { return p.text || ""; }).join("").trim();
  if (!text) return { ok: false, err: "ia", msg: "réponse vide" + (c && c.finishReason ? " (" + c.finishReason + ")" : "") };
  return { ok: true, text: text.slice(0, 2000), model: model };
}

// le Gemini Flash-Lite stable le plus récent (liste des modèles de la clé), gardé 6 h ; repli sur l'alias « latest »
function model_(key, props) {
  var fixed = props.getProperty("GEMINI_MODEL");
  if (fixed) return fixed;
  var cache = CacheService.getScriptCache(), m = cache.get("gemini_model");
  if (m) return m;
  try {
    var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, muteHttpExceptions: true });
    var L = (JSON.parse(r.getContentText()).models || []).filter(function (x) {
      return (x.supportedGenerationMethods || []).indexOf("generateContent") >= 0 && /^models\/gemini-\d+(\.\d+)?-flash-lite$/.test(x.name);
    }).map(function (x) { return { n: x.name.replace("models/", ""), v: parseFloat(x.name.replace(/^models\/gemini-/, "")) }; });
    L.sort(function (a, b) { return b.v - a.v; });
    if (L.length) m = L[0].n;
  } catch (e) {}
  m = m || "gemini-flash-lite-latest";
  cache.put("gemini_model", m, 21600);
  return m;
}
