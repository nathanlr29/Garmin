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
//   { k: "<clé>", op: "ai", kind: "seance|question|semaine|recup|sortie|objectifs", ctx: "<chiffres en texte>", q?: "<question>" }
//     → { ok: true, text, model, left }   (left = demandes restantes aujourd'hui, plafond AI_DAY)
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
  if (req.op === "ai") {
    // une erreur Apps Script (autorisation manquante, service indisponible) renverrait une page HTML illisible
    // pour le site (« Failed to fetch ») : on répond toujours en JSON, avec la raison
    try { return out_(ai_(req)); } catch (err) { return out_({ ok: false, err: "ia", msg: String(err && err.message || err).slice(0, 200) }); }
  }
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
var AI_MAX_CTX = 6000, AI_MAX_Q = 300;
var AI_DAY = 60;  // demandes par jour au plus (le palier gratuit de Flash-Lite en permet bien plus) ; jour du Pacifique, comme les quotas Google
var AI_RULES = " Règles strictes : n'utilise que les chiffres fournis, n'en calcule et n'en invente aucun ; pas de sigles (CTL, ATL, TSB, TSS) ; "
  + "aucun conseil médical (si quelque chose paraît anormal, dis d'en parler à un médecin) ; pas de titre, pas de liste, pas de mise en forme, pas de formule de politesse ; "
  + "en français, en le tutoyant.";
var AI_WHO = "Tu es l'entraîneur de Nathan, cycliste sur route en Bretagne (il court aussi). Les données viennent de son tableau de bord, déjà calculées. ";
var AI_SYS = {
  seance: AI_WHO + "On te donne le bilan d'une séance. Commente-le en 3 ou 4 phrases : ce qui est bien, ce qui l'est moins, une chose concrète pour la prochaine séance." + AI_RULES,
  question: AI_WHO + "On te donne son état de forme, ses objectifs et sa semaine prévue, puis sa question. Réponds en 5 phrases au plus, seulement à partir de ces données ; "
    + "si elles ne suffisent pas pour répondre, dis-le et dis ce qu'il faudrait savoir. Si la question ne porte pas sur l'entraînement, le vélo, la course, la récupération ou l'alimentation du sportif, "
    + "réponds seulement que tu ne traites que ces sujets." + AI_RULES,
  semaine: AI_WHO + "On te donne sa semaine (et le relevé de la semaine dernière s'il existe), sa progression et ses alertes. Fais-en le bilan en 4 phrases : "
    + "ce qui a marché, ce qui a coincé, une priorité pour les jours qui viennent." + AI_RULES,
  recup: AI_WHO + "On te donne sa nuit et ses indicateurs de récupération comparés à sa normale. Explique en 3 ou 4 phrases ce qu'ils disent ensemble, "
    + "en reliant les signaux (charge des jours précédents, heure de coucher, durée et qualité du sommeil, VFC, cœur au repos), puis ce que ça implique pour sa journée. Aucun diagnostic." + AI_RULES,
  sortie: AI_WHO + "On te donne l'analyse d'une sortie à venir : vent et sa fiabilité, profil et montées, arrêts conseillés, alimentation, tenue. Fais-lui un briefing d'avant-départ "
    + "en 4 ou 5 phrases : les moments clés du parcours, où il aura le vent, où s'arrêter, quoi manger et emporter." + AI_RULES,
  objectifs: AI_WHO + "On te donne ses objectifs, où il en est, sa progression et ses paliers d'entraînement. Fais le point en 4 phrases : ce qui progresse, ce qui bloque, "
    + "et un ajustement concret à proposer (c'est lui qui décidera dans son Plan)." + AI_RULES
};

// compteur du jour (propriétés du script, sous verrou) : faux si le plafond est atteint ; sinon le nombre restant après celle-ci
function aiCount_() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return 0; }
  try {
    var p = PropertiesService.getScriptProperties(), day = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"), c = {};
    try { c = JSON.parse(p.getProperty("AI_COUNT") || "{}"); } catch (e) {}
    var n = c.d === day ? c.n || 0 : 0;
    if (n >= AI_DAY) return false;
    p.setProperty("AI_COUNT", JSON.stringify({ d: day, n: n + 1 }));
    return AI_DAY - n - 1;
  } finally { lock.releaseLock(); }
}

function ai_(req) {
  var props = PropertiesService.getScriptProperties(), key = props.getProperty("GEMINI_KEY");
  if (!key) return { ok: false, err: "config_ia" };
  var sys = AI_SYS[req.kind];
  if (!sys) return { ok: false, err: "op" };
  var ctx = String(req.ctx || "").slice(0, AI_MAX_CTX), q = String(req.q || "").replace(/\s+/g, " ").trim().slice(0, AI_MAX_Q);
  if (ctx.length < 20) return { ok: false, err: "vide" };
  if (req.kind === "question" && q.length < 3) return { ok: false, err: "vide" };
  var left = aiCount_();
  if (left === false) return { ok: false, err: "quota_ia" };
  if (q) ctx += "\n\nQuestion de Nathan : " + q;
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
  return { ok: true, text: text.slice(0, 2000), model: model, left: left };
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

// À lancer UNE FOIS depuis l'éditeur (menu des fonctions → testIA → Exécuter) : Google demande alors l'autorisation
// « se connecter à un service externe » (Gemini), qu'un appel depuis le site ne peut pas déclencher. Le résultat s'affiche
// dans le journal d'exécution.
function testIA() {
  var r = ai_({ kind: "seance", ctx: "Sport : vélo. Durée : 1 h 30. Puissance : 182 W, normalisée 196 W. Cardio : 142 bpm. Dérive cardiaque 4,2 %. Surtout en zone 2." });
  Logger.log(JSON.stringify(r));
  return r;
}
