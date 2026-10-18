// Test des points d'arrêt (horaires OSM, arrêts conseillés) : node tests/arrets.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = {}, ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: (v, d = 0) => (+v).toFixed(d).replace(".", ","), esc: s => String(s), setTimeout, clearTimeout, AbortController };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets;

// 1) horaires : boulangerie fermée le lundi et le dimanche après-midi
const H = "Tu-Sa 07:00-13:00,15:00-19:30; Su 07:00-12:30; PH off";
const at = s => new Date(s);
assert.equal(A._ohSimple(H, at("2026-10-12T10:00")).open, false, "lundi : fermé");
assert.equal(A._ohSimple(H, at("2026-10-11T15:00")).open, false, "dimanche après-midi : fermé");
const sun = A._ohSimple(H, at("2026-10-11T11:00")); assert.equal(sun.open, true, "dimanche matin : ouvert"); assert.equal(sun.next.getHours(), 12, "ferme à 12 h 30");
const lunch = A._ohSimple(H, at("2026-10-13T14:00")); assert.equal(lunch.open, false, "mardi 14 h : pause de midi"); assert.equal(lunch.next.getHours(), 15, "rouvre à 15 h");
assert.equal(A._ohSimple("24/7", at("2026-12-25T03:00")).open, true);
assert.equal(A._ohSimple("Mo-Fr 08:00-18:00; Sa off", at("2026-10-10T10:00")).open, false, "samedi off");
assert.equal(A._ohSimple("sunrise-sunset", at("2026-10-10T10:00")), null, "cas non lu : inconnu");

// 2) arrêts conseillés : 4 h de sortie, eau vers le milieu, ravito ouvert, rien dans les premiers km
const P = [], T = [], t0 = at("2026-10-10T09:00").getTime(), n = 4001;
for (let i = 0; i < n; i++) { P.push({ d: i * 25, lat: 48.1 + i * 25 / 111320, lon: -1.68, e: 50 }); T.push(t0 + i / (n - 1) * 4 * 3600e3); }
const r = { T, secs: 4 * 3600, ok: true, tmax: 18 };
const node = (f, off, tags) => ({ id: "n" + f, lat: 48.1 + f * 100000 / 111320, lon: -1.68 + off / 74000, t: tags });
const els = [node(.05, 20, { amenity: "drinking_water" }), node(.48, 30, { amenity: "drinking_water", name: "Fontaine" }), node(.5, 200, { amenity: "drinking_water", name: "Trop loin" }),
  node(.56, 40, { shop: "bakery", name: "Fermée", opening_hours: "Tu-Fr 07:00-13:00; Sa 14:00-19:00" }), node(.58, 30, { shop: "bakery", name: "Ouverte", opening_hours: "Mo-Su 07:00-19:00" })];
const L = A._place(els, P, r);
assert.equal(L.length, 4, "le point à 200 m est écarté");
L.forEach(p => { if (p.t.opening_hours) p.oh = A._ohSimple(p.t.opening_hours, p.t0); });
const adv = A._advise(L, r, { drink: .6, cap: 1.2, rate: 60, water: 2.4 });
assert.equal(adv.length, 2, "un arrêt eau et un ravito");
assert.equal(adv[0].p.name, "Fontaine"); assert.match(adv[0].role, /eau/);
assert.equal(adv[1].p.name, "Ouverte", "la boulangerie fermée (samedi matin) n'est pas conseillée"); assert.equal(adv[1].role, "ravito");
assert.equal(A._advise(L, { ...r, secs: 1.5 * 3600 }, null).length, 0, "moins de 2 h : pas d'arrêt");
// 2 bis) jamais d'arrêt conseillé en début de sortie : rien avant 1 h 45, rien sous 2 h 15 de sortie
{ const early = [node(.1, 10, { amenity: "drinking_water" }), node(.3, 10, { shop: "bakery", opening_hours: "Mo-Su 07:00-19:00" })], LE = A._place(early, P, r);
  LE.forEach(p => { if (p.t.opening_hours) p.oh = A._ohSimple(p.t.opening_hours, p.t0); });
  assert.equal(A._advise(LE, r, { drink: .6, cap: 1.2, rate: 60, water: 2.4 }).length, 0, "points à 24 et 72 min : pas conseillés");
  assert.equal(A._advise(L, { ...r, secs: 2.2 * 3600 }, null).length, 0, "2 h 12 : pas d'arrêt"); }
// 2 ter) requête Overpass : rectangles de 3 km le long du tracé, sans les 400 premiers et derniers mètres
{ const C = A._corridor(P), B = C.split("|").map(b => b.split(",").map(Number));
  assert.ok(B.length >= 32 && B.length <= 34, "un rectangle par tronçon de 3 km : " + B.length);
  assert.ok(B[0][0] > 48.1 + 200 / 111320, "le départ n'est pas dans le premier rectangle"); }
// 2 quater) trois serveurs Overpass : une réponse « délai dépassé » (code 200) passe au serveur suivant ; tous en échec = erreur
{ const calls = [], resp = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 504, json: async () => body });
  ctx.fetch = url => { calls.push(url); return calls.length === 1 ? resp({ remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds.", elements: [] }) : resp({ elements: [{ type: "node", id: 1 }] }); };
  const j = await A._overpass("q");
  assert.equal(calls.length, 2, "le 2e serveur est interrogé après le délai dépassé du 1er"); assert.equal(j.elements.length, 1, "réponse du 2e serveur gardée");
  calls.length = 0; ctx.fetch = url => { calls.push(url); return resp({}, false); };
  const st = ctx.setTimeout; ctx.setTimeout = (f, ms) => st(f, ms === 8000 ? 0 : ms);
  await assert.rejects(A._overpass("q"), /Overpass 504/, "tous les serveurs en échec : erreur"); ctx.setTimeout = st;
  assert.equal(calls.length, 12, "les 3 serveurs sont essayés, 4 fois chacun (504 = saturé)"); assert.equal(new Set(calls).size, 3); }
// 2 quater bis) 429 (plus de place libre) : on redemande au même serveur après une pause
{ const calls = [], st = ctx.setTimeout; ctx.setTimeout = (f, ms) => st(f, ms === 8000 ? 0 : ms);
  ctx.fetch = url => { calls.push(url); return Promise.resolve(calls.length < 3 ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ elements: [] }) }); };
  await A._overpass("q"); ctx.setTimeout = st;
  assert.deepEqual(calls, Array(3).fill(calls[0]), "2 refus 429 puis réponse, toujours le 1er serveur"); }
// 2 quinquies) longue trace : requête coupée en morceaux de 15 rectangles, doublons fusionnés
{ const C = A._corridor(P), n = C.split("|").length, bodies = [];
  ctx.fetch = (url, o) => { if (!o) return Promise.resolve({ ok: false, status: 404 }); const id = bodies.push(decodeURIComponent(o.body)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ elements: [{ type: "node", id: 7, lat: 48.2, lon: -1.68, tags: { amenity: "drinking_water" } }, { type: "node", id, lat: 48.3, lon: -1.68, tags: { shop: "bakery" } }] }) }); };
  const els = await A._fetchPois(C, false);
  assert.equal(bodies.length, Math.ceil(n / 15), `${n} rectangles : ${Math.ceil(n / 15)} requêtes`);
  assert.ok(bodies.every(b => b.split("amenity").length - 1 <= 15), "15 rectangles au plus par requête");
  assert.equal(els.length, 1 + bodies.length, "le point présent dans chaque réponse n'est gardé qu'une fois"); }
// 2 sexies) carreaux préparés (data/poi) : lus localement, Overpass seulement pour les rectangles hors des carreaux
{ const C = A._corridor(P), B = C.split("|"), posts = [], gets = [];
  const tiles = { "48.0_-2.0": [{ id: "n1", lat: 48.3, lon: -1.68, t: { amenity: "drinking_water" } }, { id: "n2", lat: 48.3, lon: -1.9, t: { amenity: "drinking_water" } },
    { id: "n3", lat: 48.4, lon: -1.68, t: { historic: "castle", wikidata: "Q1" } }] };
  ctx.fetch = (url, o) => { if (o) { posts.push(decodeURIComponent(o.body)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ elements: [{ type: "node", id: 9, lat: 48.7, lon: -1.68, tags: { shop: "bakery" } }, { type: "node", id: 1, lat: 48.3, lon: -1.68, tags: { amenity: "drinking_water" } }] }) }); }
    gets.push(url); const m = url.match(/poi\/(.+)\.json$/), j = m[1] === "index" ? { "48.0_-2.0": "2026-10-18" } : tiles[m[1]];
    return Promise.resolve(j ? { ok: true, status: 200, json: async () => j } : { ok: false, status: 404 }); };
  const els = await A._fetchPois(C, false), ids = els.map(e => e.id).sort().join();
  assert.equal(ids, "n1,n9", "point d'eau du carreau (une fois, aussi rendu par Overpass), boulangerie d'Overpass ; hors couloir et « À voir » écartés");
  const far = B.filter(b => +b.split(",")[2] >= 48.5);
  assert.equal(posts.length, Math.ceil(far.length / 15), "Overpass seulement pour les rectangles qui dépassent 48,5° N (carreau absent)");
  assert.ok(posts.every(q => !q.includes("(48.1")), "aucun rectangle couvert par les carreaux n'est envoyé");
  assert.ok(!gets.some(u => u.includes("48.5_")), "carreau absent de l'index : pas demandé");
  assert.ok((await A._fetchPois(A._corridor(P, 300), true)).some(e => e.id === "n3"), "Pause découverte : le château du carreau est gardé"); }
// 3) Pause découverte : seulement les lieux avec une fiche, anecdote de 1 à 2 phrases sans ajout
assert.equal(A._voirKind({ historic: "castle" }), null, "pas de fiche : écarté");
assert.equal(A._voirKind({ historic: "archaeological_site", archaeological_site: "megalith", wikidata: "Q1" }), "megalith");
assert.equal(A._voirKind({ man_made: "windmill", wikipedia: "fr:Moulin" }), "mill");
assert.equal(A._voirKind({ tourism: "viewpoint", wikidata: "Q2" }), "viewpoint");
assert.equal(A._anecdote("Le menhir de Champ-Dolent est un menhir de Dol-de-Bretagne. Il mesure 9,5 m. Troisième phrase."), "Le menhir de Champ-Dolent est un menhir de Dol-de-Bretagne. Il mesure 9,5 m.");
assert.ok(A._anecdote("x ".repeat(400)).length <= 300);
console.log("OK : horaires lus, arrêts conseillés cohérents, lieux à voir filtrés.");
