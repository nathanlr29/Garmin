// Sonde réseau temporaire : le vrai fetchPois d'arrets.js contre les vrais serveurs Overpass.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {}, log = [], H = { "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" };
const ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: v => String(v), esc: s => String(s), setTimeout, clearTimeout, AbortController, console,
  fetch: async (url, o) => { const t = Date.now(); try { const r = await fetch(url, { ...o, headers: { ...o.headers, ...H } });
      const x = await r.text(); let rem = ""; try { rem = JSON.parse(x).remark || ""; } catch (e) { rem = x.slice(0, 40).replace(/\s+/g, " "); }
      log.push(`${url.split("/")[2]} ${r.status} ${Date.now() - t} ms ${rem}`); return { ok: r.ok, status: r.status, json: async () => JSON.parse(x) }; }
    catch (e) { log.push(`${url.split("/")[2]} ERREUR ${Date.now() - t} ms ${e.name}`); throw e; } } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets, R = JSON.parse(readFileSync(new URL("../data/routes.json", import.meta.url)));
const rad = x => x * Math.PI / 180, dist = (a, b) => 6371e3 * Math.hypot(rad(b[0] - a[0]), rad(b[1] - a[1]) * Math.cos(rad(a[0])));
const toP = pts => { let d = 0; return pts.map((p, i) => ({ lat: p[0], lon: p[1], d: d += i ? dist(pts[i - 1], p) : 0 })); };
const routes = Object.values(R).filter(Boolean).map(toP).sort((a, b) => b.at(-1).d - a.at(-1).d);
for (const u of ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.osm.jp/api/interpreter"]) { const t = Date.now();
  try { const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent('[out:json][timeout:25];nwr["amenity"="drinking_water"](48.0,-1.8,48.2,-1.6);out tags center qt;'), headers: { ...H, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(30000) });
    const x = await r.text(); console.log(`secours ${u.split("/")[2]} : ${r.status} ${Date.now() - t} ms ACAO=${r.headers.get("access-control-allow-origin")} ${x.slice(0, 300).replace(/\s+/g, " ")}`); }
  catch (e) { console.log(`secours ${u.split("/")[2]} : ERREUR ${Date.now() - t} ms ${e.message}`); } }
let ko = 0;
for (const P of [routes.find(p => p.at(-1).d < 130e3), routes.find(p => p.at(-1).d < 90e3), routes[0]]) for (const voir of [false, true]) {
  const L = A._corridor(P, voir ? 300 : 200); log.length = 0; const t = Date.now();
  try { const els = await A._fetchPois(L, voir); console.log(`${Math.round(P.at(-1).d / 1000)} km, à voir=${voir}, ${L.split("|").length} rectangles : OK en ${Date.now() - t} ms, ${els.length} points`); }
  catch (e) { ko++; console.log(`${Math.round(P.at(-1).d / 1000)} km, à voir=${voir} : ÉCHEC en ${Date.now() - t} ms ${e.message}`); }
  log.forEach(l => console.log("   " + l));
}
console.log(`${ko} échec(s) sur 6`);
