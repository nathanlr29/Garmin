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
const SYS = sent.systemInstruction.parts[0].text;
assert.match(SYS, /COMPLÉTER cet outil, jamais de le répéter/); assert.match(SYS, /Rien d'inventé/); assert.equal(sent.contents[0].parts[0].text, CTX);
// consignes du bilan de séance (refonte du 13/11/2026) : trois intitulés, dates reprises telles quelles, le Plan n'est pas recopié
for (const re of [/« À retenir : »/, /« Explication : »/, /« Pour la suite : »/, /ne recalcule jamais un jour/, /ne redécris pas une séance déjà prévue/, /ne se compare jamais à la FTP vélo/, /corrige-la/])
  assert.match(SYS, re);
assert.ok(!/Quand tu détailles une séance, donne/.test(SYS), "bilan de séance : pas de séance détaillée d'office");
assert.equal(r.v, 2, "version des consignes renvoyée au site"); assert.equal(sent.generationConfig.temperature, 0.3);
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
calls.length = 0; delete props.GEMINI_MODEL; props.GEMINI_MODEL_FLASH = "gemini-3.8-flash"; props.AI_COUNT = JSON.stringify({ d: "2026-10-30", n: 0 });
for (const kind of ["question", "semaine", "recup", "sortie", "objectifs"]) {
  r = post({ op: "ai", kind, ctx: CTX, q: kind === "question" ? "Suis-je prêt pour 250 km ?" + " x".repeat(400) : undefined }); assert.equal(r.ok, true, kind);
  const body = JSON.parse(calls.filter(x => /generateContent/.test(x.url)).pop().o.payload);
  assert.match(body.systemInstruction.parts[0].text, /Rien d'inventé/, kind); if (kind !== "question") assert.match(body.systemInstruction.parts[0].text, /trois courts paragraphes/, kind);
  if (kind === "question") { assert.match(body.contents[0].parts[0].text, /Question de Nathan : Suis-je prêt pour 250 km \?/); assert.ok(body.contents[0].parts[0].text.length < CTX.length + 640, "question tronquée"); assert.match(body.systemInstruction.parts[0].text, /ne traites que ceux-là/);
    assert.match(calls.filter(x => /generateContent/.test(x.url)).pop().url, /gemini-3\.8-flash:/, "question : modèle Flash"); }
  if (kind === "recup") assert.match(body.systemInstruction.parts[0].text, /« Causes : » les causes probables classées/);
  if (kind !== "question") assert.match(calls.filter(x => /generateContent/.test(x.url)).pop().url, /gemini-3\.8-flash:/, kind + " : Flash quand GEMINI_MODEL_FLASH le nomme");
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
assert.match(body.systemInstruction.parts[0].text, /150 km/); assert.match(body.systemInstruction.parts[0].text, /Quand tu détailles une séance, donne/); assert.ok(!/trois courts paragraphes/.test(body.systemInstruction.parts[0].text), "conversation : pas de plan imposé");
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

// sans GEMINI_MODEL_FLASH, la conversation reste sur Flash-Lite (Flash ne répondait pas)
delete props.GEMINI_MODEL_FLASH; calls.length = 0; r = post({ op: "ai", kind: "chat", ctx: CTX, msgs });
assert.equal(r.model, "gemini-3.5-flash-lite"); assert.equal(calls.filter(x => /flash:generate/.test(x.url)).length, 0);

// 2) ia.js : texte envoyé (blocs, repères de date, verdicts écrits, jamais le nom d'une sortie)
const ls = { bwWeight: "74", bwAge: "31", muscuLbl: JSON.stringify({ 7: "legs" }) };
const day = (d, o) => ({ d, bed: d + "T22:40", wake: d + "T08:30", sl: 35000, deep: 4000, light: 23000, rem: 7000, awake: 600, score: 85, hrv: 38, hrvLo: 45, hrvUp: 60, hrv7: 47, rhr: 46, rx: 11.5, ...o });
const now = new Date(2026, 9, 30, 19, 45), at = (d, h, m = 0) => new Date(2026, 9, d, h, m);
const run = (id, d, h, o) => ({ id, n: "Footing de Cesson", t: "running", tk: "running", dt: at(d, h), m: 7000, km: 7, mt: 2400, et: 2420, el: 40, hr: 140, w: 330, np: 335, te: 2.5, hz: [200, 1700, 500, 0, 0], ...o });
const A = [
  { id: 1, n: "Tour de Saint-Malo", t: "Ride", tk: "road_biking", dt: at(29, 15, 37), m: 30465, km: 30.5, mt: 3956, el: 278, hr: 143, w: 0, np: 0, te: 3.2, hz: [58, 1150, 2031, 718, 0] },
  { id: 2, n: "MyWhoosh", t: "VirtualRide", tk: "virtual_ride", tr: 1, dt: at(28, 18, 30), m: 30000, km: 30, mt: 3600, el: 50, hr: 150, w: 190, np: 207, te: 3.4, hz: [0, 1000, 1600, 1000, 0] },
  { id: 7, n: "Musculation", t: "strength_training", tk: "strength_training", dt: at(30, 6, 25), m: 0, mt: 500, et: 2700, hr: 70 },
  run(3, 30, 18, { m: 7700, km: 7.7, mt: 2553, et: 2581, el: 72, hr: 138 }), run(4, 28, 7), run(5, 23, 13, { hr: 143, m: 7300 }), run(6, 23, 8, { mt: 600, m: 1500 }),   // 6 : trop courte pour être comparable
];
const c3 = { window: {}, document: { readyState: "complete", querySelector: () => null, getElementById: () => null }, localStorage: { getItem: k => ls[k] ?? null, setItem() {} }, S: { all: A } };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
c3.window.Charge = { ymd, sportOf: a => /Ride/.test(a.t) ? "bike" : /run/.test(a.t) ? "run" : a.t === "strength_training" ? "strength" : "other",
  fitness: d => d && d < at(30, 0) ? { ctl: 66, atl: 85, tsb: -19 } : { ctl: 67.2, atl: 80.4, tsb: -13.2 }, tssOf: a => a.t === "strength_training" ? 4 : a.t === "running" ? 45 : 64 };
const goalTxt = "3 × 8 min à 95 % de ta FTP, 4 min souples entre deux. Effort 7/10 : tu dois finir le dernier bloc. Séance faite : dis si elle est réussie.";
c3.window.Plan = { ftp: () => 230, _cfg: () => ({ goal: { ftp: 300, vo2: 65, date: "2026-12-31" } }),
  muscuOn: d => d === "2026-10-31" ? { s: "pull", label: "Pull", st: "plan" } : null,
  plannedFor: (d, sp) => d === "2026-10-31" && sp !== "run" ? { label: "Seuil", w: { title: "Seuil #2 · 3 × 8'", goal: goalTxt, tss: 62 }, dur: 75, place: "mw", st: "plan" }
    : d === "2026-10-30" && sp !== "bike" ? { sport: "run", label: "Footing", w: { title: "Footing", goal: "Footing facile." }, dur: 40, st: "done" } : null };
c3.window.Recup = { data: { profile: { ftp: 262, vo2: [["2026-07-20", 60], ["2026-09-25", 59], ["2026-10-12", 62], ["2026-10-29", 58]], run: { lt: { pace: 252, hr: 178 } }, hrZones: { floors: [100, 119, 139, 159, 179], max: 199, lthr: 168, rest: 45 } } },
  days: [day("2026-10-29", {}), day("2026-10-30", { hrv: 36, recov: 0, tr: 85, trLvl: "HIGH" })], recoScore: d => ({ score: d.d === "2026-10-30" ? 52 : 70 }) };
Object.assign(c3, { Charge: c3.window.Charge, Recup: c3.window.Recup, Plan: c3.window.Plan });
vm.createContext(c3); vm.runInContext(readFileSync(new URL("../ia.js", import.meta.url), "utf8"), c3);
const IA = c3.window.IA, D = IA.data(now);
for (const re of [/Nous sommes vendredi 30 octobre 2026, c'est le soir\./, /^Heure : 19 h 45\.$/m, /Déjà fait aujourd'hui : muscu Legs \(jambes\) à 6 h 25 \(45 min\), course à pied à 18 h 00 \(43 min\)\./,
  /FTP de travail 230 W/, /Garmin, 262 W, est trop haute/, /74 kg/, /Z2 119-138/, /VO2max Garmin 58,0 \(de 58,0 à 62,0 sur 30 jours : la valeur change selon/, /allure seuil 4:12 \/km/,
  /niveau d'entraînement 67, fatigue récente 80, fraîcheur −13, soit « chargé »/, /ultra de 250 km/,
  // nuits : datées du réveil, verdict de la VFC écrit, champs absents omis
  /- réveil aujourd'hui \(ven\. 30\/10\) : couché 22:40, levé 08:30, 9 h 43 dormies/, /VFC 36 ms, SOUS sa zone normale \(45-60, moyenne 7 nuits 47\)/, /respiration 11,5 \/min/,
  /prêt à l'entraînement 85 \(HIGH\), plus de récupération à faire au réveil/, /score de récup de l'outil 52 \(moyen\)/, /- réveil hier \(jeu\. 29\/10\) : .*score de récup de l'outil 70 \(bon\)/,
  // séances : repère de date, sport en clair, allure pour la course (jamais ses watts), % de FTP pour le vélo
  /- aujourd'hui \(ven\. 30\/10\) à 18 h 00 · course à pied · 43 min · 7,7 km · 5:32 \/km · D\+ 72 m · 138 bpm moyens · charge 45 · cardio Z1 8 %, Z2 71 %, Z3 21 %/,
  /- aujourd'hui \(ven\. 30\/10\) à 6 h 25 · muscu Legs \(jambes\) · 45 min$/m, /- hier \(jeu\. 29\/10\) à 15 h 37 · vélo dehors · 1 h 06 · 30,5 km · D\+ 278 m · 143 bpm moyens/,
  /- avant-hier \(mer\. 28\/10\) à 18 h 30 · home trainer · 1 h 00 · 190 W moyens, 207 W normalisés \(90 % de la FTP\) · 150 bpm moyens/,
  // semaines et Plan (état des séances d'aujourd'hui, but réduit à sa première phrase, muscu)
  /- semaine du lun\. 26\/10 \(en cours, jusqu'à aujourd'hui ven\.\) : .*course 1 h 23, 14,7 km en 2 sorties ; muscu 1 ; cardio : \d+ % en Z1-Z2/,
  /- aujourd'hui \(ven\. 30\/10\) : course : Footing 40 min, faite \(Footing facile\)/, /- demain \(sam\. 31\/10\) : muscu Pull le matin ; vélo : Seuil #2 · 3 × 8' 75 min sur home trainer, charge prévue 62 \(3 × 8 min à 95 % de ta FTP, 4 min souples entre deux\)$/m])
  assert.match(D, re);
assert.ok(!/Saint-Malo|Cesson|MyWhoosh/.test(D), "jamais le nom d'une sortie");
assert.ok(!/330 W|335 W/.test(D), "les watts de course ne sont pas envoyés (confusion avec la FTP vélo)");
assert.ok(!/Effort 7\/10|Séance faite/.test(D), "but d'une séance du Plan : première phrase seulement");
assert.ok(D.indexOf("réveil aujourd'hui") < D.indexOf("réveil hier"), "la nuit la plus récente d'abord");
assert.ok(D.indexOf("Plan (il fait foi") < D.indexOf("Nuits, chacune"), "le Plan avant les listes (jamais coupé)");
// repères de date : jours de calendrier, pas des tranches de 24 h
const R = IA._.rel;
assert.equal(R(at(30, 0, 5), now), "aujourd'hui (ven. 30/10)"); assert.equal(R(at(29, 23, 50), now), "hier (jeu. 29/10)"); assert.equal(R(at(31, 6), now), "demain (sam. 31/10)");
assert.equal(R(at(25, 12), now), "il y a 5 j (dim. 25/10)"); assert.equal(IA._.gap(new Date(2026, 9, 24, 23), new Date(2026, 9, 26, 1)), -2, "changement d'heure du 25/10 compris");
// bilan d'une séance : sujet situé par rapport à maintenant, déroulé par tranches, séances comparables, ce qui l'entoure
assert.match(IA.sessionAbout(A[3], now), /séance de course à pied faite aujourd'hui \(ven\. 30\/10\), commencée à 18 h 00 \(soir\), finie il y a 62 min\./);
assert.match(IA.sessionAbout(A[4], now), /faite avant-hier \(mer\. 28\/10\), commencée à 7 h 00 \(matin\)\. Nathan relit cette séance après coup/);
const N = 480, st = { dt: 5, v: Array.from({ length: N }, (_, i) => i < 240 ? 108 : 120), h: Array.from({ length: N }, (_, i) => i < 240 ? 130 : 150), c: Array(N).fill(156), a: Array.from({ length: N }, (_, i) => i < 240 ? 30 : 30 + (i - 240) / 8), p: Array(N).fill(340) };
const sp = IA._.splits(st, true);
assert.equal(sp.length, 7); assert.match(sp[0], /^- 0 à 6 min : 5:33 \/km, 130 bpm, 156 pas\/min$/); assert.match(sp[6], /^- 34 à 40 min : 5:00 \/km, 150 bpm, 156 pas\/min, \+\d+ m \/ −0 m$/);
assert.ok(!sp.join("").includes(" W"), "course : pas de watts dans le déroulé"); assert.match(IA._.splits(st, false)[0], /^- 0 à 6 min : 340 W, 10,8 km\/h, 130 bpm, 156 tr\/min$/);
assert.match(IA._.splits(st, false, true)[6], /^- 34 à 40 min : 340 W, 150 bpm, 156 tr\/min$/, "home trainer : ni vitesse ni dénivelé virtuels");
assert.equal(IA._.splits({ dt: 5, h: Array(100).fill(120) }, true).length, 0, "moins de 15 min : pas de tranches");
assert.deepEqual(Array.from(IA._.similar(A[3]), a => a.id), [4, 5], "comparables : même sport, durée proche, avant la séance");
const X = IA.sessionExtra(A[3], st, now);
for (const re of [/Déroulé par tranches/, /Séances comparables d'avant/, /← la séance analysée\n- avant-hier \(mer\. 28\/10\) à 7 h 00 · course à pied · 40 min · 7,0 km · 5:43 \/km · D\+ 40 m · 140 bpm moyens · charge 45 · 1,25 m par battement/,
  /- Nuit d'avant la séance : réveil aujourd'hui \(ven\. 30\/10\) : .*SOUS sa zone normale/, /- Plus tôt le même jour : muscu Legs \(jambes\) à 6 h 25 \(45 min, charge 4\)\./,
  /- Les 3 jours d'avant : hier \(jeu\. 29\/10\) charge 64 \(vélo dehors 1 h 06\) ; avant-hier \(mer\. 28\/10\) charge 109 \(course à pied 40 min, home trainer 1 h 00\) ; il y a 3 j \(mar\. 27\/10\) repos\./,
  /- Forme la veille au soir : niveau d'entraînement 66, fraîcheur −19 \(« chargé »\)\./, /- Prévu au Plan ce jour-là en course : Footing 40 min \(Footing facile\.\)/])
  assert.match(X, re);
assert.ok(!/Cesson/.test(X));
// texte complet : sujet, déjà affiché, en plus, données ; trop long : les listes raccourcissent, le sujet et le Plan restent
const F = IA.full({ kind: "seance", about: IA.sessionAbout(A[3], now), page: "Découplage 9,5 % : élevé.", extra: X, focus: 3, now });
assert.match(F, /^SUJET : Commentaire de la séance de course à pied faite aujourd'hui[\s\S]*\n\nCE QUE BREIZH WATTS AFFICHE DÉJÀ À NATHAN[^\n]*\nDécouplage 9,5 % : élevé\.\n\nEN PLUS, CE QUE L'OUTIL N'AFFICHE PAS ICI[^\n]*\nDéroulé par tranches[\s\S]*\n\nDONNÉES DE NATHAN[^\n]*\nNous sommes vendredi/);
assert.match(F, /charge 45 · cardio Z1 8 %, Z2 71 %, Z3 21 %  ← la séance analysée/);
const big = IA.full({ kind: "seance", about: "sujet", page: "x".repeat(20000), extra: "y".repeat(9000), now });
assert.ok(big.length <= 15000); assert.match(big, /^SUJET : sujet/); assert.match(big, /Plan \(il fait foi/, "le Plan survit à la coupe");
assert.match(IA.full({ kind: "chat", page: "", now }), /^DONNÉES DE NATHAN/);
// réponse affichée : HTML sûr, intitulés en gras, listes, astérisques retirés
const H = IA.html("À retenir : le cardio monte de 14 bpm à allure égale <b>.\n\n**Explication :** montée de 31 m.\n- garde le seuil *demain*\n- 160 pas/min\n\n## Pour la suite : rien à changer.\nTu as bien couru.");
assert.equal(H, "<p><b>À retenir :</b> le cardio monte de 14 bpm à allure égale &lt;b&gt;.</p><p><b>Explication :</b> montée de 31 m.</p><ul><li>garde le seuil demain</li><li>160 pas/min</li></ul><p><b>Pour la suite :</b> rien à changer.</p><p>Tu as bien couru.</p>");
assert.equal(IA.html("<img src=x onerror=alert(1)>"), "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
assert.equal(IA.stale({ v: 2 }), ""); assert.match(IA.stale({ text: "ok" }), /Script de synchro ancien/);
console.log("OK : entraîneur IA (op ai de sync.gs : clés, usages, consignes, conversation, Flash puis Flash-Lite, quota, erreurs ; texte envoyé par ia.js : blocs, repères de date, bilan de séance, rendu).");
