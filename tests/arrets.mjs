// Test des points d'arrêt (horaires OSM, arrêts conseillés) : node tests/arrets.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = {}, ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: (v, d = 0) => (+v).toFixed(d).replace(".", ","), esc: s => String(s) };
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
console.log("OK : horaires lus, arrêts conseillés cohérents.");
