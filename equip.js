"use strict";
// Équipement du jour : tenue selon le froid ressenti à vélo, et pression des pneus.
// Fonctions pures, utilisées par l'onglet Sortie (carte Pratique) et la Synthèse (« Ce week-end, dehors ? »).
// Test : node tests/equip.mjs
(() => {
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

// Froid ressenti à vélo : refroidissement éolien (formule d'Environnement Canada) avec l'air relatif = ta vitesse + la moitié du vent
// (de face sur une moitié de la sortie, de dos sur l'autre). Pleinement compté à 10 °C et moins, plus du tout à 20 °C.
const WC = { full: 10, none: 20, windPart: .5 };
const chill = (t, v) => 13.12 + .6215 * t - 11.37 * v ** .16 + .3965 * t * v ** .16;
function feel(t, wind = 0, speed = 27) {
  const v = Math.max(5, speed + WC.windPart * wind);
  if (t >= WC.none) return t;
  const tc = Math.min(t, WC.full), drop = tc - chill(tc, v);
  return t - drop * (t > WC.full ? (WC.none - t) / (WC.none - WC.full) : 1);
}
// paliers de tenue, sur le ressenti corrigé par ton réglage (« j'ai eu froid » / « j'ai eu trop chaud »)
const KIT = [
  [-99, "grand froid", "collant d'hiver, maillot thermique et veste d'hiver, gants d'hiver épais, couvre-chaussures, cagoule ou bonnet sous le casque"],
  [0, "hiver", "collant long, veste thermique, gants longs d'hiver, couvre-chaussures, cache-cou"],
  [5, "frais", "collant long ou jambières, maillot manches longues et coupe-vent, gants longs fins, couvre-chaussures légers"],
  [10, "mi-saison", "jambières ou genouillères, manchettes, gilet coupe-vent"],
  [15, "doux", "cuissard court, manchettes au départ, gilet dans la poche"],
  [20, "été", "tenue d'été"],
];
const BIAS = { key: "kitBias", step: 2, max: 6 };   // +2 °C de tenue plus chaude par « j'ai eu froid »
const bias = () => { const b = +ls.get(BIAS.key); return isFinite(b) ? clamp(b, -BIAS.max, BIAS.max) : 0; };
function setBias(cold) { const b = clamp(bias() + (cold ? BIAS.step : -BIAS.step), -BIAS.max, BIAS.max); ls.set(BIAS.key, b || null); return b; }

// o = { tmin, tmax, wind, speed, rain (mm), pp (risque %), bias }
function wear(o) {
  const f = feel(o.tmin, o.wind, o.speed), b = o.bias ?? bias(), x = f - b;
  let k = 0; for (let i = 0; i < KIT.length; i++) if (x >= KIT[i][0]) k = i;
  const wet = (o.rain ?? 0) >= .5 || (o.pp ?? 0) >= 50, warm = o.tmax != null && o.tmax - o.tmin >= 6;
  const kit = KIT[k][2] + (wet ? ", veste de pluie et garde-boue" : "") + (warm && k < KIT.length - 1 ? ` ; il fera ${Math.round(o.tmax - o.tmin)} °C de plus au plus chaud : des couches qui s'enlèvent` : "");
  return { feel: f, level: KIT[k][1], k, wet, kit: kit.charAt(0).toUpperCase() + kit.slice(1) + "." };
}
// phrase avec son repère : ce que tu ressens à vélo comparé au thermomètre
function wearLine(o) {
  const w = wear(o), r = Math.round(w.feel), t = Math.round(o.tmin), b = o.bias ?? bias();
  const why = r < t ? `ressenti ${r} °C à ${Math.round(o.speed)} km/h pour ${t} °C au thermomètre` : `${t} °C au plus frais`;
  const lvl = w.level.charAt(0).toUpperCase() + w.level.slice(1);
  return `${lvl} (${why}${b ? `, réglé ${b > 0 ? "plus chaud" : "plus léger"} pour toi` : ""}) : ${w.kit.charAt(0).toLowerCase()}${w.kit.slice(1)}`;
}

// Pression des pneus : méthode du calculateur Legend Wheels (demande de Nathan du 06/11/2026, legendwheels.com/calculateur-pression-pneu-velo,
// pratique « route », lue dans le code de la page) : grille de pression arrière en tubeless selon le poids total (cycliste + vélo − 9 kg)
// et la largeur réelle du pneu monté, interpolée ; largeur réelle = inscrite + 0,4 mm par mm de jante au-delà de 21 mm interne (jante
// inconnue = 21 mm : largeur inscrite) ; route mouillée −7 % (0,4 bar au plus) ; chambre butyle +0,3 bar (marge contre le pincement) ;
// plafond du pneu ; avant = 95 % de l'arrière (0,3 bar d'écart au plus) ; arrondi au dixième inférieur.
// Nathan : 32 mm, chambre butyle, vélo + bidons ≈ 10 kg, poids = dernière pesée Garmin. Puis réglage perso « plus / moins gonflé »
// par crans de 0,2 bar (tyrePBias, ±0,6, propre à l'appareil). Remplace la formule de Berto (avant trop bas : 3,3 bar contre 4,2 roulés).
const TYRE = { widths: [25, 28, 30, 32], def: 32, key: "tyreMm", mount: .3, tube: true, bike: 10, kg: 75, rim: 21, offset: 9, frontK: .95, gap: .3, floor: 2,
  grid: { 50: [3.4, 3.2, 3, 2.8], 60: [3.8, 3.6, 3.3, 3.2], 70: [4.2, 3.9, 3.7, 3.5], 80: [4.5, 4.3, 4, 3.8], 90: [4.8, 4.6, 4.3, 4], 100: [5, 4.7, 4.3, 4] },
  gridReal: [30.5, 31.5, 33.8, 35] };
const capOf = w => w <= 25 ? 7 : w <= 28 ? 6.5 : w <= 32 ? 6 : 5;     // plafond du pneu (repère Legend, jante à crochets)
const realW = (w, rim = TYRE.rim) => Math.round(10 * (w + .4 * (rim - (w < 30 ? 19 : 21)))) / 10;
function gridAt(kg, i) {     // colonne i de la grille au poids kg (prolongée au-delà de 50 et 100 kg)
  const G = TYRE.grid;
  if (kg <= 50) return G[50][i] + (kg - 50) * (G[60][i] - G[50][i]) / 10;
  if (kg >= 100) return G[100][i] + (kg - 100) * Math.max((G[100][i] - G[90][i]) / 10, 0);
  const lo = Math.floor(kg / 10) * 10, hi = Math.min(100, lo + 10);
  return G[lo][i] + (G[hi][i] - G[lo][i]) * (kg - lo) / 10;
}
function baseRear(kg, real) {
  const R = TYRE.gridReal, n = R.length, col = R.map((_, i) => gridAt(kg, i));
  if (real >= R[0] && real <= R[n - 1]) for (let i = 0; i < n - 1; i++) if (real <= R[i + 1] + 1e-9) return col[i] + (col[i + 1] - col[i]) * (real - R[i]) / (R[i + 1] - R[i]);
  const s = clamp(Math.log(col[0] / col[n - 1]) / Math.log(R[n - 1] / R[0]), .8, 1.6);
  return real < R[0] ? col[0] * (R[0] / real) ** s : col[n - 1] * (R[n - 1] / real) ** s;
}
const PB = { key: "tyrePBias", step: .2, max: .6 };
const pbias = () => { const b = +ls.get(PB.key); return isFinite(b) ? clamp(Math.round(b * 10) / 10, -PB.max, PB.max) : 0; };
function setPBias(up) { const b = clamp(Math.round((pbias() + (up ? PB.step : -PB.step)) * 10) / 10, -PB.max, PB.max); ls.set(PB.key, b || null); return b; }
const tyreWidth = () => { const w = +ls.get(TYRE.key); return TYRE.widths.includes(w) ? w : TYRE.def; };
function tyres(kg, width = TYRE.def, wet = false, bike = TYRE.bike, bias = pbias()) {
  let u = baseRear(kg + bike - TYRE.offset, realW(width));
  if (wet) u -= Math.min(.07 * u, .4);
  if (TYRE.tube) u += TYRE.mount;
  u = clamp(u, TYRE.floor, capOf(width));
  let f = u * TYRE.frontK; if (u - f > TYRE.gap) f = u - TYRE.gap;
  const bar = v => Math.round(clamp(Math.floor(10 * v + .2) / 10 + bias, TYRE.floor, 8) * 10) / 10;
  return { front: bar(f), rear: bar(u) };
}
const nf1 = v => String(v.toFixed(1)).replace(".", ",");
function tyreLine(kg, width, wet, bias = pbias()) {
  const own = kg >= 35, p = tyres(own ? kg : TYRE.kg, width, wet, TYRE.bike, bias);
  return `${nf1(p.front)} bar à l'avant, ${nf1(p.rear)} à l'arrière en ${width} mm${TYRE.tube ? " avec chambre à air" : ""}${wet ? " (route mouillée : 7 % de moins)" : ""}, pour ${own ? `${nf1(kg)} kg` : `${TYRE.kg} kg (pèse-toi dans Garmin ou règle ton poids dans le Plan)`} et ${TYRE.bike} kg de vélo avec bidons${bias ? `, réglé ${bias > 0 ? "+" : "−"}${nf1(Math.abs(bias))} bar pour toi` : ""}.`;
}

window.Equip = { feel, wear, wearLine, bias, setBias, tyres, tyreLine, tyreWidth, baseRear, realW, pbias, setPBias, KIT, TYRE, BIAS, PB };
})();
