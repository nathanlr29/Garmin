// Test de l'équipement du jour (equip.js) : node tests/equip.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const store = {};
const win = {}, ctx = { window: win, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
vm.createContext(ctx); vm.runInContext(readFileSync(new URL("../equip.js", import.meta.url), "utf8"), ctx);
const E = win.Equip, near = (x, y, e, m) => assert.ok(Math.abs(x - y) <= e, `${m} : ${x} ≠ ${y} (± ${e})`);

// ---- ressenti à vélo
near(E.feel(5, 0, 27), 0.3, .2, "5 °C à 27 km/h sans vent : vers 0 °C ressenti");
assert.ok(E.feel(5, 20, 27) < E.feel(5, 0, 27), "le vent refroidit");
assert.equal(E.feel(22, 30, 27), 22, "au-dessus de 20 °C : pas de refroidissement");
const steps = []; for (let t = 8; t <= 21; t += .5) steps.push(E.feel(t, 15, 27));
assert.ok(steps.every((v, i) => !i || v >= steps[i - 1]), "plus chaud dehors = jamais plus froid ressenti (continu autour de 10 et 20 °C)");

// ---- tenue
assert.equal(E.wear({ tmin: 2, wind: 10, speed: 27, bias: 0 }).level, "grand froid");
assert.equal(E.wear({ tmin: 8, wind: 10, speed: 27, bias: 0 }).level, "hiver");
assert.equal(E.wear({ tmin: 16, wind: 10, speed: 27, bias: 0 }).level, "mi-saison");
assert.equal(E.wear({ tmin: 25, wind: 10, speed: 27, bias: 0 }).level, "été");
assert.equal(E.wear({ tmin: 8, wind: 10, speed: 27, bias: 4 }).level, "grand froid", "« j'ai eu froid » deux fois : un cran plus chaud");
assert.match(E.wear({ tmin: 12, wind: 10, speed: 27, rain: 2, bias: 0 }).kit, /veste de pluie/);
assert.match(E.wear({ tmin: 8, tmax: 16, wind: 10, speed: 27, bias: 0 }).kit, /couches qui s'enlèvent/);
assert.match(E.wearLine({ tmin: 6, wind: 15, speed: 27, bias: 0 }), /ressenti -?\d+ °C à 27 km\/h pour 6 °C au thermomètre/, "un repère : le thermomètre");
assert.equal(E.bias(), 0); E.setBias(true); E.setBias(true); E.setBias(true); E.setBias(true); assert.equal(E.bias(), 6, "borné à +6");
for (let i = 0; i < 3; i++) E.setBias(false); assert.equal(E.bias(), 0); assert.equal(store.kitBias, "null", "revenu à 0 : rien de gardé");

// ---- pneus (Berto 15 %, ajusté) : 32 mm, 150 lb sur la roue ≈ 87 psi (exemple de la source)
const w = 150 / 2.20462 / .55 - 9.5;   // poids qui met 150 lb sur l'arrière
near(E.tyres(w, 32).rear, 87 / 14.5038, .06, "exemple de la source");
const p = E.tyres(77, 28);
assert.ok(p.rear > p.front, "plus à l'arrière"); near(p.rear, 5.3, .1, "77 kg en 28 mm"); near(p.front, 4.3, .1, "77 kg en 28 mm, avant");
assert.ok(E.tyres(77, 25).rear > p.rear && E.tyres(77, 32).rear < p.rear, "pneu plus large = moins de pression");
near(E.tyres(77, 28, true).rear, p.rear - .3, .051, "route mouillée : −0,3 bar");
assert.match(E.tyreLine(0, 28, false), /75 kg \(règle ton poids dans le Plan\)/);
assert.equal(E.tyreWidth(), 28); store.tyreW = "32"; assert.equal(E.tyreWidth(), 32); store.tyreW = "40"; assert.equal(E.tyreWidth(), 28, "largeur inconnue : 28");

console.log("equip : OK");
