// Bilan de séance : blocs durs repérés et comparés (design v2). node tests/blocs.mjs
import fs from "fs"; import vm from "vm"; import assert from "assert";
const read = f => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const win = {}, ctx = { window: win, document: { addEventListener() {}, getElementById() { return null; } }, S: { all: [] }, RIDE_TYPES: new Set(["VirtualRide"]), console,
  localStorage: { getItem: () => null }, nf: (v, d = 0) => v.toFixed(d).replace(".", ","), esc: s => s, pad: n => String(n).padStart(2, "0"), hideTip() {}, showTip() {} };
vm.createContext(ctx); vm.runInContext(read("../bilan.js"), ctx);
const B = win.Bilan._blocks;
// séance synthétique, 1 point par seconde : 10 min à 150 W, 3 × (8 min à 200 W, 4 min à 110 W), 10 min à 140 W ; FTP 230
const p = [], h = []; const add = (sec, w, hr) => { for (let i = 0; i < sec; i++) { p.push(w); h.push(hr); } };
add(600, 150, 120); [150, 152, 160].forEach(hr => { add(480, 200, hr); add(240, 110, 125); }); add(600, 140, 118);
const st = { dt: 1, n: p.length, p, h };
const b = B.blocks(st, 230);
assert.equal(b.length, 3, JSON.stringify(b.map(x => x.d)));
b.forEach(x => { assert.ok(Math.abs(x.d - 480) <= 10, "durée ≈ 8 min : " + x.d); assert.ok(Math.abs(x.w - 200) < 3); });
assert.match(B.blocksAnswer(b), /3 blocs réguliers à 200 W/); assert.match(B.blocksAnswer(b), /de plus par watt/);
// 30/15 (30 s à 265 W, 15 s à 115 W) × 10 : une seule série = un bloc
const q = []; for (let i = 0; i < 300; i++) q.push(100); for (let r = 0; r < 10; r++) { for (let i = 0; i < 30; i++) q.push(265); for (let i = 0; i < 15; i++) q.push(115); } for (let i = 0; i < 300; i++) q.push(100);
assert.equal(B.blocks({ dt: 1, n: q.length, p: q }, 230).length, 1);
// endurance à 67 % : aucun bloc ; pas de puissance : rien
const e = Array(3600).fill(155); assert.equal(B.blocks({ dt: 1, n: e.length, p: e }, 230).length, 0);
assert.equal(B.blocks({ dt: 1, n: 10, h: Array(10).fill(120) }, 230).length, 0);
assert.equal(B.blocksHtml(b.slice(0, 1)), "", "un seul bloc : rien à comparer");
console.log("blocs : tous les tests passent");
