// Test des points d'arrêt (horaires OSM, arrêts conseillés) : node tests/arrets.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = {}, ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: (v, d = 0) => (+v).toFixed(d).replace(".", ","), esc: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])), setTimeout, clearTimeout, AbortController };
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
  assert.ok(bodies.every(b => b.split("drinking_water").length - 1 <= 15), "15 rectangles au plus par requête");
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
// 4) fiche Google Maps sans clé, horaires du jour, site et téléphone
{ const G = "https://www.google.com/maps/search/?api=1&query=", q = u => decodeURIComponent(u.slice(G.length));
  const pt = (k, t, x = {}) => ({ id: "n42", k, lat: 48.123456, lon: -1.654321, t, t0: at("2026-10-31T10:30"), ...x });
  assert.ok(A._gmapsUrl(pt("bakery", { name: "Au Bon Pain", "addr:city": "Betton" })).startsWith(G), "API Maps URLs, sans clé");
  assert.equal(q(A._gmapsUrl(pt("bakery", { name: "Au Bon Pain", "addr:city": "Betton" }))), "48.12346,-1.65432", "coordonnées seules, même avec nom et commune");
  assert.equal(q(A._gmapsUrl(pt("water", {}))), "48.12346,-1.65432");
  // horaires du jour (samedi 31/10/2026), sans la bibliothèque : lecture simple
  const H2 = "Mo-Sa 07:00-13:00,15:30-19:30; Su 07:30-12:30";
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: H2 }), at("2026-10-26T08:00")), "samedi 7h-13h, 15h30-19h30");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: H2 }), at("2026-10-31T08:00")), "aujourd'hui 7h-13h, 15h30-19h30");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: H2 }, { t0: at("2026-11-01T10:00") }), at("2026-10-31T20:00")), "demain 7h30-12h30");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: "Mo-Fr 07:00-19:00; Sa,Su off" }), at("2026-10-26T08:00")), "fermé le samedi");
  assert.equal(A._hoursLine(pt("fuel", { opening_hours: "24/7" }), at("2026-10-31T08:00")), "aujourd'hui ouvert 24 h/24");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: H2, "check_date:opening_hours": "2024-03-12" }), at("2026-10-26T08:00")), "samedi 7h-13h, 15h30-19h30 (vérifiés en mars 2024)");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: H2, check_date: "2025-06" }), at("2026-10-26T08:00")), "samedi 7h-13h, 15h30-19h30 (vérifiés en juin 2025)");
  assert.equal(A._hoursLine(pt("bakery", { opening_hours: "Mo-Sa 07:00-19:00; PH off; Jan off" }), at("2026-10-26T08:00")), "horaires : lu-sa 7h-19h ; fériés fermé ; Jan fermé", "non lu : texte brut abrégé");
  assert.ok(A._ohBrief("Mo 08:00-12:00; Tu 08:00-12:00; We 08:00-12:00; Th 08:00-12:00; Fr 08:00-12:00").length <= 48);
  assert.equal(A._hoursLine(pt("bakery", { name: "X" })), "horaires inconnus, vois Google Maps", "commerce sans horaires");
  assert.equal(A._hoursLine(pt("water", {})), "", "point d'eau sans horaires : rien");
  // avec la bibliothèque opening_hours (bouchon) : plages du jour lues par getOpenIntervals
  { const d = (h, m = 0) => { const x = new Date("2026-10-31T00:00"); x.setHours(h, m); return x; };
    win.opening_hours = function () { this.getOpenIntervals = (a, b) => [[d(8), d(12, 15), false], [d(14), b, false]]; };
    assert.equal(A._hoursLine(pt("bakery", { opening_hours: "x" }), at("2026-10-26T08:00")), "samedi 8h-12h15, 14h-minuit");
    win.opening_hours = function () { this.getOpenIntervals = (a, b) => [[d(8), d(12), true, "sur rendez-vous"]]; };
    assert.match(A._hoursLine(pt("bikeshop", { opening_hours: "Sa 08:00-12:00 \"sur rendez-vous\"" }), at("2026-10-26T08:00")), /^horaires : sa 8h-12h/, "plage incertaine : texte brut");
    delete win.opening_hours; }
  // site (http(s) seulement) et téléphone
  assert.equal(A._webUrl({ website: "www.boulangerie.fr" }), "https://www.boulangerie.fr");
  assert.equal(A._webUrl({ "contact:website": "https://a.fr/x;https://b.fr" }), "https://a.fr/x");
  assert.equal(A._webUrl({ website: "javascript:alert(1)" }), null, "jamais javascript:");
  assert.deepEqual({ ...A._telOf({ phone: "+33 2 99 12 34 56" }) }, { href: "tel:+33299123456", txt: "02 99 12 34 56" });
  assert.deepEqual({ ...A._telOf({ "contact:phone": "02.99.12.34.56;0611223344" }) }, { href: "tel:+33299123456", txt: "02 99 12 34 56" });
  assert.deepEqual({ ...A._telOf({ phone: "+33 (0)2 99 12 34 56" }) }, { href: "tel:+33299123456", txt: "02 99 12 34 56" });
  assert.equal(A._telOf({}), null);
  assert.equal(A._osmUrl("w123"), "https://www.openstreetmap.org/way/123"); assert.equal(A._osmUrl("x1"), null);
  const html = A._linksHtml(pt("bakery", { name: "Au Bon Pain", "addr:city": "Betton", website: "https://pain.fr", phone: "0299123456", opening_hours: H2 }));
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=48.12346%2C-1.65432" target="_blank" rel="noopener">Google Maps</);
  assert.match(html, />site</); assert.match(html, /href="tel:\+33299123456">02 99 12 34 56</); assert.match(html, /openstreetmap\.org\/node\/42/); }
console.log("OK : horaires lus, arrêts conseillés cohérents, lieux à voir filtrés, fiches Google Maps et horaires du jour.");

// McDonald's : ravito (ouvert tous les jours, toilettes et eau), les autres fast-foods ne sont pas pris
assert.equal(A._kindOf({ amenity: "fast_food", name: "McDonald's", brand: "McDonald's" }), "mcdo");
assert.equal(A._kindOf({ amenity: "fast_food", brand: "McDonald's" }), "mcdo", "nom absent, marque présente");
assert.equal(A._kindOf({ amenity: "fast_food", name: "Kebab du port" }), null);
{ const els2 = [node(.48, 30, { amenity: "drinking_water", name: "Fontaine" }), node(.57, 40, { amenity: "fast_food", name: "McDonald's", opening_hours: "Mo-Su 07:00-23:00" }), node(.58, 30, { amenity: "cafe", name: "Bar de la place", opening_hours: "Mo-Su 07:00-20:00" })];
  const L2 = A._place(els2, P, r); L2.forEach(p => { if (p.t.opening_hours) p.oh = A._ohSimple(p.t.opening_hours, p.t0); });
  const a2 = A._advise(L2, r, { drink: .6, cap: 1.2, rate: 60, water: 2.4 }), rv = a2.find(a => a.role === "ravito");
  assert.equal(rv && rv.p.name, "McDonald's", "McDo préféré au bar"); assert.match(rv.why, /toilettes/); }
console.log("arrets mcdo ok");

// 7) vérification Google (Places API New) : correspondance, horaires, commerce fermé écarté des arrêts conseillés
{ const p = { id: "n1", k: "bakery", lat: 48.1, lon: -1.68, t: { name: "Boulangerie Le Fournil de Bréal" }, t0: at("2026-10-31T10:30") };
  const loc = (m, name, x = {}) => ({ displayName: { text: name }, location: { latitude: 48.1 + m / 110540, longitude: -1.68 }, ...x });
  assert.equal(A._gMatch([loc(60, "Crêperie du Bourg"), loc(120, "Le Fournil de Bréal")], p).displayName.text, "Le Fournil de Bréal", "nom ressemblant préféré au plus proche");
  assert.equal(A._gMatch([loc(60, "Boulangerie Martin")], p), null, "« boulangerie » seul ne suffit pas");
  assert.equal(A._gMatch([loc(20, "Boulangerie Martin")], p).displayName.text, "Boulangerie Martin", "à moins de 40 m : même lieu");
  assert.equal(A._gMatch([loc(400, "Le Fournil de Bréal")], p), null, "trop loin");
  assert.equal(A._gMatch([loc(150, "Boulangerie Martin")], { ...p, t: {} }).displayName.text, "Boulangerie Martin", "point OSM sans nom : le plus proche");
  // horaires Google : mardi-samedi 7h-13h et 15h-19h30, dimanche 7h-12h30 ; bar ouvert jusqu'à 1 h du matin le samedi
  const per = (d, a, b, d2 = d) => ({ open: { day: d, hour: a[0], minute: a[1] }, close: { day: d2, hour: b[0], minute: b[1] } });
  const reg = { periods: [2, 3, 4, 5, 6].flatMap(d => [per(d, [7, 0], [13, 0]), per(d, [15, 0], [19, 30])]).concat([per(0, [7, 0], [12, 30])]) };
  assert.equal(JSON.stringify(A._gDay(reg, at("2026-10-31T10:00"))), JSON.stringify([[420, 780], [900, 1170]]), "samedi");
  assert.equal(JSON.stringify(A._gDay(reg, at("2026-10-26T10:00"))), JSON.stringify([]), "lundi : fermé");
  assert.equal(JSON.stringify(A._gDay({ periods: [per(6, [18, 0], [1, 0], 0)] }, at("2026-11-01T00:30"))), JSON.stringify([[0, 60]]), "ouvert depuis la veille");
  assert.equal(JSON.stringify(A._gDay({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }, at("2026-10-31T03:00"))), JSON.stringify([[0, 1440]]), "24 h/24");
  const now = at("2026-10-29T12:00");
  const q = { ...p }; A._gApply(q, { st: "OPERATIONAL", reg }, now);
  assert.equal(q.oh.open, true); assert.equal(q.oh.next.getHours(), 13); assert.equal(q.hrs, "samedi 7h-13h, 15h-19h30 (Google)");
  const c = { ...p, oh: { open: true } }; A._gApply(c, { st: "CLOSED_PERMANENTLY" }, now);
  assert.equal(c.oh.open, false); assert.equal(c.hrs, "fermé définitivement (Google)");
  const m = { ...p, hrs: "horaires inconnus, vois Google Maps" }; A._gApply(m, { miss: true }, now); assert.equal(m.hrs, "absent de Google : peut-être fermé");
  const o = { ...p, hrs: "samedi 7h-19h", oh: { open: true } }; A._gApply(o, { st: "OPERATIONAL", reg: null }, now); assert.equal(o.hrs, "samedi 7h-19h", "Google sans horaires : OSM gardé");
  // la boulangerie conseillée est fermée définitivement : l'autre prend sa place
  const els3 = [node(.48, 30, { amenity: "drinking_water", name: "Fontaine" }), node(.57, 20, { shop: "bakery", name: "Fermée", opening_hours: "Mo-Su 07:00-19:00" }), node(.6, 60, { shop: "bakery", name: "Autre", opening_hours: "Mo-Su 07:00-19:00" })];
  const L3 = A._place(els3, P, r); L3.forEach(p => { p.oh = p.t.opening_hours ? A._ohSimple(p.t.opening_hours, p.t0) : null; });
  const nut = { drink: .6, cap: 1.2, rate: 60, water: 2.4 };
  assert.equal(A._advise(L3, r, nut).find(a => a.role === "ravito").p.name, "Fermée", "avant vérification");
  A._gApply(L3.find(p => p.name === "Fermée"), { st: "CLOSED_PERMANENTLY" }, now);
  assert.equal(A._advise(L3, r, nut).find(a => a.role === "ravito").p.name, "Autre", "après vérification");
  // sans clé : pas de bouton « vérifier sur Google » ; lien vers la fiche Google exacte quand elle est connue
  assert.doesNotMatch(A._linksHtml({ ...p, k: "bakery" }), /data-gchk/);
  assert.match(A._linksHtml({ ...p, g: { url: "https://maps.google.com/?cid=123" } }), /cid=123/);
}
console.log("arrets google ok");
// 8) raison du refus Google affichée en clair
assert.match(A._gErrTxt({ status: 403, why: "API_KEY_HTTP_REFERRER_BLOCKED" }), /Sites Web/);
assert.match(A._gErrTxt({ status: 403, why: "SERVICE_DISABLED" }), /pas activée/);
assert.match(A._gErrTxt({ status: 403, why: "BILLING_DISABLED" }), /facturation/);
assert.match(A._gErrTxt({ status: 403, why: "AUTRE", message: "Requests are blocked." }), /AUTRE.*Requests are blocked/);
console.log("arrets erreurs google ok");

// 9) bourgs au moment du ravito (Google) : choix des bourgs, rapprochement avec OSM, nouveaux commerces
{ const els4 = [node(.05, 20, { shop: "bakery", name: "Trop tôt" }), node(.54, 30, { shop: "bakery", name: "Le Fournil" }), node(.545, 60, { shop: "convenience", name: "Proxi" }),
    node(.62, 40, { shop: "bakery", name: "Autre bourg" }), node(.5, 30, { amenity: "drinking_water" })];
  const L4 = A._place(els4, P, r), T4 = A._gTowns(L4, P, r);
  assert.equal(T4.length, 2, "deux bourgs au plus, à plus de 3 km");
  assert.ok(Math.abs(T4[0].lat - (48.1 + .5425 * 100000 / 111320)) < .002, "le bourg le plus proche de l'heure du ravito d'abord (centre des commerces)");
  assert.equal(A._gTowns(L4, P, { ...r, secs: 2 * 3600 }).length, 0, "sortie courte : pas de recherche");
  const T5 = A._gTowns(L4.filter(p => p.name === "Trop tôt"), P, r);
  assert.equal(T5.length, 1, "aucun commerce au bon moment : le point du tracé à l'heure du ravito");
  assert.ok(Math.abs(T5[0].lat - (48.1 + .55 * 100000 / 111320)) < .003);
  // types Google
  assert.equal(A._gTags({ primaryType: "bakery", displayName: { text: "Au Bon Pain" } }).shop, "bakery");
  assert.equal(A._gTags({ primaryType: "restaurant", types: ["restaurant"], displayName: { text: "Crêperie" } }), null, "restaurant : pas un ravito");
  assert.equal(A._gTags({ primaryType: "restaurant", displayName: { text: "McDonald's Pacé" } }).amenity, "fast_food");
  assert.equal(A._gTags({ primaryType: "supermarket", displayName: { text: "Carrefour Contact" } }).shop, "supermarket");
  // rapprochement : nom ressemblant → point OSM ; inconnu → nouveau point ; fermé → ignoré ; point OSM sans nom = même type à < 60 m
  const at_ = (f, off) => ({ latitude: 48.1 + f * 100000 / 111320, longitude: -1.68 + off / 74000 });
  const fournil = L4.find(p => p.name === "Le Fournil");
  const pl = [{ id: "a", displayName: { text: "Boulangerie Le Fournil" }, primaryType: "bakery", location: at_(.541, 30), businessStatus: "OPERATIONAL" },
    { id: "b", displayName: { text: "Maison Durand" }, primaryType: "bakery", location: at_(.546, 20), businessStatus: "OPERATIONAL" },
    { id: "c", displayName: { text: "Ancienne boulangerie Roux" }, primaryType: "bakery", location: at_(.543, 10), businessStatus: "CLOSED_PERMANENTLY" },
    { id: "d", displayName: { text: "Le Grill" }, primaryType: "restaurant", location: at_(.544, 10), businessStatus: "OPERATIONAL" }];
  const M = A._gMerge(pl, L4);
  assert.equal(JSON.stringify(M.hits.map(([id, q]) => [id, q.id])), JSON.stringify([[fournil.id, "a"]]));
  assert.equal(JSON.stringify(M.extra.map(e => e.id)), JSON.stringify(["g:b"]), "seule la boulangerie ouverte inconnue d'OSM est ajoutée");
  const anon = A._place([node(.54, 30, { shop: "bakery" })], P, r);
  assert.equal(A._gMerge([pl[1]], anon).hits.length, 0, "point OSM sans nom à ~110 m : pas rapproché");
  assert.equal(A._gMerge([{ ...pl[1], location: at_(.5403, 30) }], anon).hits.length, 1, "point OSM sans nom, même type à < 60 m : rapproché");
  // un commerce ajouté par Google passe par le placement normal et peut être conseillé, mal noté il passe après
  const extra = A._place(L4.map(p => ({ id: p.id, lat: p.lat, lon: p.lon, t: p.t })).concat(M.extra), P, r);
  const gb = extra.find(p => p.id === "g:b"); assert.ok(gb && gb.k === "bakery", "nouveau point placé sur le parcours");
  extra.forEach(p => { p.oh = null; });
  const fo = extra.find(p => p.name === "Le Fournil"); A._gApply(fo, { st: "OPERATIONAL", reg: { periods: [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 7, minute: 0 }, close: { day: d, hour: 19, minute: 0 } })) }, rt: 3.1, rn: 40 }, at("2026-10-09T12:00"));
  A._gApply(gb, { st: "OPERATIONAL", reg: { periods: [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 7, minute: 0 }, close: { day: d, hour: 19, minute: 0 } })) }, rt: 4.7, rn: 80 }, at("2026-10-09T12:00"));
  const rv = A._advise(extra.filter(p => p.cat === "ravito"), r, null).find(a => /ravito/.test(a.role));
  assert.equal(rv && rv.p.id, "g:b", "boulangerie Google bien notée préférée à celle notée 3,1");
  assert.match(A._linksHtml(gb), /★ 4,7 \(80 avis\).*trouvé sur Google/);
}
console.log("arrets bourgs google ok");
