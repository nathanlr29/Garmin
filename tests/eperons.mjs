// Test des allers-retours (éperons) du générateur de boucles : node tests/eperons.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const win = { addEventListener() {} }, ctx = { window: win, document: { addEventListener() {} }, addEventListener() {}, innerWidth: 1280, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../sortie.js", import.meta.url), "utf8"), ctx);
const { _spurs: spurs, _cutSpurs: cutSpurs, _dbl: dbl } = win.Sortie;

// géométrie locale autour de Rennes : pas de 20 m le long d'un cap
const R = 6371e3, rad = x => x * Math.PI / 180;
const move = ([la, lo], b, m) => [la + m * Math.cos(rad(b)) / R * 180 / Math.PI, lo + m * Math.sin(rad(b)) / (R * Math.cos(rad(la))) * 180 / Math.PI];
const leg = (pts, b, m) => { let p = pts[pts.length - 1]; for (let d = 20; d <= m; d += 20) { p = move(p, b, 20); pts.push([...p, 50]); } return pts; };
const km = pts => { let L = 0; for (let i = 1; i < pts.length; i++) { const [a, b] = [pts[i - 1], pts[i]], dy = (b[0] - a[0]) * 111320, dx = (b[1] - a[1]) * 111320 * Math.cos(rad(a[0])); L += Math.hypot(dx, dy); } return L / 1000; };

// boucle carrée de ~25 km : départ par une route de 1,5 km reprise au retour (toléré), éperon de 600 m au milieu du côté nord
const build = withSpur => {
  const P = [[48.1173, -1.6778, 50]];
  leg(P, 0, 1500); leg(P, 0, 5500); leg(P, 90, 3500);
  if (withSpur) { leg(P, 0, 600); leg(P, 180, 600); }  // impasse au nord : aller-retour de 600 m
  leg(P, 90, 3500); leg(P, 180, 5500); leg(P, 270, 7000); leg(P, 180, 1500);  // retour par la route de départ
  return P;
};
const plain = build(false), spur = build(true);

// 1) détection
const S = spurs(spur);
assert.equal(S.length, 1, "un seul éperon détecté");
assert.ok(S[0].len > 1000 && S[0].len < 1300, `longueur de l'éperon ≈ 1,2 km (${Math.round(S[0].len)} m)`);
const tipExp = spur[75 + 275 + 175 + 30];  // bout de l'impasse
assert.ok(Math.hypot((S[0].tip[0] - tipExp[0]) * 111320, (S[0].tip[1] - tipExp[1]) * 74000) < 80, "bout de l'éperon au bon endroit");
assert.equal(spurs(plain).length, 0, "pas d'éperon sur la boucle propre (le retour par la route de départ est toléré)");
assert.ok(dbl(plain) < .005, `boucle propre : pas de double (${dbl(plain)})`);
assert.ok(dbl(spur) > .015, `boucle à éperon : ≈ 2 % en double (${dbl(spur)})`);

// 2) coupure
const c = cutSpurs(spur);
assert.equal(spurs(c.pts).length, 0, "plus d'éperon après coupure");
assert.ok(dbl(c.pts) < .03, `moins de 3 % en double après coupure (${dbl(c.pts)})`);
const gone = km(spur) - km(c.pts);
assert.ok(gone > 1.1 && gone < 1.3, `≈ 1,2 km retirés (${gone.toFixed(2)})`);
assert.ok(Math.abs(km(c.pts) - km(plain)) < .06, "même distance que la boucle propre");

// 3) une boucle propre n'est pas touchée
assert.equal(cutSpurs(plain).pts.length, plain.length, "boucle propre inchangée");
// 4) cas réaliste : retour décalé de 8 m (autre côté de la route) et points espacés irrégulièrement
const noisy = spur.map((p, i) => i > 525 + 30 && i < 525 + 60 ? [...move(p, 90, 8), 50] : p).filter((_, i) => i % 3 !== 1);
assert.equal(spurs(noisy).length, 1, "éperon détecté malgré le décalage");
assert.equal(spurs(cutSpurs(noisy).pts).length, 0, "et supprimé");
console.log("OK : éperon détecté puis supprimé, départ toléré, boucle propre intacte.");
