"use strict";
// Parcours au format FIT (fichier « course ») avec des points de parcours typés (eau, nourriture, toilettes…),
// pour les alertes « À venir » des GPS Garmin. Aucun numéro de série ni identifiant d'appareil n'est écrit.
(() => {
const FIT_EPOCH = 631065600;  // 31/12/1989 00:00 UTC
const ts = ms => Math.round(ms / 1000) - FIT_EPOCH;
const semi = d => Math.round(d * 2147483648 / 180);
const CRC_T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function crc(bytes, c = 0) { for (const b of bytes) { let t = CRC_T[c & 0xF]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_T[b & 0xF]; t = CRC_T[c & 0xF]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_T[(b >> 4) & 0xF]; } return c; }
// types de base : [code, taille]
const T = { enum: [0x00, 1], uint8: [0x02, 1], uint16: [0x84, 2], sint32: [0x85, 4], uint32: [0x86, 4], uint32z: [0x8C, 4] };
const COURSE_POINT = { generic: 0, summit: 1, water: 3, food: 4, danger: 5, first_aid: 9, aid_station: 28, rest_area: 29, service: 31, overlook: 38, toilet: 39, gear: 41, store: 48, info: 53 };

function writer() {
  const out = [], defs = {};
  const u8 = v => out.push(v & 0xFF), u16 = v => { u8(v); u8(v >> 8); }, u32 = v => { u16(v & 0xFFFF); u16((v >>> 16) & 0xFFFF); };
  const put = (type, v, size) => {
    if (type === "string") { const b = new TextEncoder().encode(v || ""); let n = Math.min(b.length, size - 1);
      while (n > 0 && (b[n] & 0xC0) === 0x80) n--;  // jamais au milieu d'un caractère accentué
      for (let i = 0; i < size; i++) u8(i < n ? b[i] : 0); return; }
    const sz = T[type][1]; if (sz === 1) u8(v); else if (sz === 2) u16(v); else u32(v | 0);
  };
  // fields : [[numéro, type, valeur, taille chaîne]] ; une définition par message local
  function msg(local, global, fields) {
    const key = global + ":" + fields.map(f => f[0] + "/" + f[1] + "/" + (f[3] || "")).join(",");
    if (defs[local] !== key) {
      defs[local] = key; u8(0x40 | local); u8(0); u8(0); u16(global); u8(fields.length);
      fields.forEach(([n, ty, , sz]) => { u8(n); if (ty === "string") { u8(sz); u8(0x07); } else { u8(T[ty][1]); u8(T[ty][0]); } });
    }
    u8(local); fields.forEach(([, ty, v, sz]) => put(ty, v, sz));
  }
  function done() {
    const data = Uint8Array.from(out), h = new Uint8Array(14), dv = new DataView(h.buffer);
    h[0] = 14; h[1] = 0x20; dv.setUint16(2, 2132, true); dv.setUint32(4, data.length, true); h.set([46, 70, 73, 84], 8); dv.setUint16(12, crc(h.subarray(0, 12)), true);
    const all = new Uint8Array(14 + data.length + 2); all.set(h); all.set(data, 14);
    new DataView(all.buffer).setUint16(14 + data.length, crc(all.subarray(0, 14 + data.length)), true);
    return all;
  }
  return { msg, done };
}
// recs : [{t (ms), lat, lon, alt, d (m)}] ; pts : [{t, lat, lon, d, type, name}]
function build(name, recs, pts) {
  const w = writer(), a = recs[0], z = recs[recs.length - 1];
  let up = 0, down = 0; for (let i = 1; i < recs.length; i++) { const de = recs[i].alt - recs[i - 1].alt; if (de > 0) up += de; else down -= de; }
  const alt = v => Math.max(0, Math.min(65535, Math.round((v + 500) * 5)));
  w.msg(0, 0, [[0, "enum", 6], [1, "uint16", 255], [2, "uint16", 0], [4, "uint32", ts(a.t)]]);                 // file_id : course
  w.msg(1, 31, [[4, "enum", 2], [5, "string", name, 32]]);                                                     // course : cyclisme
  w.msg(2, 19, [[253, "uint32", ts(z.t)], [2, "uint32", ts(a.t)], [3, "sint32", semi(a.lat)], [4, "sint32", semi(a.lon)], [5, "sint32", semi(z.lat)], [6, "sint32", semi(z.lon)],
    [7, "uint32", Math.round((z.t - a.t))], [8, "uint32", Math.round((z.t - a.t))], [9, "uint32", Math.round(z.d * 100)], [21, "uint16", Math.round(up)], [22, "uint16", Math.round(down)], [0, "enum", 9], [1, "enum", 1]]);  // lap
  w.msg(3, 21, [[253, "uint32", ts(a.t)], [0, "enum", 0], [1, "enum", 0], [4, "uint8", 0]]);                      // event : départ
  const P = pts.slice().sort((x, y) => x.d - y.d); let j = 0, idx = 0;
  const cp = p => w.msg(5, 32, [[254, "uint16", idx++], [1, "uint32", ts(p.t)], [2, "sint32", semi(p.lat)], [3, "sint32", semi(p.lon)], [4, "uint32", Math.round(p.d * 100)], [5, "enum", COURSE_POINT[p.type] ?? 0], [6, "string", p.name, 16]]);
  recs.forEach(r => {
    w.msg(4, 20, [[253, "uint32", ts(r.t)], [0, "sint32", semi(r.lat)], [1, "sint32", semi(r.lon)], [2, "uint16", alt(r.alt)], [5, "uint32", Math.round(r.d * 100)]]);
    while (j < P.length && P[j].d <= r.d) cp(P[j++]);  // points de parcours rangés dans l'ordre du trajet
  });
  while (j < P.length) cp(P[j++]);
  w.msg(3, 21, [[253, "uint32", ts(z.t)], [0, "enum", 0], [1, "enum", 4], [4, "uint8", 0]]);                      // event : arrêt
  return w.done();
}
window.FitCourse = { build, COURSE_POINT, _crc: crc };
})();
