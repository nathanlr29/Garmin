// Sonde réseau temporaire : envoie la vraie requête d'arrets.js aux 3 serveurs Overpass (à lancer là où le réseau est ouvert).
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {}, log = [];
const ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: v => String(v), esc: s => String(s), setTimeout, clearTimeout, AbortController, console,
  fetch: async (url, o) => { const t = Date.now(); try { const r = await fetch(url, { ...o, headers: { ...o.headers, Origin: "https://nathanlr29.github.io" } });
      const txt = await r.text(); log.push(`${url} -> ${r.status} ${Date.now() - t} ms, ACAO=${r.headers.get("access-control-allow-origin")}, ${txt.length} o, ${txt.slice(0, 200).replace(/\s+/g, " ")}`);
      return { ok: r.ok, status: r.status, json: async () => JSON.parse(txt) }; }
    catch (e) { log.push(`${url} -> ERREUR ${Date.now() - t} ms ${e.name} ${e.message}`); throw e; } } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets, R = JSON.parse(readFileSync(new URL("../data/routes.json", import.meta.url)));
const rad = x => x * Math.PI / 180, dist = (a, b) => 6371e3 * Math.hypot(rad(b[0] - a[0]), rad(b[1] - a[1]) * Math.cos(rad(a[0])));
const toP = pts => { let d = 0; return pts.map((p, i) => ({ lat: p[0], lon: p[1], d: d += i ? dist(pts[i - 1], p) : 0 })); };
const routes = Object.values(R).filter(Boolean).map(toP).sort((a, b) => b.at(-1).d - a.at(-1).d);
for (const [name, P] of [["longue", routes[0]], ["moyenne", routes[Math.floor(routes.length / 2)]]]) for (const voir of [false, true]) {
  const L = A._corridor(P, voir ? 300 : 200), q = A._query(L, voir); log.length = 0; const t = Date.now();
  console.log(`\n=== ${name} ${Math.round(P.at(-1).d / 1000)} km, voir=${voir}, ${L.split("|").length} rectangles, requête ${q.length} car.`);
  try { const j = await A._overpass(q); console.log(`OK en ${Date.now() - t} ms : ${j.elements.length} éléments`); } catch (e) { console.log(`ÉCHEC en ${Date.now() - t} ms : ${e.message}`); }
  log.forEach(l => console.log("  " + l));
}
