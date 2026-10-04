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
// Réponse : { ok: true, items: [...] } ou { ok: false, err: "..." }.

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
