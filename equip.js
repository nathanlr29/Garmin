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

// Pression des pneus : formule « 15 % d'écrasement » de Frank Berto, ajustée par un lecteur de Bike Forums
// (P psi = 600 L / W² + 0,75 W − 25, L = charge sur la roue en livres, W = largeur en mm ; route, à ±2 psi du tableau de Berto).
// Répartition 45 % avant / 55 % arrière, route mouillée −0,3 bar.
const TYRE = { front: .45, rear: .55, wet: .3, widths: [25, 28, 30, 32], def: 28, key: "tyreW", bike: 9.5, kg: 75, psi: 14.5038 };
const tyreWidth = () => { const w = +ls.get(TYRE.key); return TYRE.widths.includes(w) ? w : TYRE.def; };
function tyres(kg, width = TYRE.def, wet = false, bike = TYRE.bike) {
  const lb = (kg + bike) * 2.20462, P = part => 600 * lb * part / width ** 2 + .75 * width - 25;
  const bar = psi => Math.round(clamp(psi / TYRE.psi - (wet ? TYRE.wet : 0), 2, 8.5) * 10) / 10;
  return { front: bar(P(TYRE.front)), rear: bar(P(TYRE.rear)) };
}
const nf1 = v => String(v.toFixed(1)).replace(".", ",");
function tyreLine(kg, width, wet) {
  const own = kg >= 35, p = tyres(own ? kg : TYRE.kg, width, wet);
  return `${nf1(p.front)} bar à l'avant, ${nf1(p.rear)} à l'arrière en ${width} mm${wet ? " (route mouillée : 0,3 bar de moins)" : ""}, pour ${own ? `${Math.round(kg)} kg` : `${TYRE.kg} kg (règle ton poids dans le Plan)`} et le vélo.`;
}

window.Equip = { feel, wear, wearLine, bias, setBias, tyres, tyreLine, tyreWidth, KIT, TYRE, BIAS };
})();
