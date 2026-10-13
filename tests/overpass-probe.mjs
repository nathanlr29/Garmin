// Sonde réseau temporaire : coût des formes de requête sur un morceau de 15 rectangles (overpass-api.de).
import { readFileSync } from "node:fs";
import vm from "node:vm";
const win = {}, ctx = { window: win, document: {}, localStorage: { getItem: () => null, setItem() {} }, nf: v => String(v), esc: s => String(s), setTimeout, clearTimeout, AbortController, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../arrets.js", import.meta.url), "utf8"), ctx);
const A = win.Arrets, R = JSON.parse(readFileSync(new URL("../data/routes.json", import.meta.url)));
const rad = x => x * Math.PI / 180, dist = (a, b) => 6371e3 * Math.hypot(rad(b[0] - a[0]), rad(b[1] - a[1]) * Math.cos(rad(a[0])));
const toP = pts => { let d = 0; return pts.map((p, i) => ({ lat: p[0], lon: p[1], d: d += i ? dist(pts[i - 1], p) : 0 })); };
const routes = Object.values(R).filter(Boolean).map(toP).sort((a, b) => b.at(-1).d - a.at(-1).d);
const boxes = A._corridor(routes.find(p => p.at(-1).d < 130e3), 300).split("|").slice(0, 15);
const H = { "User-Agent": "BreizhWatts/1.0 (https://nathanlr29.github.io/Garmin/)" }, sleep = ms => new Promise(r => setTimeout(r, ms));
const status = async () => (await (await fetch("https://overpass-api.de/api/status", { headers: H })).text()).split("\n").filter(l => /Rate limit|slots? available|Slot available/i.test(l)).join(" | ");
const BASE = ['["amenity"~"^(drinking_water|water_point|toilets|cafe|bar|pub|fuel|bicycle_repair_station|grave_yard)$"]', '["shop"~"^(bakery|pastry|convenience|supermarket|general|greengrocer|farm|bicycle)$"]', '["landuse"="cemetery"]'];
const VOIR = ['["historic"~"^(castle|manor|chateau|church|chapel|archaeological_site|megalith|menhir|dolmen|tumulus|mill|windmill|watermill|wayside_cross|wayside_shrine|calvary|monument|ruins)$"]["wikidata"]', '["amenity"="place_of_worship"]["wikidata"]', '["tourism"="viewpoint"]', '["man_made"~"^(windmill|watermill)$"]["wikidata"]', '["natural"~"^(peak|waterfall|cave_entrance|rock|stone|cliff|beach|valley|gorge)$"]["wikidata"]', '["leisure"="nature_reserve"]["wikidata"]'];
const mk = (t, F) => `[out:json][timeout:120];(${boxes.map(b => F.map(f => `${t}${f}(${b});`).join("")).join("")});out tags center qt;`;
const run = async (name, q) => { console.log(`  statut avant : ${await status()}`); const t = Date.now();
  const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { ...H, "Content-Type": "application/x-www-form-urlencoded" } });
  const x = await r.text(); let n = "?"; try { n = JSON.parse(x).elements.length; } catch (e) {}
  console.log(`${name} : ${r.status} en ${Date.now() - t} ms, ${n} éléments`); await sleep(20000); };
console.log(`statut initial : ${await status()}`);
await run("1 actuelle nwr base+voir", A._query(boxes.join("|"), true).replace("[timeout:60]", "[timeout:120]"));
await run("2 nw base+voir", mk("nw", [...BASE, ...VOIR]));
await run("3 nwr base seule", mk("nwr", BASE));
await run("4 nw base seule", mk("nw", BASE));
await run("5 nwr voir seul", mk("nwr", VOIR));
await run("6 nw voir seul", mk("nw", VOIR));
await run("7 nw voir sans natural", mk("nw", VOIR.filter(f => !f.includes("natural"))));
await run("8 actuelle nwr base+voir (2e fois)", A._query(boxes.join("|"), true).replace("[timeout:60]", "[timeout:120]"));
