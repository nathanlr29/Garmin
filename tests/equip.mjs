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

// ---- pneus (méthode du calculateur Legend Wheels, route)
near(E.baseRear(70 + 8 - 9, 30.5), 4.16, .01, "exemple par défaut de Legend : 70 kg + 8 kg, 28 mm sur leur jante (30,5 mm réels)");
const lg = E.baseRear(69, 30.5); assert.equal(Math.floor(10 * lg + .2) / 10, 4.1); assert.equal(Math.floor(10 * lg * .95 + .2) / 10, 3.9, "affiché par Legend : 3,9 / 4,1");
assert.equal(E.realW(32), 32, "jante inconnue (21 mm) : largeur inscrite"); assert.equal(E.realW(28, 24.5), 30.2);
const p = E.tyres(75.2, 32);
assert.deepEqual([p.front, p.rear], [4.1, 4.4], "Nathan : 75,2 kg + 10 kg de vélo, 32 mm, chambre butyle (il roule à 4,2 / 4,5)");
assert.ok(E.tyres(75.2, 28).rear > p.rear && E.tyres(75.2, 25).rear > E.tyres(75.2, 28).rear, "pneu plus étroit = plus de pression");
assert.ok(E.tyres(85, 32).rear > p.rear && E.tyres(65, 32).rear < p.rear, "plus lourd = plus de pression");
assert.ok(p.rear - p.front <= .3 + 1e-9 && p.front < p.rear, "avant à 95 % de l'arrière, 0,3 bar d'écart au plus");
const w = E.tyres(75.2, 32, true); assert.deepEqual([w.front, w.rear], [3.9, 4.1], "route mouillée : −7 %");
assert.match(E.tyreLine(75.2, 32, false), /^4,1 bar à l'avant, 4,4 à l'arrière en 32 mm avec chambre à air, pour 75,2 kg et 10 kg de vélo avec bidons\.$/);
assert.match(E.tyreLine(0, 28, false), /75 kg \(pèse-toi dans Garmin/);
assert.equal(E.tyreWidth(), 32, "32 mm par défaut"); store.tyreW = "28"; assert.equal(E.tyreWidth(), 32, "ancienne clé ignorée");
store.tyreMm = "28"; assert.equal(E.tyreWidth(), 28); store.tyreMm = "40"; assert.equal(E.tyreWidth(), 32, "largeur inconnue : 32"); delete store.tyreMm;

// ---- réglage perso « plus / moins gonflé »
E.setPBias(true); E.setPBias(true); assert.equal(E.pbias(), .4); near(E.tyres(75.2, 32).rear, 4.8, .051, "+0,4 bar");
assert.match(E.tyreLine(75.2, 32, false), /réglé \+0,4 bar pour toi\.$/);
for (let i = 0; i < 6; i++) E.setPBias(true); assert.equal(E.pbias(), .6, "borné à +0,6");
for (let i = 0; i < 3; i++) E.setPBias(false); assert.equal(E.pbias(), 0); assert.equal(store.tyrePBias, "null", "revenu à 0 : rien de gardé");
console.log("equip : OK");
