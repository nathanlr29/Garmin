// Sonde réseau temporaire : coût réel de la requête d'arrets.js sur overpass-api.de, selon sa forme.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {}, ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: v => String(v), esc: s => String(s), setTimeout, clearTimeout, AbortController, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets, R = JSON.parse(readFileSync(new URL("../data/routes.json", import.meta.url)));
const rad = x => x * Math.PI / 180, dist = (a, b) => 6371e3 * Math.hypot(rad(b[0] - a[0]), rad(b[1] - a[1]) * Math.cos(rad(a[0])));
const toP = pts => { let d = 0; return pts.map((p, i) => ({ lat: p[0], lon: p[1], d: d += i ? dist(pts[i - 1], p) : 0 })); };
const routes = Object.values(R).filter(Boolean).map(toP).sort((a, b) => b.at(-1).d - a.at(-1).d);
const P = routes.find(p => p.at(-1).d < 130e3);  // une sortie de 100-130 km, cas courant
const L = A._corridor(P, 200), boxes = L.split("|");
const run = async (name, q) => { const t = Date.now();
  try { const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" }, signal: AbortSignal.timeout(150000) });
    const x = await r.text(); let n = "?", rem = ""; try { const j = JSON.parse(x); n = j.elements.length; rem = j.remark || ""; } catch (e) { rem = x.slice(0, 120); }
    console.log(`${name}: ${r.status} en ${Date.now() - t} ms, ${n} éléments, ${q.length} car. ${rem}`); }
  catch (e) { console.log(`${name}: ERREUR ${Date.now() - t} ms ${e.message}`); } };
const T = q => q.replace("[timeout:25]", "[timeout:120]");
const AM = '["amenity"~"^(drinking_water|water_point|toilets|cafe|bar|pub|fuel|bicycle_repair_station|grave_yard)$"]', SH = '["shop"~"^(bakery|pastry|convenience|supermarket|general|greengrocer|farm|bicycle)$"]';
const mk = (bxs, f) => `[out:json][timeout:120];(${bxs.map(f).join("")});out tags center qt;`;
console.log(`sortie de ${Math.round(P.at(-1).d / 1000)} km, ${boxes.length} rectangles`);
await run("A actuelle (timeout 120)", T(A._query(L, false)));
await run("B nœuds seulement + cimetières en ways", mk(boxes, b => `node${AM}(${b});node${SH}(${b});way${SH}(${b});way["landuse"="cemetery"](${b});`));
const merged = []; for (let i = 0; i < boxes.length; i += 2) { const a = boxes[i].split(",").map(Number), c = (boxes[i + 1] || boxes[i]).split(",").map(Number);
  merged.push([Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])].join(",")); }
await run("C rectangles 6 km", T(A._query(merged.join("|"), false)));
await run("D bbox globale + filtre par rectangles (poly union via .r)", `[out:json][timeout:120];(${boxes.map(b => `nwr${AM}(${b});`).join("")})->.a;(${boxes.map(b => `nwr${SH}(${b});`).join("")})->.s;(.a;.s;);out tags center qt;`);
await run("E moitié des rectangles (requête coupée en 2)", T(A._query(boxes.slice(0, boxes.length >> 1).join("|"), false)));
await run("F actuelle à nouveau (cache serveur ?)", T(A._query(L, false)));
