// Test de l'entraîneur IA : node tests/ai.mjs
// 1) opération « ai » de apps-script/sync.gs avec un faux Google (Gemini simulé) ; 2) données envoyées par ia.js (IA.data)
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// 1) sync.gs, op « ai »
const calls = [], props = { SYNC_KEY: "0123456789abcdef0123" }, cache = {};
let gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "Séance solide." }] } }] } });
const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const c2 = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  Utilities: { formatDate: () => "2026-10-30" },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  UrlFetchApp: { fetch: (url, o = {}) => { calls.push({ url, o });
    if (/\/models\?/.test(url)) return res(200, { models: [
      { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.6-flash-lite-preview", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] }] });
    const g = gen(); return res(g.code, g.body); } },
  ContentService: { createTextOutput: t => ({ setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: 1 } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, SpreadsheetApp: {}, Logger: { log() {} },
};
vm.createContext(c2); vm.runInContext(readFileSync(new URL("../apps-script/sync.gs", import.meta.url), "utf8"), c2);
const post = b => c2.doPost({ postData: { contents: JSON.stringify({ k: props.SYNC_KEY, ...b }) } });
const CTX = "Sport : vélo. Durée 1:30:00 · 182 W · cardio 142 bpm.";
assert.equal(post({ op: "ai", kind: "seance", ctx: CTX }).err, "config_ia", "sans GEMINI_KEY");
props.GEMINI_KEY = "AIzaFAUSSE";
assert.equal(c2.doPost({ postData: { contents: JSON.stringify({ k: "mauvaise-cle-xxxxxx", op: "ai", kind: "seance", ctx: CTX }) } }).err, "cle", "clé de synchro exigée");
assert.equal(post({ op: "ai", kind: "poeme", ctx: CTX }).err, "op", "seulement les usages prévus (pas de prompt libre)");
assert.equal(post({ op: "ai", kind: "question", ctx: CTX }).err, "vide", "question vide refusée");
assert.equal(post({ op: "ai", kind: "seance", ctx: "x" }).err, "vide");
let r = post({ op: "ai", kind: "seance", ctx: CTX });
assert.equal(r.ok, true); assert.equal(r.text, "Séance solide."); assert.equal(r.model, "gemini-3.5-flash-lite", "Flash-Lite stable le plus récent (pas la préversion)");
const g1 = calls.find(x => /generateContent/.test(x.url)), sent = JSON.parse(g1.o.payload);
assert.match(g1.url, /models\/gemini-3\.5-flash-lite:generateContent$/); assert.equal(g1.o.headers["x-goog-api-key"], "AIzaFAUSSE", "clé dans l'en-tête, pas dans l'URL");
assert.match(sent.systemInstruction.parts[0].text, /n'en invente aucune/); assert.match(sent.systemInstruction.parts[0].text, /échauffement/); assert.equal(sent.contents[0].parts[0].text, CTX);
calls.length = 0; post({ op: "ai", kind: "seance", ctx: CTX }); assert.equal(calls.filter(x => /\/models\?/.test(x.url)).length, 0, "modèle gardé en cache");
gen = () => ({ code: 429, body: { error: { message: "quota" } } }); assert.equal(post({ op: "ai", kind: "seance", ctx: CTX }).err, "quota_ia");
gen = () => ({ code: 404, body: { error: { message: "model not found" } } }); r = post({ op: "ai", kind: "seance", ctx: CTX });
assert.equal(r.err, "ia"); assert.match(r.msg, /not found/); assert.equal(cache.gemini_model_lite, undefined, "modèle retiré : recherché à nouveau");
props.GEMINI_MODEL = "gemini-perso"; gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } });
calls.length = 0; assert.equal(post({ op: "ai", kind: "seance", ctx: CTX }).model, "gemini-perso", "GEMINI_MODEL impose le modèle");
assert.equal(post({ op: "ping" }).ok, true, "la synchro marche toujours");
// une exception Apps Script (autorisation « service externe » pas encore donnée) répond en JSON, pas en page d'erreur
const fetch0 = c2.UrlFetchApp.fetch; c2.UrlFetchApp.fetch = () => { throw new Error("You do not have permission to call UrlFetchApp.fetch"); };
r = post({ op: "ai", kind: "seance", ctx: CTX }); assert.equal(r.err, "ia"); assert.match(r.msg, /permission/);
c2.UrlFetchApp.fetch = fetch0; assert.equal(c2.testIA().ok, true, "testIA, à lancer depuis l'éditeur");
// usages de l'encart IA : consigne propre à chaque usage, question ajoutée au contexte (300 caractères au plus), plafond du jour
calls.length = 0; delete props.GEMINI_MODEL; props.AI_COUNT = JSON.stringify({ d: "2026-10-30", n: 0 });
for (const kind of ["question", "semaine", "recup", "sortie", "objectifs"]) {
  r = post({ op: "ai", kind, ctx: CTX, q: kind === "question" ? "Suis-je prêt pour 250 km ?" + " x".repeat(400) : undefined }); assert.equal(r.ok, true, kind);
  const body = JSON.parse(calls.filter(x => /generateContent/.test(x.url)).pop().o.payload);
  assert.match(body.systemInstruction.parts[0].text, /n'en invente aucune/, kind);
  if (kind === "question") { assert.match(body.contents[0].parts[0].text, /Question de Nathan : Suis-je prêt pour 250 km \?/); assert.ok(body.contents[0].parts[0].text.length < CTX.length + 640, "question tronquée"); assert.match(body.systemInstruction.parts[0].text, /ne traites que ceux-là/);
    assert.match(calls.filter(x => /generateContent/.test(x.url)).pop().url, /gemini-3\.8-flash:/, "question : modèle Flash"); }
  if (kind === "recup") assert.match(body.systemInstruction.parts[0].text, /Classe les causes/);
}
assert.equal(r.left, 55, "5 demandes faites sur 60");
props.AI_COUNT = JSON.stringify({ d: "2026-10-30", n: 60 }); assert.equal(post({ op: "ai", kind: "recup", ctx: CTX }).err, "quota_ia", "plafond du jour");
props.AI_COUNT = JSON.stringify({ d: "2026-10-29", n: 60 }); assert.equal(post({ op: "ai", kind: "recup", ctx: CTX }).ok, true, "nouveau jour : compteur remis à zéro");

// conversation : messages alternés, données dans le premier message de Nathan, Flash puis Flash-Lite si Flash est saturé
calls.length = 0; props.AI_COUNT = "{}";
const msgs = [{ r: "m", t: "bonjour" }, { r: "u", t: "Quelle séance ce soir ?" }, { r: "m", t: "Sweet spot 3 × 10 min à 200 W." }, { r: "u", t: "Et 150 km demain ?" }];
r = post({ op: "ai", kind: "chat", ctx: CTX, msgs }); assert.equal(r.ok, true);
let body = JSON.parse(calls.filter(x => /generateContent/.test(x.url)).pop().o.payload);
assert.deepEqual(body.contents.map(c => c.role), ["user", "model", "user"], "commence par Nathan, alterné");
assert.match(body.contents[0].parts[0].text, /^Contexte \(données de Nathan\) :\nSport : vélo[\s\S]*Quelle séance ce soir \?$/);
assert.match(body.systemInstruction.parts[0].text, /150 km/);
assert.equal(post({ op: "ai", kind: "chat", ctx: CTX, msgs: msgs.slice(0, 3) }).err, "vide", "le dernier message doit être de Nathan");
let n = 0; gen = () => (++n === 1 ? { code: 429, body: { error: { message: "quota" } } } : { code: 200, body: { candidates: [{ content: { parts: [{ text: "pensée", thought: true }, { text: "Oui, à condition…" }] } }] } });
calls.length = 0; r = post({ op: "ai", kind: "chat", ctx: CTX, msgs });
assert.equal(r.text, "Oui, à condition…", "pensées retirées"); assert.equal(r.model, "gemini-3.5-flash-lite", "repli sur Flash-Lite");
assert.equal(calls.filter(x => /generateContent/.test(x.url)).length, 2);

// réflexion limitée (Gemini 3 et plus), redemandée sans si le modèle la refuse ; Flash qui plante (délai) → Flash-Lite
calls.length = 0; gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }); post({ op: "ai", kind: "chat", ctx: CTX, msgs });
assert.deepEqual(JSON.parse(calls.filter(x => /generateContent/.test(x.url)).pop().o.payload).generationConfig.thinkingConfig, { thinkingLevel: "low" });
n = 0; gen = () => (++n === 1 ? { code: 400, body: { error: { message: "thinking_level is not supported" } } } : { code: 200, body: { candidates: [{ content: { parts: [{ text: "ok2" }] } }] } });
calls.length = 0; r = post({ op: "ai", kind: "chat", ctx: CTX, msgs }); assert.equal(r.text, "ok2");
const G = calls.filter(x => /generateContent/.test(x.url)); assert.equal(G.length, 2); assert.equal(JSON.parse(G[1].o.payload).generationConfig.thinkingConfig, undefined, "redemandé sans réglage");
const f1 = c2.UrlFetchApp.fetch; c2.UrlFetchApp.fetch = (url, o) => { if (/3\.8-flash:/.test(url)) throw new Error("Timeout: 60 s"); return f1(url, o); };
gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "lite" }] } }] } });
r = post({ op: "ai", kind: "chat", ctx: CTX, msgs }); assert.equal(r.text, "lite"); assert.equal(r.model, "gemini-3.5-flash-lite", "Flash trop lent : Flash-Lite");
c2.UrlFetchApp.fetch = f1; assert.equal(c2.testChat().ok, true, "testChat, diagnostic depuis l'éditeur");

// 2) ia.js : données envoyées (sans nom de sortie), page puis données, coupées à 13 000 caractères
const ls = { bwWeight: "74", bwAge: "31" }, day = (d, o) => ({ d, bed: d + "T22:40", wake: d + "T08:30", sl: 35000, deep: 4000, light: 23000, rem: 7000, awake: 600, score: 85, hrv: 38, hrvLo: 45, hrvUp: 60, hrv7: 47, rhr: 46, rx: 11.5, ...o });
const now = new Date(2026, 9, 30, 9, 0);
const c3 = { window: {}, document: { readyState: "complete", querySelector: () => null, getElementById: () => null }, localStorage: { getItem: k => ls[k] ?? null, setItem() {} },
  S: { all: [{ id: 1, n: "Tour de Saint-Malo", t: "Ride", tk: "road_biking", d: "2026-10-29T15:37:21", dt: new Date(2026, 9, 29, 15, 37), m: 30465, km: 30.5, mt: 3956, el: 278, hr: 143, w: 0, np: 0, te: 3.2, hz: [58, 1150, 2031, 718, 0] }] } };
c3.window.Charge = { ymd: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, fitness: () => ({ ctl: 67.2, atl: 80.4, tsb: -13.2 }), tssOf: () => 64 };
c3.window.Plan = { ftp: () => 230, _cfg: () => ({ goal: { ftp: 300, vo2: 65, date: "2026-12-31" } }), plannedFor: d => d === "2026-10-30" ? { label: "Seuil", w: { title: "Seuil #2", goal: "3 × 8 min à 95 %" }, dur: 75, place: "mw" } : null };
c3.window.Recup = { data: { profile: { ftp: 262, vo2: [["2026-10-01", 58]], hrZones: { floors: [100, 119, 139, 159, 179], max: 199, lthr: 168, rest: 45 } } }, days: [day("2026-10-29", {}), day("2026-10-30", { hrv: 36 })], recoScore: () => ({ score: 52 }) };
Object.assign(c3, { Charge: c3.window.Charge, Recup: c3.window.Recup, Plan: c3.window.Plan });
vm.createContext(c3); vm.runInContext(readFileSync(new URL("../ia.js", import.meta.url), "utf8"), c3);
const D = c3.window.IA.data(now);
for (const re of [/FTP de travail 230 W/, /Garmin 262 W/, /74 kg/, /Z2 119-138/, /VO2max 58/, /niveau d'entraînement 67/, /fraîcheur −?-?13/,
  /2026-10-30 \| 22:40 → 08:30 \| 9 h 43/, /36 ms \(45-60, 7 nuits 47\)/, /11,5 \/min/, /\| 52$/m, /2026-10-29 15:37 \| road_biking \| 1 h 06 \| 30,5 km \| 278 m/, /\| 3,2 \| 1 % 29 % 51 % 18 % 0 %/,
  /aujourd'hui : Seuil #2 75 min home trainer : 3 × 8 min à 95 %/, /ultra de 250 km/])
  assert.match(D, re);
assert.ok(!/Saint-Malo/.test(D), "jamais le nom de la sortie");
assert.ok(D.indexOf("2026-10-30 |") < D.indexOf("2026-10-29 |"), "la nuit la plus récente d'abord");
const F = c3.window.IA.full("x".repeat(20000)); assert.equal(F.length, 13000); assert.match(F, /^Ce qu'affiche la page ouverte/);
assert.match(c3.window.IA.full("Bilan."), /^Ce qu'affiche la page ouverte :\nBilan\.\n\nTes données :\nMaintenant/);
console.log("OK : entraîneur IA (op ai de sync.gs : clés, usages, conversation, Flash puis Flash-Lite, quota, erreurs ; données envoyées par ia.js).");
