// Sonde réseau temporaire : le vrai fetchPois d'arrets.js contre les vrais serveurs Overpass.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {}, log = [];
const ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: v => String(v), esc: s => String(s), setTimeout, clearTimeout, AbortController, console,
  fetch: async (url, o) => { const t = Date.now(); try { const r = await fetch(url, { ...o, headers: { ...o.headers, "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" } });
      const x = await r.text(); let rem = ""; try { rem = JSON.parse(x).remark || ""; } catch (e) { rem = x.slice(0, 80); }
      log.push(`${url.split("/")[2]} ${r.status} ${Date.now() - t} ms ${rem}`); return { ok: r.ok, status: r.status, json: async () => JSON.parse(x) }; }
    catch (e) { log.push(`${url.split("/")[2]} ERREUR ${Date.now() - t} ms ${e.name}`); throw e; } } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets, R = JSON.parse(readFileSync(new URL("../data/routes.json", import.meta.url)));
const rad = x => x * Math.PI / 180, dist = (a, b) => 6371e3 * Math.hypot(rad(b[0] - a[0]), rad(b[1] - a[1]) * Math.cos(rad(a[0])));
const toP = pts => { let d = 0; return pts.map((p, i) => ({ lat: p[0], lon: p[1], d: d += i ? dist(pts[i - 1], p) : 0 })); };
const routes = Object.values(R).filter(Boolean).map(toP).sort((a, b) => b.at(-1).d - a.at(-1).d);
let ko = 0;
for (const P of [routes[0], routes.find(p => p.at(-1).d < 130e3), routes.find(p => p.at(-1).d < 90e3)]) for (const voir of [false, true]) {
  const L = A._corridor(P, voir ? 300 : 200); log.length = 0; const t = Date.now();
  try { const els = await A._fetchPois(L, voir); console.log(`${Math.round(P.at(-1).d / 1000)} km, à voir=${voir}, ${L.split("|").length} rectangles : OK en ${Date.now() - t} ms, ${els.length} points`); }
  catch (e) { ko++; console.log(`${Math.round(P.at(-1).d / 1000)} km, à voir=${voir} : ÉCHEC en ${Date.now() - t} ms ${e.message}`); }
  log.forEach(l => console.log("   " + l));
}
// vrai navigateur sur le site en ligne, avec le nouvel arrets.js injecté
{ const { chromium } = await import("playwright");
  const b = await chromium.launch(), pg = await (await b.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" })).newPage();
  await pg.goto("https://nathanlr29.github.io/Garmin/"); await pg.addScriptTag({ content: readFileSync(new URL("../arrets.js", import.meta.url), "utf8") });
  for (const P of [routes.find(p => p.at(-1).d < 130e3), routes[0]]) {
    const L = A._corridor(P, 300), t = Date.now();
    const r = await pg.evaluate(L => Arrets._fetchPois(L, true).then(e => "OK " + e.length + " points", e => "ÉCHEC " + e.message), L);
    if (!r.startsWith("OK")) ko++; console.log(`navigateur, ${Math.round(P.at(-1).d / 1000)} km avec « À voir » : ${r} en ${Date.now() - t} ms`); }
  await b.close(); }
process.exit(ko ? 1 : 0);
