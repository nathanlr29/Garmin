// Test de l'indice de confiance du vent (onglet Sortie) : node tests/vent.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = { addEventListener() {} }, ctx = { nf: (v, d = 0) => (+v).toFixed(d), window: win, document: { addEventListener() {} }, addEventListener() {}, innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../sortie.js", import.meta.url), "utf8"), ctx);
const { _windAgree: agree, _altAt: altAt } = win.Sortie;
const M = (ws, wd) => [{ name: "Météo-France", ws, wd }, { name: "le modèle européen", ws: ws + 2, wd: wd + 10 }, { name: "le modèle américain", ws: ws - 1, wd: wd - 5 }];

// 1) trois modèles d'accord : fiable
let c = agree(M(20, 270));
assert.equal(c.lvl, "ok"); assert.match(c.txt, /^Prévision de vent fiable : Météo-France, le modèle européen et le modèle américain sont d'accord \(vent venant de l'ouest, 19 à 22 km\/h\)/);
// 2) 8 km/h d'écart : à confirmer ; 25 km/h contre 10 : incertaine, avec la fourchette
c = agree([{ name: "Météo-France", ws: 20, wd: 270 }, { name: "a", ws: 28, wd: 280 }, { name: "b", ws: 21, wd: 265 }]);
assert.equal(c.lvl, "mid"); assert.match(c.txt, /^Prévision de vent à confirmer : les modèles annoncent 20 à 28 km\/h\. Revérifie la veille ou le matin\.$/);
c = agree([{ name: "Météo-France", ws: 25, wd: 270 }, { name: "a", ws: 12, wd: 200 }, { name: "b", ws: 22, wd: 260 }]);
assert.equal(c.lvl, "low"); assert.match(c.txt, /incertaine : les modèles annoncent 12 à 25 km\/h, et hésitent entre .* et .*, le choix du sens peut changer\.$/);
// 3) direction opposée à vitesse égale : incertaine (le sens de la boucle s'inverse)
assert.equal(agree([{ name: "Météo-France", ws: 18, wd: 270 }, { name: "a", ws: 18, wd: 90 }]).lvl, "low");
// 4) passage par le nord (350° et 10° = 20° d'écart) : fiable
assert.equal(agree([{ name: "Météo-France", ws: 18, wd: 350 }, { name: "a", ws: 19, wd: 10 }]).lvl, "ok");
// 5) vent faible partout : la direction ne compte pas
c = agree([{ name: "Météo-France", ws: 6, wd: 0 }, { name: "a", ws: 8, wd: 180 }]);
assert.equal(c.lvl, "ok"); assert.match(c.txt, /^Vent faible selon les trois modèles/);
// 6) un seul modèle disponible : pas d'indice
assert.equal(agree([{ name: "Météo-France", ws: 20, wd: 270 }, null]), null);
// 7) interpolation d'un modèle : vent vectoriel entre deux heures, rien hors échéance ou valeur manquante
const a = { t0: 0, nH: 3, m: [{ ws: [10, 20, null], wd: [350, 10, 0] }] };
const x = altAt(a, 0, 1800e3); assert.equal(x.ws, 15); assert.ok(Math.abs(Math.atan2(x.U, x.V)) < .1, "toujours plein nord (entre 350° et 10°)");
assert.equal(altAt(a, 0, 5400e3), null, "valeur manquante"); assert.equal(altAt(a, 0, -1), null);
console.log("OK : indice de confiance du vent (accord, à confirmer, incertain, opposé, nord, vent faible, interpolation).");
