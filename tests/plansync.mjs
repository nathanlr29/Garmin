// Test de la synchro du Plan (plansync.js) : node tests/plansync.mjs
// Deux « appareils » (deux contextes vm, chacun son localStorage) et un faux serveur qui applique la règle de sync.gs (ts plus grand gagne).
process.env.TZ = "Europe/Paris";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const src = readFileSync(new URL("../plansync.js", import.meta.url), "utf8");

const server = new Map();   // id -> { ts, v }
function device(name, pre = {}) {
  const store = { ...pre }, queue = {}, cols = {}, refreshed = [];
  const ls = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, get length() { return Object.keys(store).length; }, key: i => Object.keys(store)[i] };
  const Sync = { register: (n, c) => { cols[n] = c; }, push: (n, items) => { for (const it of items) queue[it.id] = it; } };
  const win = { Sync, Plan: { refresh: () => refreshed.push(1) } };
  const doc = { activeElement: null, listeners: [], addEventListener(n, f) { this.listeners.push(f); } };
  const ctx = { window: win, document: doc, setTimeout: f => f(), localStorage: ls, console, JSON, Date, Math, Object, Array, Set, RegExp, Number, String };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const get = k => store[k] === undefined ? undefined : JSON.parse(store[k]);
  const set = (k, v) => { store[k] = JSON.stringify(v); win.PlanSync.touch(); };    // ce que fait store2.set de plan.js
  const del = k => { delete store[k]; win.PlanSync.touch(); };
  let first = true;
  const sync = () => {   // ce que fait sync.js : migration au premier passage, puis file d'attente ; le serveur garde le ts le plus grand
    const sent = first ? cols.plan.local() : Object.values(queue); first = false;
    for (const it of sent) { const s = server.get(it.id); if (!s || it.ts > s.ts) server.set(it.id, { ts: it.ts, v: it.v }); delete queue[it.id]; }
    cols.plan.apply([...server].map(([id, o]) => ({ id, ts: o.ts, v: o.v })));
  };
  return { name, store, get, set, del, sync, queue, refreshed, doc, P: win.PlanSync._ };
}
const mon = "2026-10-12";   // lundi de la semaine de test (date système = 16/10/2026 : dans la fenêtre)
let t = Date.now(); const realNow = Date.now; Date.now = () => (t += 5);   // horloge qui avance : deux écritures n'ont jamais le même ts

// ---------------------------------------------------------------- 1. jeudi sur le Mac, vendredi sur le téléphone : les deux sont gardés
{
  server.clear();
  const mac = device("mac"), tel = device("tel");
  mac.sync(); tel.sync();   // premier passage à vide
  mac.set(`planOv:${mon}`, { 3: { t: "thr" } }); mac.sync();
  tel.set(`planOv:${mon}`, { 4: { dur: 45 } }); tel.sync();   // le téléphone ne connaît pas encore jeudi
  mac.sync(); tel.sync();
  assert.deepEqual(mac.get(`planOv:${mon}`), { 3: { t: "thr" }, 4: { dur: 45 } }, "Mac : jeudi et vendredi");
  assert.deepEqual(tel.get(`planOv:${mon}`), { 3: { t: "thr" }, 4: { dur: 45 } }, "téléphone : jeudi et vendredi");
  assert.ok(mac.refreshed.length >= 1 && tel.refreshed.length >= 1, "l'onglet est redessiné après réception");
}
// ---------------------------------------------------------------- 2. même jour des deux côtés : le plus récent gagne
{
  server.clear();
  const mac = device("mac"), tel = device("tel"); mac.sync(); tel.sync();
  mac.set(`planOv:${mon}`, { 2: { dur: 60 } });
  tel.set(`planOv:${mon}`, { 2: { dur: 90 } });    // plus récent
  mac.sync(); tel.sync(); mac.sync();
  assert.deepEqual(mac.get(`planOv:${mon}`), { 2: { dur: 90 } }); assert.deepEqual(tel.get(`planOv:${mon}`), { 2: { dur: 90 } });
}
// ---------------------------------------------------------------- 3. suppression d'un jour, « Revenir au plan », annulations
{
  server.clear();
  const mac = device("mac"), tel = device("tel"); mac.sync(); tel.sync();
  mac.set(`planOv:${mon}`, { 1: { t: "end" }, 5: { dur: 30 } }); mac.set(`planUndo:${mon}`, ["rmove-2", "radj-3"]); mac.sync(); tel.sync();
  assert.deepEqual(tel.get(`planUndo:${mon}`), ["rmove-2", "radj-3"]);
  tel.set(`planOv:${mon}`, { 5: { dur: 30 } });                 // jour 1 retiré sur le téléphone
  tel.del(`planUndo:${mon}`);                                    // « Refaire » : toutes les annulations levées
  tel.sync(); mac.sync();
  assert.deepEqual(mac.get(`planOv:${mon}`), { 5: { dur: 30 } }, "jour retiré partout");
  assert.equal(mac.get(`planUndo:${mon}`), undefined, "annulations levées partout");
  mac.set(`planUndo:${mon}`, ["rmove-2"]); mac.sync(); tel.sync();    // on peut ré-annuler après un « Refaire »
  assert.deepEqual(tel.get(`planUndo:${mon}`), ["rmove-2"]);
  tel.del(`planOv:${mon}`); tel.sync(); mac.sync();
  assert.equal(mac.get(`planOv:${mon}`), undefined, "plus aucun jour : la clé disparaît");
}
// ---------------------------------------------------------------- 4. réglages, muscu, semaine figée
{
  server.clear();
  const mac = device("mac"), tel = device("tel"); mac.sync(); tel.sync();
  const cfg = { v: 2, days: Array.from({ length: 7 }, () => ({ bike: "mw", dur: 60, muscu: false })), goal: {}, start: "2026-10-05" };
  mac.set("planCfg", cfg); mac.set("planFtp", 250); mac.set("bwWeight", 77); mac.set("muscuLbl", { a: "Legs", b: "Push" });
  mac.set(`planWk:${mon}`, { v: 2, sig: "x", items: [{}, {}, {}, {}, {}, {}, {}] });
  mac.sync(); tel.sync();
  assert.deepEqual(tel.get("planCfg"), cfg); assert.equal(tel.get("planFtp"), 250); assert.equal(tel.get("bwWeight"), 77);
  assert.deepEqual(tel.get("muscuLbl"), { a: "Legs", b: "Push" }); assert.equal(tel.get(`planWk:${mon}`).items.length, 7);
  tel.set("muscuLbl", { a: "Legs", b: "Pull" }); tel.sync(); mac.sync();
  assert.deepEqual(mac.get("muscuLbl"), { a: "Legs", b: "Pull" });
}
// ---------------------------------------------------------------- 5. migration : le premier appareil synchronisé impose son plan, le second l'adopte
{
  server.clear();
  const mac = device("mac", { planFtp: "250", [`planOv:${mon}`]: JSON.stringify({ 0: { dur: 45 } }) });    // existant avant la synchro
  const tel = device("tel", { planFtp: "240", [`planOv:${mon}`]: JSON.stringify({ 0: { dur: 90 } }) });
  mac.sync(); tel.sync(); mac.sync();
  assert.equal(tel.get("planFtp"), 250, "le téléphone adopte le plan du Mac"); assert.equal(mac.get("planFtp"), 250);
  assert.deepEqual(tel.get(`planOv:${mon}`), { 0: { dur: 45 } });
  tel.set("planFtp", 255); tel.sync(); mac.sync();    // une vraie modification, ensuite, gagne
  assert.equal(mac.get("planFtp"), 255);
}
// ---------------------------------------------------------------- 6. pas d'écho, planSince, fenêtre, taille, valeurs refusées, hors ligne
{
  server.clear();
  const mac = device("mac"), tel = device("tel"); mac.sync(); tel.sync();
  mac.set("planSince", "2026-10-05"); mac.sync(); tel.set("planSince", "2026-09-01"); tel.sync(); mac.sync();
  assert.equal(mac.get("planSince"), "2026-10-05", "planSince : le premier synchronisé fixe la date"); assert.equal(tel.get("planSince"), "2026-10-05");
  mac.set("planFtp", 260); mac.sync(); tel.sync();
  assert.equal(Object.keys(tel.queue).length, 0, "ce qui vient d'ailleurs n'est pas renvoyé");
  tel.set(`planWk:2026-06-01`, { v: 2, items: [] }); assert.equal(Object.keys(tel.queue).filter(i => i.startsWith("planWk")).length, 0, "semaine de plus de 8 semaines : pas envoyée");
  tel.set(`planWk:${mon}`, { v: 2, items: ["x".repeat(41000)] }); assert.ok(!(`planWk:${mon}` in tel.queue), "trop gros pour une cellule : pas envoyé");
  // valeurs refusées à la réception
  const bad = [{ id: "planFtp", ts: 1e15, v: 9999 }, { id: "planCfg", ts: 1e15, v: { days: [] } }, { id: "tab", ts: 1e15, v: "x" }, { id: "soStart", ts: 1e15, v: [48, -1] }, { id: "planOv:2026-10-12:9", ts: 1e15, v: {} }];
  tel.P.apply(bad); assert.equal(tel.get("planFtp"), 260); assert.equal(tel.get("tab"), undefined); assert.equal(tel.get("soStart"), undefined);
  // modifications faites hors ligne : envoyées au retour
  tel.set("bwAge", "20-29"); tel.set("planFtp", 270);
  assert.equal(Object.keys(tel.queue).length >= 2, true); tel.sync(); mac.sync();
  assert.equal(mac.get("planFtp"), 270); assert.equal(mac.get("bwAge"), "20-29");
}
// ---------------------------------------------------------------- 7. ce qui n'est pas du Plan n'est jamais touché
{
  const d = device("x", { soStart: "[48.1,-1.6]", tab: '"plan"', syncCfg: '{"key":"secret"}' });
  const ids = Object.keys(d.P.collect()); assert.deepEqual(ids, []);
  d.set("planFtp", 250); assert.deepEqual(Object.keys(d.P.collect()), ["planFtp"]);
}
// ---------------------------------------------------------------- 8. pas de redessin pendant une saisie ; vieilles semaines oubliées sans être « supprimées »
{
  server.clear();
  const mac = device("mac"), tel = device("tel"); mac.sync(); tel.sync();
  tel.doc.activeElement = { tagName: "INPUT", closest: s => s === "#plan" ? {} : null };   // l'utilisateur tape dans un champ du Plan
  mac.set("planFtp", 280); mac.sync(); tel.sync();
  assert.equal(tel.get("planFtp"), 280, "la valeur est bien reçue"); assert.equal(tel.refreshed.length, 0, "mais l'onglet n'est pas redessiné pendant la saisie");
  tel.doc.activeElement = null; tel.doc.listeners.forEach(f => f());                      // le champ perd le focus
  assert.equal(tel.refreshed.length, 1, "redessiné ensuite");
  const old = "planWk:2026-01-05";
  tel.set(old, { v: 2, items: [] }); tel.set("planFtp", 281);
  assert.ok(!(old in JSON.parse(tel.store.planSyncSnap)), "semaine hors fenêtre : plus suivie");
  delete tel.store[old]; tel.set("planFtp", 282);
  assert.equal(server.get(old), undefined, "retirer une vieille semaine localement n'envoie aucune suppression");
}
Date.now = realNow;
console.log("plansync : OK");
