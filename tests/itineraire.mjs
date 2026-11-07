// Test de « Départ → Arrivée » (onglet Sortie) : node tests/itineraire.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = { addEventListener() {} }, esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ctx = { nf: (v, d = 0) => (+v).toFixed(d), esc, window: win, document: { addEventListener() {} }, addEventListener() {}, innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../sortie.js", import.meta.url), "utf8"), ctx);
const { _brf: B, _brfStrict: S, _abShort: short, _abAnswer: ans } = win.Sortie;

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
assert.match(ans(null, null, null), /^Tape un départ et une arrivée : l'itinéraire passe uniquement par des routes goudronnées/);
const a = { label: "Rennes" }, b = { label: "Bain <b>" };
assert.equal(ans(a, b, { km: 39.73, asc: 212, dirt: 0, main: 0, cyc: 0 }), "Rennes → Bain &lt;b> : <b>39.7 km</b> et <b>212 m D+</b> par les petites routes, tout goudronné.");
assert.match(ans(a, b, { km: 40, asc: 200, dirt: .02, main: .08, cyc: 1200 }), /2 % sans revêtement connu \(aucune autre route possible\), 8 % sur route principale, 1.2 km de piste cyclable goudronnée\.$/);
console.log("itineraire : ok");
