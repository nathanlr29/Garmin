// Test du ravitaillement de la carte Nutrition (onglet Sortie) : node tests/nutrition.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = { addEventListener() {} }, ctx = { nf: (v, d = 0) => (+v).toFixed(d), window: win, document: { addEventListener() {} }, addEventListener() {}, innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../sortie.js", import.meta.url), "utf8"), ctx);
const { _nutSuggest: sug, _nutSchedule: sched, _nutG: G, _nutAnswer: ans } = win.Sortie;
const pocket = c => c.pate + c.gel;

// 1) sortie de 2 h 30 à 45 g/h (≈ 113 g) : le bidon suffit, rien en poche
let c = sug(113, { h: 2.5, shop: false, refills: 0 });
assert.equal(c.pow, 120); assert.equal(pocket(c), 0); assert.ok(G(c) >= 113);
assert.match(ans(c, 113, null), /^✓/);

// 2) 5 h 43 à 60 g/h (344 g, la sortie de la capture) : 140 g de poudre au plus, 6 produits en poche au plus, le reste au ravito
c = sug(344, { h: 5.7, shop: true, refills: 1 });
assert.equal(c.pow, 140, "jamais plus de 140 g de poudre");
assert.ok(pocket(c) <= 6, "6 produits en poche au plus");
assert.equal(c.sach, 0, "pas de sachet à emporter hors ultra");
assert.ok(G(c) >= 334, `objectif couvert (${G(c)} g)`);
// pâtes de fruits tant que ça suffit : pas un gel de trop
assert.ok(G({ ...c, gel: c.gel - 1, pate: c.pate + 1 }) < 334 || c.gel === 0);

// 3) 5 h 50 à 75 g/h (440 g) : avec un commerce, achats au ravito ; sans commerce, il manque des glucides et la phrase le dit
c = sug(440, { h: 5.8, shop: true, refills: 1 });
assert.equal(pocket(c), 6); assert.ok(c.coca + c.pain > 0 && G(c) >= 430);
c = sug(440, { h: 5.8, shop: false, refills: 1 });
assert.ok(pocket(c) <= 6 && c.coca + c.pain + c.ban === 0);
assert.ok(G(c) < 430); assert.match(ans(c, 440, null), /il manque \d+ g/);

// 4) ultra (10 h à 75 g/h) : poches pleines, achats au ravito, puis sachets pour les remplissages
c = sug(750, { h: 10, shop: true, refills: 3 });
assert.equal(pocket(c), 6); assert.ok(c.sach > 0 && c.sach <= 3);

// 5) déroulé : pâtes de fruits d'abord, gels à la fin, de 40 min à 20 min de l'arrivée
const S = sched({ pow: 140, pate: 2, gel: 3 }, 5);
assert.equal(S.map(e => e.id).join(), "pate,pate,gel,gel,gel");
assert.equal(S[0].m, 40); assert.equal(S[S.length - 1].m, 280);

// 6) poches trop pleines : la phrase prévient
assert.match(ans({ pow: 140, pate: 4, gel: 4, sach: 0, coca: 0, pain: 0, ban: 0 }, 300, null), /8 produits en poche/);
console.log("OK : bidon plafonné à 140 g, 6 produits en poche, achats au ravito, sachets seulement en ultra.");
