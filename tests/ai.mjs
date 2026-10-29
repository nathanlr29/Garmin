// Test du commentaire IA : node tests/ai.mjs
// 1) contrôle des chiffres côté site (bilan.js) ; 2) opération « ai » de apps-script/sync.gs avec un faux Google (Gemini simulé)
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// 1) aiCheck : un chiffre absent du bilan fait rejeter le commentaire ; les petits entiers et les milliers « 1 026 » passent
const win = { addEventListener() {} }, c1 = { window: win, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, nf: (v, d = 0) => (+v).toFixed(d), addEventListener() {} };
vm.createContext(c1); vm.runInContext(readFileSync(new URL("../bilan.js", import.meta.url), "utf8"), c1);
const check = win.Bilan._aiCheck, ctx = "Durée 2:15:30 · Puissance 182 W normalisée 196 W · Cardio 142 bpm · Dérive cardiaque 4,2 % · 1 026 m D+";
assert.equal(check("Belle séance : 196 W normalisés et une dérive de 4,2 %, 1026 m de dénivelé. Fais 3 séries la prochaine fois.", ctx).length, 0);
assert.equal(JSON.stringify(check("Tu as tenu 210 W et 5,1 % de dérive.", ctx)), JSON.stringify(["210", "5.1"]));

// 2) sync.gs, op « ai »
const calls = [], props = { SYNC_KEY: "0123456789abcdef0123" }, cache = {};
let gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "Séance solide." }] } }] } });
const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const c2 = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
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
assert.equal(post({ op: "ai", kind: "seance", ctx: "x" }).err, "vide");
let r = post({ op: "ai", kind: "seance", ctx: CTX });
assert.equal(r.ok, true); assert.equal(r.text, "Séance solide."); assert.equal(r.model, "gemini-3.5-flash-lite", "Flash-Lite stable le plus récent");
const g1 = calls.find(x => /generateContent/.test(x.url)), sent = JSON.parse(g1.o.payload);
assert.match(g1.url, /models\/gemini-3\.5-flash-lite:generateContent$/); assert.equal(g1.o.headers["x-goog-api-key"], "AIzaFAUSSE", "clé dans l'en-tête, pas dans l'URL");
assert.match(sent.systemInstruction.parts[0].text, /n'utilise que les chiffres fournis/); assert.equal(sent.contents[0].parts[0].text, CTX);
calls.length = 0; post({ op: "ai", kind: "seance", ctx: CTX }); assert.equal(calls.filter(x => /\/models\?/.test(x.url)).length, 0, "modèle gardé en cache");
gen = () => ({ code: 429, body: { error: { message: "quota" } } }); assert.equal(post({ op: "ai", kind: "seance", ctx: CTX }).err, "quota_ia");
gen = () => ({ code: 404, body: { error: { message: "model not found" } } }); r = post({ op: "ai", kind: "seance", ctx: CTX });
assert.equal(r.err, "ia"); assert.match(r.msg, /not found/); assert.equal(cache.gemini_model, undefined, "modèle retiré : recherché à nouveau");
props.GEMINI_MODEL = "gemini-perso"; gen = () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } });
calls.length = 0; assert.equal(post({ op: "ai", kind: "seance", ctx: CTX }).model, "gemini-perso", "GEMINI_MODEL impose le modèle");
assert.equal(post({ op: "ping" }).ok, true, "la synchro marche toujours");
// une exception Apps Script (autorisation « service externe » pas encore donnée) répond en JSON, pas en page d'erreur
const fetch0 = c2.UrlFetchApp.fetch; c2.UrlFetchApp.fetch = () => { throw new Error("You do not have permission to call UrlFetchApp.fetch"); };
r = post({ op: "ai", kind: "seance", ctx: CTX }); assert.equal(r.err, "ia"); assert.match(r.msg, /permission/);
c2.UrlFetchApp.fetch = fetch0; assert.equal(c2.testIA().ok, true, "testIA, à lancer depuis l'éditeur");
console.log("OK : commentaire IA (contrôle des chiffres, op ai de sync.gs : clés, usages, choix du modèle, quota, erreurs).");
