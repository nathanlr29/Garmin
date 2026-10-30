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
//   { k: "<clé>", op: "ai", kind: "seance|question|semaine|recup|sortie|objectifs", ctx: "<données en texte>", q?: "<question>" }
//   { k: "<clé>", op: "ai", kind: "chat", ctx: "<données>", msgs: [{ r: "u"|"m", t }, …] }   (conversation, dernier message de Nathan en dernier)
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
var AI_MAX_CTX = 14000, AI_MAX_Q = 600, AI_MAX_MSGS = 10;
var AI_DAY = 60;  // demandes par jour au plus (palier gratuit) ; jour du Pacifique, comme les quotas Google
// Demande de Nathan du 30/10/2026 : un vrai assistant, pas une paraphrase de la page. Il reçoit les données brutes (profil, forme,
// nuits, séances, Plan) et doit analyser, expliquer les causes et proposer des séances précises.
var AI_WHO = "Tu es l'entraîneur personnel et l'assistant de Nathan, cycliste sur route en Bretagne (il court aussi et fait de la musculation), "
  + "qui veut augmenter sa FTP et sa VO2max et préparer un ultra de 250 km. Tu reçois ses données (profil et zones, forme, nuits récentes, "
  + "séances des derniers jours, Plan des prochains jours) et ce qu'affiche la page qu'il regarde. ";
var AI_RULES = " Règles : appuie-toi sur ses données ; une mesure (VFC, sommeil, watts réalisés…) doit venir des données, n'en invente aucune, "
  + "mais calcule à partir d'elles (watts depuis la FTP de travail, bpm depuis ses zones, durées) et propose des séances précises. "
  + "Ne répète pas les phrases déjà affichées : analyse, explique les causes, tranche et propose. Sépare ce qui est sûr de ce qui est une hypothèse. "
  + "Pas de diagnostic médical : si un signe peut annoncer une maladie, dis-le comme hypothèse et conseille de consulter si ça dure. "
  + "En français, en le tutoyant, ton direct d'entraîneur, sans formule de politesse ni titre ; des tirets pour une liste si utile ; 170 mots au plus sauf s'il demande plus. "
  + "Sujets : entraînement, vélo, course, musculation, récupération, sommeil, alimentation du sportif ; pour tout autre sujet, dis seulement que tu ne traites que ceux-là.";
var AI_SESSION = "Quand tu proposes une séance, donne : échauffement, blocs (durée, watts et % de FTP ou bpm), récupérations, retour au calme, durée totale, "
  + "et une variante plus douce si sa récup est moyenne.";
var AI_CHAT = "Réponds à ses messages comme son entraîneur. S'il demande quoi faire, propose la séance du jour adaptée à sa récup, sa fatigue et son Plan. "
  + "S'il demande si une sortie est raisonnable (par exemple 150 km aujourd'hui), réponds d'abord oui, non ou oui à condition, explique avec ses données "
  + "(nuit, VFC, fatigue, séances récentes, ce qui est prévu ensuite), puis donne les conditions : intensité maxi en watts ou bpm, durée, alimentation, "
  + "et ce que ça change pour les jours suivants. " + AI_SESSION;
var AI_SYS = {
  chat: AI_WHO + AI_CHAT + AI_RULES,
  question: AI_WHO + AI_CHAT + AI_RULES,
  seance: AI_WHO + "On te donne le bilan d'une séance. Analyse ce qu'elle a vraiment travaillé, si elle colle au prévu et à son état du jour (nuit, fatigue), "
    + "pourquoi elle a été dure ou facile, puis la séance précise à faire la prochaine fois. " + AI_SESSION + AI_RULES,
  recup: AI_WHO + "Explique pourquoi sa récupération est ce qu'elle est ce jour-là : confronte la nuit (durée, phases, heure de coucher, réveils) à sa VFC "
    + "et à son cœur au repos comparés à sa normale, à la charge et à l'intensité des 3 ou 4 jours précédents, au stress et à la température. "
    + "Classe les causes les plus probables (par exemple une longue nuit avec une VFC basse : fatigue des grosses séances des jours d'avant, début d'infection, "
    + "alcool ou repas tardif, chaleur), dis ce qui confirmerait chacune, puis ce qu'il doit faire aujourd'hui (séance précise ou repos). " + AI_SESSION + AI_RULES,
  semaine: AI_WHO + "Fais le bilan de sa semaine : volume et intensité réels contre le Plan, effet sur sa récup, ce qui a marché, ce qui coince, "
    + "et 2 ou 3 ajustements concrets pour la semaine qui vient." + AI_RULES,
  sortie: AI_WHO + "On te donne l'analyse d'une sortie à venir. Fais le briefing : stratégie de rythme (watts ou cardio par portion, où appuyer, "
    + "où s'économiser selon le vent et les montées), ravitaillement et hydratation minutés, tenue, et ce qu'il faut adapter à sa forme du jour." + AI_RULES,
  objectifs: AI_WHO + "Fais le point sur ses objectifs : vitesse de progression réelle, ce qui freine (volume, intensité, récup, régularité), "
    + "et un plan d'action concret pour les semaines qui viennent (séances clés, volume) qu'il pourra reporter dans son Plan." + AI_RULES
};
var AI_TIER = { chat: "flash", question: "flash" };  // conversation : le modèle Flash (meilleur), repli sur Flash-Lite si son quota est atteint

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
  // conversation : messages alternés, le premier de Nathan reçoit les données
  var contents;
  if (req.kind === "chat") {
    var M = (Array.isArray(req.msgs) ? req.msgs : []).slice(-AI_MAX_MSGS).filter(function (m) { return m && typeof m.t === "string" && m.t.trim(); })
      .map(function (m) { return { role: m.r === "m" ? "model" : "user", parts: [{ text: m.t.slice(0, AI_MAX_Q * 3) }] }; });
    while (M.length && M[0].role !== "user") M.shift();
    if (!M.length || M[M.length - 1].role !== "user") return { ok: false, err: "vide" };
    M[0].parts[0].text = "Contexte (données de Nathan) :\n" + ctx + "\n\n" + M[0].parts[0].text;
    contents = M;
  } else {
    if (req.kind === "question" && q.length < 3) return { ok: false, err: "vide" };
    contents = [{ role: "user", parts: [{ text: ctx + (q ? "\n\nQuestion de Nathan : " + q : "") }] }];
  }
  var left = aiCount_();
  if (left === false) return { ok: false, err: "quota_ia" };
  var body = { systemInstruction: { parts: [{ text: sys }] }, contents: contents, generationConfig: { temperature: 0.5, maxOutputTokens: 4096 } };
  var tiers = AI_TIER[req.kind] === "flash" ? ["flash", "lite"] : ["lite"], r = null;
  for (var i = 0; i < tiers.length; i++) {
    try { r = gemini_(key, props, tiers[i], body); }
    catch (e) { if (i === tiers.length - 1) throw e; r = { code: 0 }; continue; }  // Flash trop lent (délai de 60 s d'UrlFetch) : Flash-Lite
    if (!(r.code === 429 || r.code === 404 || r.code >= 500) || i === tiers.length - 1) break;  // Flash saturé, retiré ou en panne : Flash-Lite
  }
  if (r.code === 429) return { ok: false, err: "quota_ia" };
  if (r.code !== 200) return { ok: false, err: "ia", msg: String((r.j.error && r.j.error.message) || ("Gemini " + r.code)).slice(0, 200) };
  var c = r.j.candidates && r.j.candidates[0], parts = c && c.content && c.content.parts || [];
  var text = parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ""; }).join("").trim();
  if (!text) return { ok: false, err: "ia", msg: "réponse vide" + (c && c.finishReason ? " (" + c.finishReason + ")" : "") };
  return { ok: true, text: text.slice(0, 4000), model: r.model, left: left };
}
// réflexion limitée : sans cela, un Flash récent peut « penser » plus d'une minute avant de répondre (Gemini 3 et plus : thinkingLevel,
// Gemini 2.5 : thinkingBudget) ; si le modèle refuse ce réglage (400), on redemande sans.
function think_(model) {
  var v = parseFloat(String(model).replace(/^gemini-/, ""));
  if (v >= 3) return { thinkingLevel: "low" };
  if (v >= 2.5) return { thinkingBudget: 512 };
  return null;
}
function gemini_(key, props, tier, body) {
  var model = model_(key, props, tier), tc = think_(model), res, code, j;
  for (var k = 0; k < 2; k++) {
    var b = JSON.parse(JSON.stringify(body));
    if (tc && k === 0) b.generationConfig.thinkingConfig = tc;
    res = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "post", contentType: "application/json", headers: { "x-goog-api-key": key }, payload: JSON.stringify(b), muteHttpExceptions: true });
    code = res.getResponseCode(); j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) {}
    if (!(code === 400 && tc && k === 0 && /think/i.test(JSON.stringify(j)))) break;
  }
  if (code === 404) CacheService.getScriptCache().remove("gemini_model_" + tier);  // modèle retiré : on en recherchera un autre
  return { code: code, j: j, model: model };
}

// le Gemini stable le plus récent du niveau demandé (« lite » = Flash-Lite, « flash » = Flash), d'après la liste des modèles de la clé,
// gardé 6 h ; repli sur les alias « latest ». GEMINI_MODEL impose le modèle de Flash-Lite, GEMINI_MODEL_FLASH celui de Flash.
function model_(key, props, tier) {
  tier = tier || "lite";
  var fixed = props.getProperty(tier === "flash" ? "GEMINI_MODEL_FLASH" : "GEMINI_MODEL");
  if (fixed) return fixed;
  var cache = CacheService.getScriptCache(), ck = "gemini_model_" + tier, m = cache.get(ck);
  if (m) return m;
  var re = tier === "flash" ? /^models\/gemini-\d+(\.\d+)?-flash$/ : /^models\/gemini-\d+(\.\d+)?-flash-lite$/;
  try {
    var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, muteHttpExceptions: true });
    var L = (JSON.parse(r.getContentText()).models || []).filter(function (x) {
      return (x.supportedGenerationMethods || []).indexOf("generateContent") >= 0 && re.test(x.name);
    }).map(function (x) { return { n: x.name.replace("models/", ""), v: parseFloat(x.name.replace(/^models\/gemini-/, "")) }; });
    L.sort(function (a, b) { return b.v - a.v; });
    if (L.length) m = L[0].n;
  } catch (e) {}
  m = m || (tier === "flash" ? "gemini-flash-latest" : "gemini-flash-lite-latest");
  cache.put(ck, m, 21600);
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

// Diagnostic de la conversation (menu des fonctions → testChat → Exécuter) : durée, modèle et début de la réponse dans le journal.
function testChat() {
  var t0 = Date.now();
  var r = ai_({ kind: "chat", ctx: "Maintenant : test. Profil : FTP de travail 230 W, FC max 199. Nuit : 9 h 40 de sommeil, VFC 36 ms (zone normale 45-60). Hier : sortie de 3 h, charge 180.",
    msgs: [{ r: "u", t: "Quelle séance je fais aujourd'hui ?" }] });
  Logger.log((Date.now() - t0) / 1000 + " s · " + JSON.stringify(r).slice(0, 600));
  return r;
}
