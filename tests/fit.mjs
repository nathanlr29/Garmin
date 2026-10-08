// Test du parcours FIT (points de parcours pour les alertes Garmin) : node tests/fit.mjs
// Vérification complète possible avec le SDK officiel : pip install garmin-fit-sdk (voir CLAUDE.md).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = {}, ctx = { window: win, TextEncoder };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../fitcourse.js", import.meta.url), "utf8"), ctx);
const F = win.FitCourse, t0 = Date.UTC(2026, 9, 10, 7, 0);
const recs = Array.from({ length: 401 }, (_, k) => ({ t: t0 + k * 3600, lat: 48.1 + k * 25 / 111320, lon: -1.68, alt: 50 + (k % 40), d: k * 25 }));
const pts = [{ t: recs[200].t, lat: recs[200].lat, lon: recs[200].lon, d: 5000, type: "water", name: "Eau cimetière" }, { t: recs[300].t, lat: recs[300].lat, lon: recs[300].lon, d: 7500, type: "food", name: "Boulangerie très longue" }];
const b = F.build("Boucle d'essai", recs, pts), dv = new DataView(b.buffer);
assert.equal(b[0], 14); assert.equal(String.fromCharCode(...b.slice(8, 12)), ".FIT");
assert.equal(dv.getUint32(4, true), b.length - 16, "taille des données");
assert.equal(F._crc(b.subarray(0, 12)), dv.getUint16(12, true), "CRC de l'en-tête");
assert.equal(F._crc(b), 0, "CRC du fichier");
// lecture minimale : on compte les messages par numéro global et on relit les points de parcours
const defs = {}, count = {}, cps = []; let i = 14;
while (i < b.length - 2) {
  const h = b[i++], local = h & 15;
  if (h & 0x40) { const g = dv.getUint16(i + 2, true), n = b[i + 4], f = []; for (let k = 0; k < n; k++) f.push([b[i + 5 + 3 * k], b[i + 6 + 3 * k]]); defs[local] = { g, f }; i += 5 + 3 * n; continue; }
  const d = defs[local], o = {}; let j = i;
  d.f.forEach(([num, sz]) => { o[num] = b.slice(j, j + sz); j += sz; }); i = j;
  count[d.g] = (count[d.g] || 0) + 1;
  if (d.g === 32) cps.push({ type: o[5][0], dist: new DataView(o[4].buffer, o[4].byteOffset).getUint32(0, true) / 100, name: new TextDecoder().decode(o[6]).replace(/\0+$/, "") });
}
assert.deepEqual([count[0], count[31], count[19], count[21], count[20], count[32]], [1, 1, 1, 2, 401, 2], "file_id, course, lap, 2 events, records, course points");
assert.deepEqual(cps.map(c => c.type), [3, 4], "types eau (3) et nourriture (4)");
assert.equal(cps[0].name, "Eau cimetière"); assert.equal(cps[0].dist, 5000);
assert.ok(new TextEncoder().encode(cps[1].name).length <= 15, "nom tronqué à 15 octets");
console.log("OK : parcours FIT valide (CRC, messages, points de parcours typés).");
