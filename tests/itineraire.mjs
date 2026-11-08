// Test de « Départ → Arrivée » (onglet Sortie) : node tests/itineraire.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = { addEventListener() {} }, esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ctx = { nf: (v, d = 0) => (+v).toFixed(d), esc, window: win, document: { addEventListener() {} }, addEventListener() {}, innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../sortie.js", import.meta.url), "utf8"), ctx);
const { _brf: B, _brfStrict: S, _abShort: short, _abAnswer: ans, _viaInsert: ins, _join: join, _overlap: ov } = win.Sortie;

// 1) profil strict : chaque remplacement a eu lieu, plus aucun coût « non revêtu » permis, le reste identique
assert.notEqual(S, B);
assert.doesNotMatch(S, /isunpaved (25|40|50|60|80|100) /);
assert.doesNotMatch(S, /tracktype=grade[2-5] (?!10000)/);
assert.match(S, / switch ispaved 6 10000\n/);
assert.equal((S.match(/isunpaved 10000/g) || []).length, 6);
const diff = B.split("\n").filter((l, i) => l !== S.split("\n")[i]).length;
assert.equal(B.split("\n").length, S.split("\n").length);
assert.equal(diff, 12);  // 6 lignes « isunpaved », bridleway, 4 tracktype, 1 chemin sans revêtement connu
// les routes goudronnées gardent leur coût (petites routes d'abord, grandes routes pénalisées)
for (const l of [" switch or highway=primary highway=primary_link 2.5", " switch or highway=secondary highway=secondary_link 1.2", " switch highway=cycleway switch isunpaved 10000 6"]) assert.ok(S.includes(l), l);

// 2) libellés courts des adresses IGN
assert.equal(short("Bain-de-Bretagne, 35470 Bain-de-Bretagne"), "Bain-de-Bretagne");
assert.equal(short("Place de la Mairie, 35000 Rennes"), "Place de la Mairie, Rennes");
assert.equal(short("Bain-de-Bretagne, 35470"), "Bain-de-Bretagne");
assert.equal(short("12 Rue de Brest, 29200 Brest"), "12 Rue de Brest, Brest");

// 3) phrase-réponse
assert.match(ans(null, null, null), /^Tape un départ et une arrivée, ou touche la carte : l'itinéraire passe uniquement par des routes goudronnées/);
const a = { label: "Rennes" }, b = { label: "Bain <b>" };
assert.equal(ans(a, b, { km: 39.73, asc: 212, dirt: 0, main: 0, cyc: 0 }), "Rennes → Bain &lt;b> : <b>39.7 km</b> et <b>212 m D+</b> par les petites routes, tout goudronné.");
assert.match(ans(a, b, { km: 40, asc: 200, dirt: .02, main: .08, cyc: 1200 }), /2 % sans revêtement connu \(aucune autre route possible\), 8 % sur route principale, 1.2 km de piste cyclable goudronnée\.$/);
const R1 = { km: 40, asc: 200, dirt: 0, main: 0, cyc: 0 };
assert.match(ans(a, b, R1, 1), /^Rennes → Bain &lt;b> par 1 étape : /);
assert.match(ans(a, b, R1, 3), / par 3 étapes : /);
// étapes nommées (3 au plus) : « par Redon et Guer » ; une sans nom ou plus de 3 : leur nombre
assert.match(ans(a, b, R1, [[47.6, -2.1, "Redon"]]), /^Rennes → Bain &lt;b> par Redon : /);
assert.match(ans(a, b, R1, [[47.6, -2.1, "Redon"], [47.9, -2.2, "Guer"]]), / par Redon et Guer : /);
assert.match(ans(a, b, R1, [[1, 1, "A"], [2, 2, "B<"], [3, 3, "C"]]), / par A, B&lt; et C : /);
assert.match(ans(a, b, R1, [[47.6, -2.1, "Redon"], [47.9, -2.2]]), / par 2 étapes : /);
assert.match(ans(a, b, R1, [[1, 1, "A"], [2, 2, "B"], [3, 3, "C"], [4, 4, "D"]]), / par 4 étapes : /);
// rangement d'une étape touchée sur la carte : les noms des autres étapes sont gardés
assert.equal(JSON.stringify(win.Sortie._viaInsert([48.0, -1.7], [48.4, -1.7], [[48.1, -1.7, "Chartres"], [48.3, -1.7, "Vern"]], [48.2, -1.8], Array.from({ length: 41 }, (_, i) => [48.0 + i * .01, -1.7]))),
  JSON.stringify([[48.1, -1.7, "Chartres"], [48.2, -1.8], [48.3, -1.7, "Vern"]]));

// 4) points de passage rangés dans l'ordre du trajet
const A = [48.0, -1.7], Bz = [48.4, -1.7];   // trajet sud → nord
const line = Array.from({ length: 41 }, (_, i) => [48.0 + i * .01, -1.7]);
const J = x => JSON.stringify(x);
assert.equal(J(ins(A, Bz, [], [48.2, -1.65], line)), J([[48.2, -1.65]]));
assert.equal(J(ins(A, Bz, [[48.3, -1.7]], [48.1, -1.6], line)), J([[48.1, -1.6], [48.3, -1.7]]));       // avant le premier
assert.equal(J(ins(A, Bz, [[48.1, -1.7], [48.2, -1.7]], [48.35, -1.75], line)), J([[48.1, -1.7], [48.2, -1.7], [48.35, -1.75]]));  // après le dernier
assert.equal(J(ins(A, Bz, [[48.1, -1.7], [48.3, -1.7]], [48.2, -1.8], line)), J([[48.1, -1.7], [48.2, -1.8], [48.3, -1.7]]));   // entre les deux
// sans tracé : là où le détour à vol d'oiseau est le plus court
assert.equal(J(ins(A, Bz, [[48.3, -1.7]], [48.1, -1.7], null)), J([[48.1, -1.7], [48.3, -1.7]]));
assert.equal(J(ins(A, Bz, [[48.1, -1.7]], [48.3, -1.7], null)), J([[48.1, -1.7], [48.3, -1.7]]));

// 5) aller-retour : tracés joints, parts pondérées, part du retour sur l'aller
const N = (lo, n = 21) => Array.from({ length: n }, (_, i) => [48.0 + i * .01, lo, 50]);
const out = { pts: N(-1.7), km: 22, asc: 100, bad: 0, main: .1, dirt: 0, cyc: 0 };
assert.ok(ov(out.pts, N(-1.7).reverse()) > .99);          // même route en sens inverse
assert.ok(ov(out.pts, N(-1.65).reverse()) < .01);         // route parallèle à ~3,7 km
{ const m = ov(out.pts, [...N(-1.7, 11), ...N(-1.65).slice(10)].reverse()); assert.ok(m > .38 && m < .5, m); }  // 11 km communs sur 25,7 (dont 3,7 de traversée)
const j = join(out, { pts: N(-1.65).reverse(), km: 33, asc: 50, bad: 0, main: 0, dirt: .1, cyc: 800 });
assert.equal(j.pts.length, 41); assert.equal(j.km, 55); assert.equal(j.asc, 150); assert.equal(j.cyc, 800);
assert.ok(Math.abs(j.main - .04) < 1e-9 && Math.abs(j.dirt - .06) < 1e-9 && j.ov < .01);
const R0 = { km: 55, asc: 150, dirt: 0, main: 0, cyc: 0 };
assert.match(ans(a, b, { ...R0, ov: .95 }, 0, "same"), /^Rennes ⇄ Bain &lt;b> aller-retour : <b>55.0 km<\/b>.*goudronné\. Retour par la même route\.$/);
assert.match(ans(a, b, { ...R0, ov: .1 }, 0, "other"), / Retour par d'autres routes\.$/);
assert.match(ans(a, b, { ...R0, ov: .3 }, 0, "other"), / Retour par d'autres routes sur 70 % du chemin\.$/);
assert.match(ans(a, b, { ...R0, ov: .9 }, 0, "other"), / Pas d'autre route raisonnable : le retour reprend surtout l'aller\.$/);
assert.doesNotMatch(ans(a, b, R0), /Retour|⇄/);

// 6) cache d'altitude : deux tracés aux mêmes départ, milieu et arrivée ne se confondent plus ; le sens inverse se reconnaît
const sig = win.Sortie._ignSig, T1 = [[48, -1.7], [48.1, -1.6], [48.2, -1.7], [48.3, -1.8], [48.4, -1.7]], T2 = [[48, -1.7], [48.1, -1.8], [48.2, -1.7], [48.3, -1.6], [48.4, -1.7]];
assert.notEqual(sig(T1), sig(T2));
assert.equal(sig(T1.slice().reverse(), true), sig(T1));
console.log("itineraire : ok");
