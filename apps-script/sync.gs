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
//     → { ok: true, text, model, left, v }   (left = demandes restantes aujourd'hui, plafond AI_DAY ; v = version des consignes, AI_V)
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
var AI_MAX_CTX = 20000, AI_MAX_Q = 600, AI_MAX_MSGS = 10;
var AI_DAY = 60;  // demandes par jour au plus (palier gratuit) ; jour du Pacifique, comme les quotas Google
var AI_V = 2;     // version des consignes, renvoyée au site (il signale un script plus ancien)
// Refonte du 13/11/2026 (demande de Nathan : commentaires incohérents, un footing du jour appelé « d'hier soir », la séance du lendemain
// recopiée du Plan). L'entraîneur COMPLÈTE Breizh Watts : l'outil calcule (charge, forme, récup, verdicts, Plan), l'IA relie ces données
// entre elles, explique et dit ce que ça change. Le site range le texte en blocs (SUJET, CE QUE BREIZH WATTS AFFICHE DÉJÀ, EN PLUS,
// DONNÉES DE NATHAN), date chaque ligne en clair (aujourd'hui, hier, il y a 3 j) et écrit les verdicts (« sous sa zone normale »).
var AI_WHO = "Tu es l'entraîneur de Nathan, cycliste sur route en Bretagne qui court aussi et fait de la musculation ; il veut monter sa FTP et sa VO2max "
  + "et préparer un ultra de 250 km. Il utilise Breizh Watts, son tableau de bord, qui calcule déjà tout : charge, forme, score de récup, zones, "
  + "verdict de chaque séance, Plan de la semaine. Ton rôle est de COMPLÉTER cet outil, jamais de le répéter : tu relies entre elles des données "
  + "qu'il montre séparément (une séance, la nuit d'avant, la charge des jours précédents, ce qui est prévu ensuite), tu expliques la cause la plus "
  + "probable de ce qui sort de l'ordinaire, et tu dis ce que ça change concrètement. Le message contient, dans l'ordre : le SUJET ; "
  + "CE QUE BREIZH WATTS AFFICHE DÉJÀ (Nathan l'a sous les yeux) ; parfois EN PLUS, des données que l'outil n'affiche pas à cet endroit ; "
  + "puis les DONNÉES DE NATHAN (profil, Plan, nuits, séances, semaines). ";
var AI_RULES = " Règles de cohérence, toutes obligatoires. "
  + "1) Dates : chaque ligne porte son repère (aujourd'hui, hier, avant-hier, il y a 3 j, demain). Reprends ces repères tels quels, ne recalcule jamais "
  + "un jour toi-même, et n'écris « hier », « ce matin », « ce soir » ou « demain » que si les données le disent. Le SUJET dit quand a eu lieu ce que tu commentes. "
  + "2) L'outil fait foi : ses chiffres, ses seuils et ses verdicts (« sous sa zone normale », « chargé », score de récup « moyen ») ne se recalculent pas "
  + "et ne se recopient pas. Ne cite un chiffre déjà affiché que pour appuyer une idée qui n'est pas affichée. Si une conclusion de l'outil ne colle pas "
  + "aux données, dis-le clairement et dis pourquoi : c'est exactement ce qu'on attend de toi. "
  + "3) Le Plan fait foi pour les jours à venir : ne redécris pas une séance déjà prévue (il en a le détail) et n'en invente pas une autre. Dis seulement "
  + "s'il faut la garder, l'alléger ou la déplacer, laquelle, quel jour et pourquoi. Ne détaille une séance (échauffement, blocs, récupérations) que s'il "
  + "la demande ou si tu proposes d'en remplacer une. "
  + "4) Reste dans le sport du sujet : une course à pied se lit en allure, cardio et cadence ; la « puissance Garmin » d'une course ne se compare jamais "
  + "à la FTP vélo. Respecte les contraintes écrites dans les données (reprise de la course après blessure : footings faciles, pas de fractionné). "
  + "5) Rien d'inventé ni de faux : avant d'écrire qu'une valeur dépasse ou reste sous une autre, vérifie les deux nombres ; préfère les comparaisons déjà "
  + "écrites dans les données. Toute mesure vient des données ; un calcul à partir d'elles est permis (watts depuis la FTP de travail, bpm depuis ses zones). "
  + "Ce qui n'est pas dans les données (repas, hydratation, alcool, stress au travail, météo de la séance, sensations) ne peut être qu'une hypothèse, "
  + "annoncée comme telle, deux au plus. "
  + "6) Pas de généralités ni de compliments (« écoute ton corps », « hydrate-toi bien », « belle séance », « tu es d'attaque ») : chaque phrase s'appuie "
  + "sur une donnée précise de Nathan. Avant d'écrire qu'il est en forme ou reposé, vérifie la VFC contre sa zone, le score de récup et la fraîcheur : "
  + "si l'un est mauvais, dis-le. "
  + "7) Pas de diagnostic médical ; si un signe peut annoncer une maladie ou une blessure, dis-le comme hypothèse et conseille de consulter si ça dure. "
  + "Forme : en français, tutoiement, ton direct d'entraîneur ; ni titre, ni salutation, ni astérisques, ni gras ; unités comme dans les données. "
  + "Sujets : entraînement, vélo, course, musculation, récupération, sommeil, alimentation du sportif ; pour tout autre sujet, dis seulement que tu ne traites que ceux-là.";
var AI_FMT = " Réponds en trois courts paragraphes séparés par une ligne vide. Chaque paragraphe commence par son intitulé suivi de deux-points, puis ne contient "
  + "que des faits et des chiffres de Nathan : ne recopie jamais le texte de ces consignes. Les trois paragraphes, dans l'ordre (intitulé → ce qu'il doit contenir) : ";
var AI_SESSION = "Quand tu détailles une séance, donne : échauffement, blocs (durée, watts et % de FTP, ou bpm, ou allure), récupérations, retour au calme, "
  + "durée totale, et une variante plus douce si sa récup est moyenne. ";
var AI_CHAT = "Réponds à sa question, et seulement à elle : la réponse en une phrase d'abord, puis les raisons tirées de ses données, puis ce qu'il fait concrètement. "
  + "S'il demande quoi faire aujourd'hui : pars de la séance prévue au Plan et de ce qu'il a déjà fait aujourd'hui, et dis s'il la garde, l'allège ou la "
  + "remplace selon sa récup, sa fraîcheur et les jours précédents. S'il demande si une sortie est raisonnable (par exemple 150 km aujourd'hui) : réponds "
  + "d'abord oui, non ou oui à condition, puis les conditions (intensité maxi en watts ou bpm, durée, alimentation) et ce que ça change pour les séances "
  + "prévues ensuite. " + AI_SESSION + "170 mots au plus, sauf s'il demande plus ; des tirets pour une liste si utile.";
var AI_SYS = {
  chat: AI_WHO + AI_CHAT + AI_RULES,
  question: AI_WHO + AI_CHAT + AI_RULES,
  seance: AI_WHO + "On te donne le bilan d'une séance déjà faite : dis ce que ce bilan ne dit pas." + AI_FMT
    + "intitulé « À retenir : » → le fait le plus utile que le bilan affiché ne dit pas. Pars des « Repères calculés » (moitiés de la séance, place parmi ses séances "
    + "comparables : normale pour lui, meilleure, moins bonne), précise avec le déroulé par tranches où et quand ça change. "
    + "intitulé « Explication : » → la cause la plus probable du point marquant, en confrontant la séance à ce qui l'entoure : dénivelé de chaque moitié, nuit d'avant, "
    + "séance plus tôt le même jour, charge des 3 jours d'avant, heure. Dis ce que les données écartent (par exemple la chaleur un jour frais) : si une cause "
    + "avancée par l'outil ne tient pas, écris-le. Une VFC basse ou une grosse charge la veille est un indice, pas une preuve : écris « probablement ». "
    + "intitulé « Pour la suite : » → d'abord la prochaine séance, celle que donne la ligne « Suite du Plan » avec son jour : la garder, l'alléger ou la déplacer (son nom "
    + "et son jour seulement, jamais ses watts, sa durée ni son contenu), en une phrase complète qui dit pourquoi. Ensuite, seulement si les Repères calculés donnent un "
    + "« repère pour le prochain footing » ou un autre repère pour la prochaine fois, reprends-le ici, une seule fois dans toute la réponse. "
    + "N'écris aucune cible chiffrée (allure, watts, bpm, cadence) qui n'est pas déjà écrite dans les données. "
    + "140 mots au plus." + AI_RULES,
  recup: AI_WHO + "On te donne le bilan de récupération d'un matin : le SUJET dit lequel (aujourd'hui ou un jour passé)." + AI_FMT
    + "intitulé « Lecture : » → ce que la nuit et les mesures disent ensemble, au-delà du score : ce qui se contredit (longue nuit et VFC basse…), ce qui s'écarte de sa normale. "
    + "intitulé « Causes : » → les causes probables classées, chacune appuyée sur une donnée d'AVANT cette nuit (la veille et sa dernière séance, la charge des 4 jours "
    + "d'avant, l'heure de coucher, la durée, la température de la nuit, le stress de la veille : pars des repères calculés) ; une séance faite après le "
    + "réveil ne peut jamais expliquer la nuit ; au plus deux hypothèses hors données (alcool, repas tardif, début d'infection), avec ce qui les confirmerait. "
    + "intitulé « Aujourd'hui : » → si le matin regardé est aujourd'hui : garder, alléger ou remplacer la séance prévue au Plan (nomme-la), compte tenu de ce qui est déjà fait "
    + "aujourd'hui, et l'heure de coucher à viser ce soir ; si c'est un jour passé, remplace cet intitulé par « À retenir : » et dis ce que ce matin-là apprend. "
    + "150 mots au plus." + AI_RULES,
  semaine: AI_WHO + "On te donne le bilan de sa semaine (le SUJET dit laquelle)." + AI_FMT
    + "intitulé « Bilan : » → volume et intensité réels contre le Plan (séances faites, non faites) et contre ses semaines précédentes (tableau des semaines), en deux phrases. "
    + "intitulé « Ce qui coince : » → le point le plus limitant, un seul, avec la donnée qui le montre (séance du Plan non faite, part de zone 3 au-dessus du repère, "
    + "nuits, récup, volume en baisse) : pars des repères calculés ; si rien ne coince, dis-le. "
    + "intitulé « La suite : » → deux ajustements concrets au plus pour les jours qui restent et la semaine qui vient, dits comme des changements à faire dans le Plan "
    + "(quel jour, quelle séance, quoi changer), et qui découlent du point qui coince : n'allège ni ne retire une séance que si une donnée montre de la fatigue "
    + "(récup basse, fraîcheur chargée, VFC sous sa zone plusieurs nuits) ; si le Plan prévu convient, dis-le et dis sur quelle séance mettre l'effort. 150 mots au plus." + AI_RULES,
  sortie: AI_WHO + "On te donne l'analyse d'une sortie à venir (vent, montées, nutrition, arrêts déjà calculés par l'outil)." + AI_FMT
    + "intitulé « Rythme : » → la stratégie par portion, en watts ou en bpm calculés depuis sa FTP de travail et ses zones : où appuyer, où s'économiser selon le vent et les montées affichés. "
    + "intitulé « Point clé : » → le moment de la sortie où ça peut mal tourner (vent de face tardif, montée après 3 h, ravito trop loin) et quoi faire à ce moment-là ; "
    + "ne recopie pas le plan nutrition ni la liste des arrêts. "
    + "intitulé « À adapter : » → ce que sa forme change (fraîcheur, dernière nuit, séances des 2 derniers jours) et ce que la sortie change pour la séance prévue ensuite au Plan. "
    + "150 mots au plus." + AI_RULES,
  objectifs: AI_WHO + "On te donne le point sur ses objectifs (projections déjà calculées par l'outil)." + AI_FMT
    + "intitulé « Rythme : » → si la projection de l'outil est crédible au vu de ses semaines récentes (volume, intensité, régularité du tableau des semaines). "
    + "intitulé « Frein principal : » → un seul, le plus limitant (volume, intensité, régularité, récupération), démontré par le tableau des semaines ou les nuits. "
    + "intitulé « Plan d'action : » → deux ou trois actions pour les 4 semaines qui viennent, à reporter dans son Plan (nombre de séances clés, volume par semaine, test), chiffrées. "
    + "160 mots au plus." + AI_RULES
};
// Flash pour la conversation et la question seulement, et seulement si la propriété GEMINI_MODEL_FLASH le nomme : le 30/10/2026 il ne
// répondait pas, et le 14/11/2026 tous les Flash de la clé répondaient 503 (saturés). Les encarts passent par Flash-Lite : leurs consignes
// et les repères calculés du site ont été mis au point sur lui (essais réels du 14/11/2026).
var AI_TIER = { chat: "flash", question: "flash" };

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
  var body = { systemInstruction: { parts: [{ text: sys }] }, contents: contents, generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } };
  var tiers = AI_TIER[req.kind] === "flash" && props.getProperty("GEMINI_MODEL_FLASH") ? ["flash", "lite"] : ["lite"], r = null, text = "", c = null;
  // 2 essais au plus : une réponse qui recopie les consignes au lieu de répondre (vu avec Flash-Lite le 14/11/2026) est redemandée une fois
  for (var n = 0; n < 2; n++) {
    for (var i = 0; i < tiers.length; i++) {
      try { r = gemini_(key, props, tiers[i], body); }
      catch (e) { if (i === tiers.length - 1) throw e; r = { code: 0 }; continue; }  // Flash trop lent (délai de 60 s d'UrlFetch) : Flash-Lite
      if (!(r.code === 429 || r.code === 404 || r.code >= 500) || i === tiers.length - 1) break;  // Flash saturé, retiré ou en panne : Flash-Lite
    }
    if (r.code === 429) return { ok: false, err: "quota_ia" };
    if (r.code !== 200) return { ok: false, err: "ia", msg: String((r.j.error && r.j.error.message) || ("Gemini " + r.code)).slice(0, 200) };
    c = r.j.candidates && r.j.candidates[0]; var parts = c && c.content && c.content.parts || [];
    text = parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ""; }).join("").trim();
    if (!text || !echo_(text, sys)) break;
    body.generationConfig.temperature = 0.6;
  }
  if (!text) return { ok: false, err: "ia", msg: "réponse vide" + (c && c.finishReason ? " (" + c.finishReason + ")" : "") };
  if (echo_(text, sys)) return { ok: false, err: "ia", msg: "réponse inutilisable (le modèle a recopié ses consignes) : redemande" };
  return { ok: true, text: text.slice(0, 4000), model: r.model, left: left, v: AI_V };
}
// vrai si la réponse reprend mot pour mot un passage des consignes (45 caractères de suite)
function echo_(text, sys) {
  var t = String(text).replace(/\s+/g, " "), s = String(sys).replace(/\s+/g, " ");
  for (var i = 0; i + 45 <= t.length; i += 15) if (s.indexOf(t.substr(i, 45)) >= 0) return true;
  return false;
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
  var model = model_(key, props, tier), tc = tier === "flash" ? think_(model) : null, res, code, j;  // Flash-Lite : réglage par défaut (celui qui marchait)
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

// Diagnostic pas à pas (menu des fonctions → testEtapes → Exécuter) : chaque étape s'affiche dans le journal avec sa durée ;
// la dernière ligne affichée montre où ça bloque.
function testEtapes() {
  var t0 = Date.now(), log = function (m) { console.log(((Date.now() - t0) / 1000).toFixed(1) + " s · " + m); };
  var props = PropertiesService.getScriptProperties(), key = props.getProperty("GEMINI_KEY");
  log("1. clé Gemini : " + (key ? "présente" : "ABSENTE"));
  if (!key) return;
  log("2. compteur du jour : " + props.getProperty("AI_COUNT"));
  var lock = LockService.getScriptLock(); lock.waitLock(5000); lock.releaseLock(); log("3. verrou : ok");
  log("4. modèle en cache : " + CacheService.getScriptCache().get("gemini_model_lite"));
  var m = model_(key, props, "lite"); log("5. modèle choisi : " + m);
  var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(m) + ":generateContent", {
    method: "post", contentType: "application/json", headers: { "x-goog-api-key": key }, muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Réponds juste : bonjour." }] }], generationConfig: { maxOutputTokens: 50 } }) });
  log("6. Gemini répond " + r.getResponseCode() + " : " + r.getContentText().slice(0, 300));
  var c = ai_({ kind: "chat", ctx: "Profil : FTP de travail 230 W. Nuit : 9 h 40, VFC 36 ms (zone normale 45-60).", msgs: [{ r: "u", t: "Quelle séance je fais aujourd'hui ?" }] });
  log("7. conversation : " + JSON.stringify(c).slice(0, 400));
}
