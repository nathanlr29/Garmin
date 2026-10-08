"use strict";
// Points d'arrêt le long d'une sortie (eau, ravitaillement, toilettes, réparation) : OpenStreetMap via Overpass.
// Une seule requête par trace (couloir de 150 m), gardée en cache ; si le service ne répond pas, la sortie s'affiche sans les arrêts.
// Les 400 premiers et derniers mètres de la trace ne sont jamais envoyés (le point de départ reste sur l'appareil).
(() => {
const $ = id => document.getElementById(id);
const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };
const rad = x => x * Math.PI / 180;
const pad = n => String(n).padStart(2, "0");
const hm = d => `${d.getHours()} h ${pad(d.getMinutes())}`;
const hh = d => d.getMinutes() ? `${d.getHours()} h ${pad(d.getMinutes())}` : `${d.getHours()} h`;
const fmt = (v, d = 0) => nf(v, d);
function dist(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]); const x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * 6371e3 * Math.asin(Math.sqrt(x)); }

// ------------------------------------------------------------------ Catégories
const CATS = {
  eau: { ic: "💧", l: "Eau", col: "#1c7ed6" },
  ravito: { ic: "🥖", l: "Ravito", col: "#e8590c" },
  wc: { ic: "🚻", l: "Toilettes", col: "#7048e8" },
  repa: { ic: "🔧", l: "Réparation", col: "#495057" },
  voir: { ic: "🏰", l: "À voir", col: "#2b8a3e" },
};
// sous-types : icône, libellé, nom court (Edge), symbole GPX, type de point de parcours FIT
const KINDS = {
  water: { cat: "eau", ic: "💧", l: "Point d'eau potable", s: "Eau", fit: "water", sym: "Drinking Water" },
  cemetery: { cat: "eau", ic: "🪦", l: "Cimetière (eau probable)", s: "Eau cimetière", fit: "water", sym: "Drinking Water" },
  bakery: { cat: "ravito", ic: "🥖", l: "Boulangerie", s: "Boulang.", fit: "food", sym: "Restaurant" },
  shop: { cat: "ravito", ic: "🛒", l: "Épicerie", s: "Épicerie", fit: "store", sym: "Convenience Store" },
  fuel: { cat: "ravito", ic: "⛽", l: "Station-service", s: "Station", fit: "store", sym: "Gas Station" },
  cafe: { cat: "ravito", ic: "☕", l: "Café", s: "Café", fit: "food", sym: "Restaurant" },
  toilets: { cat: "wc", ic: "🚻", l: "Toilettes", s: "WC", fit: "toilet", sym: "Restroom" },
  repair: { cat: "repa", ic: "🔧", l: "Station de réparation", s: "Répar. vélo", fit: "gear", sym: "Bike Trail" },
  bikeshop: { cat: "repa", ic: "🚲", l: "Magasin de vélo", s: "Vélociste", fit: "gear", sym: "Bike Trail" },
  // « À voir » (Pause découverte) : seulement les lieux qui ont une fiche Wikipédia
  castle: { cat: "voir", ic: "🏰", l: "Château", fit: "info", sym: "Museum", w: 3 },
  megalith: { cat: "voir", ic: "🗿", l: "Mégalithe", fit: "info", sym: "Museum", w: 3 },
  viewpoint: { cat: "voir", ic: "🔭", l: "Point de vue", fit: "overlook", sym: "Scenic Area", w: 3 },
  mill: { cat: "voir", ic: "🌬️", l: "Moulin", fit: "info", sym: "Museum", w: 2 },
  church: { cat: "voir", ic: "⛪", l: "Église ou chapelle", fit: "info", sym: "Church", w: 2 },
  nature: { cat: "voir", ic: "🌳", l: "Site naturel", fit: "overlook", sym: "Scenic Area", w: 2 },
  calvary: { cat: "voir", ic: "✝️", l: "Calvaire", fit: "info", sym: "Church", w: 1 },
  monument: { cat: "voir", ic: "🏛️", l: "Monument", fit: "info", sym: "Museum", w: 1 },
};
function kindOf(t) {
  if (/^(private|no)$/.test(t.access || "") || t.drinking_water === "no" || t.disused === "yes") return null;
  if (t.amenity === "drinking_water" || t.amenity === "water_point") return "water";
  if (t.landuse === "cemetery" || t.amenity === "grave_yard") return "cemetery";
  if (t.shop === "bakery" || t.shop === "pastry") return "bakery";
  if (/^(convenience|supermarket|general|greengrocer|farm)$/.test(t.shop || "")) return "shop";
  if (t.amenity === "fuel") return "fuel";
  if (/^(cafe|bar|pub)$/.test(t.amenity || "")) return "cafe";
  if (t.amenity === "toilets") return "toilets";
  if (t.amenity === "bicycle_repair_station") return "repair";
  if (t.shop === "bicycle") return "bikeshop";
  return null;
}
function voirKind(t) {
  if (!t.wikipedia && !t.wikidata) return null;
  const h = t.historic || "", is = (v, re) => re.test(v || "");
  if (is(h, /^(castle|manor|chateau)$/) || t.building === "castle") return "castle";
  if (is(h, /^(megalith|menhir|dolmen|tumulus)$/) || (h === "archaeological_site" && (/megalith|tumulus/.test((t.site_type || "") + (t.archaeological_site || "")) || t.megalith_type))) return "megalith";
  if (is(h, /^(wayside_cross|wayside_shrine|calvary)$/)) return "calvary";
  if (is(h, /^(mill|windmill|watermill)$/) || is(t.man_made, /^(windmill|watermill)$/)) return "mill";
  if (is(h, /^(church|chapel)$/) || t.amenity === "place_of_worship" || is(t.building, /^(church|chapel|cathedral)$/)) return "church";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.natural || t.leisure === "nature_reserve") return "nature";
  if (is(h, /^(monument|ruins|archaeological_site)$/)) return "monument";
  return null;
}
function nameOf(t, k) {
  const n = t.name || t.brand || "";
  if (k === "shop") return n || ({ supermarket: "Supermarché", convenience: "Supérette", greengrocer: "Primeur", farm: "Vente à la ferme" }[t.shop] || "Épicerie");
  if (k === "cafe") return n || (t.amenity === "cafe" ? "Café" : "Bar");
  return n || KINDS[k].l;
}

// ------------------------------------------------------------------ Couloir et requête Overpass
const CUT = 400, NEAR = 150;
function simplify(xy, tol) {  // Douglas-Peucker itératif
  const keep = new Uint8Array(xy.length); keep[0] = keep[xy.length - 1] = 1;
  const st = [[0, xy.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const [x, y] = xy[i], f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), d = Math.hypot(x - ax - f * dx, y - ay - f * dy); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return xy.map((_, i) => i).filter(i => keep[i]);
}
function corridor(P) {  // tracé simplifié, sans les abords du départ et de l'arrivée
  const tot = P[P.length - 1].d, Q = P.filter(p => p.d >= CUT && p.d <= tot - CUT);
  if (Q.length < 2) return null;
  const c = Math.cos(rad(Q[0].lat)), xy = Q.map(p => [p.lon * c * 111320, p.lat * 110540]);
  let tol = 40, idx = simplify(xy, tol);
  while (idx.length > 350) { tol *= 1.5; idx = simplify(xy, tol); }
  return idx.map(i => `${Q[i].lat.toFixed(5)},${Q[i].lon.toFixed(5)}`).join(",");
}
const OVP = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const VOIR = 300;  // « À voir » : à moins de 300 m du tracé, avec un tag wikipedia ou wikidata
const query = L => `[out:json][timeout:40];(nwr(around:${NEAR},${L})[~"^(amenity|shop|landuse)$"~"^(drinking_water|water_point|toilets|cafe|bar|pub|fuel|bicycle_repair_station|bakery|pastry|convenience|supermarket|general|greengrocer|farm|bicycle|cemetery|grave_yard)$"];`
  + `nwr(around:${VOIR},${L})[~"^(historic|tourism|natural|man_made|amenity|leisure|building)$"~"^(castle|manor|chateau|church|chapel|cathedral|place_of_worship|archaeological_site|megalith|menhir|dolmen|tumulus|windmill|watermill|mill|wayside_cross|wayside_shrine|calvary|monument|ruins|viewpoint|peak|waterfall|cave_entrance|rock|stone|cliff|beach|valley|gorge|nature_reserve)$"][~"^wiki(pedia|data)$"~"."];);out center tags;`;
const KEEP_T = ["name", "brand", "amenity", "shop", "landuse", "opening_hours", "access", "drinking_water", "disused", "seasonal", "fee", "wikipedia", "wikidata", "historic", "tourism", "natural", "man_made", "leisure", "building", "site_type", "archaeological_site", "megalith_type"];
const K_POI = "soPoi", POI_V = 2, POI_TTL = 7 * 864e5;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const ST = { inflight: new Map(), poi: null, voirSel: null, stops: [], cands: [], key: null, err: "", seq: 0, layer: null, adv: [], list: [], ctx: null, showAll: false };
async function fetchPois(L) {
  const key = hash(POI_V + "|" + L), cache = LS.get(K_POI, {});
  if (cache[key] && Date.now() - cache[key].at < POI_TTL) return cache[key].els;
  if (ST.inflight.has(key)) return ST.inflight.get(key);
  const pr = (async () => {
    let last;
    for (const url of OVP) {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 45000);
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query(L)), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac.signal });
        if (!r.ok) throw new Error("Overpass " + r.status);
        const j = await r.json(), els = (j.elements || []).map(e => { const t = {}; KEEP_T.forEach(k => { if (e.tags && e.tags[k] != null) t[k] = e.tags[k]; });
          return { id: e.type[0] + e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, t }; }).filter(e => e.lat != null);
        const c = LS.get(K_POI, {}); c[key] = { at: Date.now(), els };
        Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(4).forEach(k => delete c[k]);  // 4 traces gardées au plus
        if (!LS.set(K_POI, c)) LS.set(K_POI, { [key]: c[key] });
        return els;
      } catch (e) { last = e; } finally { clearTimeout(to); }
    }
    throw last || new Error("Overpass indisponible");
  })();
  ST.inflight.set(key, pr); pr.finally(() => ST.inflight.delete(key)).catch(() => {});
  return pr;
}

// ------------------------------------------------------------------ Horaires (opening_hours)
// Bibliothèque opening_hours.js (jsDelivr), chargée seulement s'il y a des horaires à lire ; sinon lecture simple des cas courants.
const OHL = { p: null };
const loadScript = src => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error(src)); document.head.appendChild(s); });
function ohLib() {
  if (window.opening_hours) return Promise.resolve(true);
  if (!OHL.p) OHL.p = (async () => {
    // i18next ne sert qu'aux messages d'avertissement : une version minimale suffit
    if (!window.i18next) window.i18next = { isInitialized: true, language: "fr", t: k => k, getFixedT: () => k => k, addResourceBundle() {} };
    await loadScript("https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js");
    await loadScript("https://cdn.jsdelivr.net/npm/opening_hours@3.8.0/build/opening_hours.min.js");
    return !!window.opening_hours;
  })().catch(() => false);
  return OHL.p;
}
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function ohSimple(s, t) {  // « Mo-Sa 07:00-13:00,15:00-19:30; Su 07:00-12:30 », « 24/7 », « Mo off »… ; null si non lu
  s = String(s).trim(); if (s === "24/7") return { open: true };
  const dow = t.getDay(), now = t.getHours() * 60 + t.getMinutes(), DR = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
  let today;
  for (let rule of s.split(";")) {
    rule = rule.trim(); if (!rule || /^PH\b/.test(rule)) continue;
    const m = rule.match(new RegExp(`^(${DR}(?:-${DR})?(?:,${DR}(?:-${DR})?)*)?\\s*(.*)$`)); if (!m) return null;
    const days = new Set();
    if (m[1]) m[1].split(",").forEach(p => { const [a, b] = p.split("-").map(d => DAYS.indexOf(d)); if (b == null) days.add(a); else for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; } });
    else DAYS.forEach((_, i) => days.add(i));
    const rest = m[2].trim().replace(/\s*,\s*/g, ",");
    let R;
    if (/^(off|closed)$/.test(rest)) R = [];
    else if (/^\d\d:\d\d-\d\d:\d\d(,\d\d:\d\d-\d\d:\d\d)*$/.test(rest)) R = rest.split(",").map(x => x.split("-").map(h => +h.slice(0, 2) * 60 + +h.slice(3)));
    else return null;
    if (days.has(dow)) today = R;
  }
  if (!today) return { open: false };
  const at = mm => { const d = new Date(t); d.setHours(0, mm, 0, 0); return d; };
  for (const [a, b0] of today) { const b = b0 <= a ? b0 + 1440 : b0; if (now >= a && now < b) return { open: true, next: at(b) }; }
  const nx = today.map(r => r[0]).filter(a => a > now).sort((a, b) => a - b)[0];
  return { open: false, next: nx != null ? at(nx) : null };
}
function ohState(s, t, lat, lon) {
  if (window.opening_hours) {
    try { const oh = new window.opening_hours(s, { lat, lon, address: { country_code: "fr", state: "Bretagne" } }, 0);
      if (oh.getUnknown(t)) return { open: null }; return { open: oh.getState(t), next: oh.getNextChange(t) || null }; } catch (e) {}
  }
  const r = ohSimple(s, t); return r || { open: null };
}
const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
function statusTxt(p) {
  const o = p.oh; if (!o) return p.k === "cemetery" ? (p.winter ? "eau souvent coupée l'hiver" : "robinet probable, non garanti") : p.t.seasonal && p.t.seasonal !== "no" ? "saisonnier" : "";
  if (o.open === true) return o.next && sameDay(o.next, p.t0) ? `ouvert jusqu'à ${hh(o.next)}` : "ouvert";
  if (o.open === false) return o.next && sameDay(o.next, p.t0) ? `fermé (ouvre à ${hh(o.next)})` : "fermé à ce moment-là";
  return "horaires à vérifier";
}

// ------------------------------------------------------------------ Placement sur le parcours
function place(els, P, r) {
  const c = Math.cos(rad(P[0].lat)), out = [], st = Math.max(1, Math.floor(P.length / 4000));
  const mo = new Date(r.T[0]).getMonth(), winter = mo >= 10 || mo <= 2;
  for (const e of els) {
    const k = kindOf(e.t) || voirKind(e.t); if (!k) continue;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < P.length; i += st) { const dx = (P[i].lon - e.lon) * c * 111320, dy = (P[i].lat - e.lat) * 110540, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    for (let i = Math.max(0, bi - st); i <= Math.min(P.length - 1, bi + st); i++) { const dx = (P[i].lon - e.lon) * c * 111320, dy = (P[i].lat - e.lat) * 110540, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    const off = Math.sqrt(bd), lim = k === "cemetery" || KINDS[k].cat === "voir" ? VOIR : NEAR + 30;  // cimetière, site : centre de la parcelle
    if (off > lim) continue;
    const t0 = new Date(r.T[bi]);
    out.push({ id: e.id, k, cat: KINDS[k].cat, name: nameOf(e.t, k), lat: e.lat, lon: e.lon, t: e.t, i: bi, km: P[bi].d / 1000, t0, off, winter });
  }
  // un même lieu cartographié deux fois (nœud + bâtiment) : on garde le plus proche
  out.sort((a, b) => a.km - b.km);
  return out.filter((p, i) => !out.some((q, j) => j !== i && q.k === p.k && q.name === p.name && dist([p.lat, p.lon], [q.lat, q.lon]) < 60 && (q.off < p.off || (q.off === p.off && j < i))));
}

// ------------------------------------------------------------------ Arrêts conseillés (1 à 3), reliés à la carte Nutrition
function advise(L, r, nut) {
  const h = r.secs / 3600, t0 = r.T[0], hot = r.ok && r.tmax >= 25, adv = [], used = new Set();
  const atH = p => (p.t0 - t0) / 3600e3, inRange = p => atH(p) > .2 * h && atH(p) < h - .25;
  const pick = (cands, target, cost) => { let best = null, bc = Infinity; cands.forEach(p => { if (used.has(p.id) || !inRange(p)) return; const c = Math.abs(atH(p) - target) * 60 + p.off / 15 + cost(p); if (c < bc) { bc = c; best = p; } }); return best; };
  const cap = nut ? nut.cap : 1.2, drink = nut ? nut.drink : .6, rate = nut ? nut.rate : 0;
  const refill = p => p.k === "water" ? 0 : p.k === "cemetery" ? 20 + (p.winter ? 30 : 0) : p.cat === "ravito" ? (p.oh && p.oh.open === false ? Infinity : p.oh && p.oh.open === true ? 15 : 30) : Infinity;
  // eau : vers le milieu au-delà de 2 h, plus tôt s'il fait chaud ou si les bidons sont vides avant
  if (h > 2 || (hot && h > 1.5)) {
    const empty = cap / drink;
    let target = Math.min(h / 2, empty * .9); if (hot) target = Math.min(target, h * .4);
    const w = pick(L, target, refill);
    if (w) { used.add(w.id); adv.push({ p: w, role: "eau", why: `Vers ${hm(w.t0)}, ${dur(atH(w))} après le départ : à ${fmt(drink * 1000)} ml/h, tes ${fmt(cap, 1)} L de bidons ${atH(w) >= empty * .8 ? "seront presque vides" : "seront bien entamés"}${hot ? " (il fait chaud)" : ""}. Remplis-les.` });
      // deuxième remplissage si la sortie est longue
      if (nut && nut.water > 2 * cap + .2) { const w2 = pick(L.filter(p => atH(p) > atH(w) + empty * .6), atH(w) + empty * .9, refill);
        if (w2) { used.add(w2.id); adv.push({ p: w2, role: "eau", why: `Deuxième remplissage vers ${hm(w2.t0)} : il te faut ${fmt(nut.water, 1)} L sur la sortie.` }); } }
    }
  }
  // ravitaillement ouvert au-delà de 3 h
  if (h > 3 && adv.length < 3) {
    const shop = p => p.cat !== "ravito" ? Infinity : p.oh && p.oh.open === false ? Infinity : (p.oh && p.oh.open === true ? 0 : 25) + (p.k === "fuel" ? 8 : 0);
    const same = adv.find(a => a.p.cat === "ravito" && Math.abs(atH(a.p) - h * .55) < .6);
    if (same) { same.role = "eau + ravito"; same.why += ` Profites-en pour acheter de quoi manger${rate ? ` (${rate} g de glucides par heure)` : ""}.`; }
    else { const f = pick(L, h * .55, shop);
      if (f) { used.add(f.id); adv.push({ p: f, role: "ravito", why: `Arrêt ravito vers ${hm(f.t0)}${f.oh && f.oh.open ? "" : " (horaires à vérifier)"}${rate ? ` : il te faut ${rate} g de glucides par heure, de quoi recharger les poches pour la fin` : ""}${f.cat === "ravito" && f.k !== "fuel" ? ", et tu peux y remplir les bidons" : ""}.` }); } }
  }
  return adv.slice(0, 3).sort((a, b) => a.p.km - b.p.km);
}
const dur = x => { const m = Math.round(x * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`; };

// ------------------------------------------------------------------ Choix « ajouter au GPS » (gardés par trace)
const K_GPS = "soGps";
const sigOf = route => hash(route.name + "|" + route.pts.length + "|" + route.pts[route.pts.length >> 1].join(","));
function gpsOn(p) { const g = ST.gps || {}; return g[p.id] ?? ST.adv.some(a => a.p.id === p.id); }
function setGps(id, v) { const s = LS.get(K_GPS, {}), sig = ST.sig; s[sig] = { ...(s[sig] || {}), [id]: v, at: Date.now() }; ST.gps = s[sig];
  Object.keys(s).sort((a, b) => (s[b].at || 0) - (s[a].at || 0)).slice(6).forEach(k => delete s[k]); LS.set(K_GPS, s); }

// ------------------------------------------------------------------ Affichage
const K_CAT = "soStopCat";
const K_DEC = "soDecouv", decouv = () => LS.get(K_DEC, false) === true;
const catsOn = () => ({ eau: true, ravito: true, wc: true, repa: true, ...LS.get(K_CAT, {}), voir: decouv() && LS.get(K_CAT, {}).voir !== false });
function iconHtml(p, big) { const c = CATS[p.cat]; return `<span class="stmk${big ? " big" : ""}" style="--c:${c.col}">${KINDS[p.k].ic}</span>`; }
function tipHtml(p) { const st = statusTxt(p); return `<b>${esc(p.name)}</b><br>${KINDS[p.k].l} · km ${fmt(p.km, 1)} · vers ${hm(p.t0)}<br>à ${fmt(p.off)} m du tracé${st ? `<br>${esc(st)}` : ""}`; }
function drawMap() {
  const map = ST.ctx && ST.ctx.map; if (!map || !window.L) return;
  if (!ST.layer || ST.layerMap !== map) { if (ST.layer) ST.layer.remove(); ST.layer = L.layerGroup().addTo(map); ST.layerMap = map; }
  ST.layer.clearLayers(); ST.mk = {};
  const on = catsOn(), advIds = new Set(ST.adv.map(a => a.p.id));
  ST.list.filter(p => on[p.cat] || advIds.has(p.id)).forEach(p => {
    const big = advIds.has(p.id), s = big ? 30 : 24;
    ST.mk[p.id] = L.marker([p.lat, p.lon], { zIndexOffset: big ? 600 : 300, icon: L.divIcon({ className: "stdiv", html: iconHtml(p, big), iconSize: [s, s], iconAnchor: [s / 2, s / 2] }) }).bindTooltip(tipHtml(p)).addTo(ST.layer);
  });
}
function row(p, adv) {
  const st = statusTxt(p), cls = p.oh ? (p.oh.open === true ? "ok" : p.oh.open === false ? "ko" : "") : p.k === "cemetery" ? "warn" : "";
  return `<div class="strow${adv ? " adv" : ""}" data-pid="${p.id}">${iconHtml(p)}<button class="stname" data-go="${p.id}"><b>${esc(p.name)}</b><small>km ${fmt(p.km, 1)} · ${hm(p.t0)} · ${fmt(p.off)} m${st ? ` · <span class="st ${cls}">${esc(st)}</span>` : ""}</small></button>
    <label class="stgps" title="Ajouter au GPS (export GPX)"><input type="checkbox" data-gps="${p.id}" ${gpsOn(p) ? "checked" : ""}><span>GPS</span></label></div>`;
}
function render() {
  const box = $("soStops"); if (!box) return;
  const info = $("soStopInfo");
  if (ST.err) { box.innerHTML = `<p class="note">${esc(ST.err)} <button class="btn2" id="stRetry">Réessayer</button></p>`; if (info) info.textContent = ""; $("stRetry").onclick = () => update(ST.ctx, true); return; }
  if (!ST.poi) { box.innerHTML = `<p class="note">Recherche des points d'eau, commerces et toilettes le long du parcours (OpenStreetMap)…</p>`; return; }
  const on = catsOn(), L_ = ST.list, cnt = c => L_.filter(p => p.cat === c).length;
  if (info) info.textContent = ST.stops.length ? `${ST.stops.length} à moins de ${NEAR} m du tracé` : "";
  const shown = L_.filter(p => on[p.cat] && p.cat !== "voir"), lim = ST.showAll ? shown.length : 10, nut = ST.ctx.nut;
  box.innerHTML = `${ST.adv.length ? `<div class="stadv">${ST.adv.map(a => `<div class="stac"><div class="stach"><span class="stbadge">Arrêt conseillé · ${esc(a.role)}</span></div>${row(a.p, true)}<p>${esc(a.why)}</p></div>`).join("")}</div>`
      : `<p class="sosmall">${ST.ctx.r.secs < 2 * 3600 ? "Sortie de moins de 2 h : pas besoin de s'arrêter, 1 ou 2 bidons suffisent." : "Aucun point d'eau ni commerce ouvert trouvé au bon moment près du tracé : pars avec les bidons pleins et prévois un arrêt dans un bourg."}</p>`}
    ${nut && ST.ctx.r.secs >= 2 * 3600 ? `<p class="note stnut">Calé sur la carte Nutrition : ${fmt(nut.drink * 1000)} ml/h à boire${nut.rate ? `, ${nut.rate} g de glucides par heure` : ""}.</p>` : ""}
    <label class="stdec"><input type="checkbox" id="stDec" ${decouv() ? "checked" : ""}><span><b>Pause découverte</b><small>3 à 5 lieux à voir près du tracé (château, mégalithe, chapelle, point de vue…), avec une anecdote Wikipédia</small></span></label>
    ${decouv() ? voirHtml() : ""}
    <div class="stchips" role="group" aria-label="Catégories affichées">${Object.entries(CATS).filter(([k]) => k !== "voir" || decouv()).map(([k, c]) => `<button class="stchip" data-cat="${k}" aria-pressed="${!!on[k]}" style="--c:${c.col}">${c.ic} ${c.l} <small>${cnt(k)}</small></button>`).join("")}</div>
    ${shown.length ? `<div class="stlist">${shown.slice(0, lim).map(p => row(p)).join("")}</div>${shown.length > lim ? `<button class="btn2 stmore" id="stMore">Afficher les ${shown.length} points</button>` : ""}` : `<p class="note">Rien dans ces catégories près du tracé.</p>`}
    <p class="note">Données OpenStreetMap, à vérifier sur place (horaires et robinets peuvent changer). Coche « GPS » pour l'ajouter à l'export ; les arrêts conseillés y sont déjà.</p>
    ${HELP}`;
  box.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { const k = b.dataset.cat, c = LS.get(K_CAT, {}); c[k] = !catsOn()[k]; LS.set(K_CAT, c); render(); drawMap(); ST.ctx.onIcons && ST.ctx.onIcons(); });
  box.querySelectorAll("[data-gps]").forEach(i => i.onchange = () => { setGps(i.dataset.gps, i.checked); box.querySelectorAll(`[data-gps="${i.dataset.gps}"]`).forEach(x => x.checked = i.checked); });
  box.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { const m = ST.mk && ST.mk[b.dataset.go], map = ST.ctx.map; if (!m || !map) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 14)); m.openTooltip();
    const rc = map.getContainer().getBoundingClientRect(); if (rc.bottom < 0 || rc.top > innerHeight) map.getContainer().scrollIntoView({ behavior: "smooth", block: "center" }); });
  if ($("stMore")) $("stMore").onclick = () => { ST.showAll = true; render(); };
  $("stDec").onchange = e => { LS.set(K_DEC, e.target.checked); setList(); render(); drawMap(); ST.ctx.onIcons && ST.ctx.onIcons(); if (e.target.checked) findVoir(ST.seq); };
}
function voirHtml() {
  const V = ST.voirSel;
  if (V == null) return `<p class="note">Recherche des lieux à voir (OpenStreetMap et Wikipédia)…</p>`;
  if (ST.voirErr) return `<p class="note">${esc(ST.voirErr)}</p>`;
  if (!V.length) return `<p class="note">Pas de lieu avec une fiche Wikipédia à moins de ${VOIR} m du tracé.</p>`;
  return `<div class="stvoir"><div class="stbadge">À voir en chemin</div>${V.map(p => `<div class="stvc">${row(p)}${p.wiki.x ? `<p>${esc(p.wiki.x)}</p>` : ""}<a href="${esc(p.wiki.url)}" target="_blank" rel="noopener">En savoir plus sur Wikipédia ↗</a></div>`).join("")}</div>`;
}
const HELP = `<details class="sthelp"><summary>Avoir les alertes sur ton Edge</summary><ol>
  <li><b>Exporte</b> avec « Exporter pour Garmin (.fit) » en haut de la page : les arrêts cochés deviennent des points de parcours typés (eau, nourriture, toilettes…). Le GPX marche aussi, mais il perd souvent les types.</li>
  <li><b>Importe</b> dans Garmin Connect sur ordinateur : Entraînement et planification → Parcours → Importer → choisis le fichier → Enregistrer. Vérifie que les points apparaissent le long du tracé.</li>
  <li><b>Envoie</b> le parcours vers l'appareil (bouton « Envoyer vers l'appareil », puis synchronise l'Edge). Sur l'Edge : Navigation → Parcours → ce parcours → Rouler. L'écran « À venir » liste les arrêts avec la distance restante, et une alerte s'affiche à l'approche.</li>
</ol><p class="note">Sans ordinateur : branche l'Edge en USB et copie le .fit dans le dossier Garmin/NewFiles.</p></details>`;
function annotate() {
  const { P, r } = ST.ctx, all = place(ST.poi, P, r);
  all.forEach(p => { p.oh = p.t.opening_hours ? ohState(p.t.opening_hours, p.t0, p.lat, p.lon) : null; });
  ST.stops = all.filter(p => p.cat !== "voir"); ST.cands = all.filter(p => p.cat === "voir");
  ST.adv = advise(ST.stops, r, ST.ctx.nut);
  // lieux déjà choisis : on garde le choix, avec km et heure de passage à jour
  if (ST.voirSel) ST.voirSel = ST.voirSel.map(v => { const c = ST.cands.find(p => p.id === v.id); return c ? Object.assign(c, { wiki: v.wiki }) : null; }).filter(Boolean);
  setList();
}
function setList() { ST.list = decouv() && ST.voirSel ? ST.stops.concat(ST.voirSel).sort((a, b) => a.km - b.km) : ST.stops; }

// ------------------------------------------------------------------ Pause découverte : Wikipédia (fiche en français, résumé)
const K_WIKI = "soWiki", K_WD = "soWd", WIKI_TTL = 30 * 864e5;
const frTitle = t => { const m = /^fr:(.+)$/.exec(t.wikipedia || ""); return m ? m[1].trim() : null; };
async function wdTitles(ids) {  // wikidata → titre de la fiche française (une requête pour 50 lieux)
  const c = LS.get(K_WD, {}), need = [...new Set(ids.filter(q => /^Q\d+$/.test(q) && c[q] === undefined))];
  for (let i = 0; i < need.length; i += 50) {
    const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${need.slice(i, i + 50).join("|")}&props=sitelinks&sitefilter=frwiki&format=json&origin=*`);
    if (!r.ok) throw new Error("wikidata " + r.status);
    const j = await r.json(); need.slice(i, i + 50).forEach(q => { c[q] = j.entities?.[q]?.sitelinks?.frwiki?.title || ""; });
  }
  const keys = Object.keys(c); if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete c[k]);
  LS.set(K_WD, c); return c;
}
function anecdote(x) {  // 1 à 2 phrases, sans rien ajouter
  const S_ = String(x || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«])/);
  let out = S_[0] || ""; if (S_[1] && (out + " " + S_[1]).length <= 260) out += " " + S_[1];
  return out.length > 300 ? out.slice(0, 297).replace(/\s+\S*$/, "") + "…" : out;
}
async function summary(title, p) {
  const c = LS.get(K_WIKI, {}), e = c[title];
  if (e && Date.now() - e.at < WIKI_TTL) return e;
  const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  let v;
  if (r.status === 404) v = { ok: false };
  else if (!r.ok) throw new Error("wikipedia " + r.status);
  else { const j = await r.json(), co = j.coordinates;
    // anecdote seulement si la fiche parle bien de ce lieu (coordonnées à moins de 2 km quand elles existent)
    const sure = !co || dist([co.lat, co.lon], [p.lat, p.lon]) < 2000;
    v = { ok: j.type === "standard", x: sure ? anecdote(j.extract) : "", url: j.content_urls?.desktop?.page || `https://fr.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` }; }
  v.at = Date.now(); c[title] = v;
  const keys = Object.keys(c).sort((a, b) => c[a].at - c[b].at); if (keys.length > 150) keys.slice(0, keys.length - 150).forEach(k => delete c[k]);
  LS.set(K_WIKI, c); return v;
}
async function findVoir(seq) {
  if (!ST.cands || ST.voirSel || ST.voirBusy) return;
  ST.voirBusy = true; ST.voirErr = "";
  try {
    const C = ST.cands.slice(), wd = await wdTitles(C.filter(p => !frTitle(p.t) && p.t.wikidata).map(p => p.t.wikidata));
    C.forEach(p => { p.title = frTitle(p.t) || wd[p.t.wikidata] || null; });
    // un lieu par fiche (le plus proche), puis réparti le long du parcours : 5 tronçons, le meilleur de chaque
    const byT = new Map(); C.filter(p => p.title).forEach(p => { const q = byT.get(p.title); if (!q || p.off < q.off) byT.set(p.title, p); });
    const D = ST.ctx.P[ST.ctx.P.length - 1].d / 1000, score = p => KINDS[p.k].w * 100 - p.off / 3, seg = p => Math.min(4, Math.floor(p.km / D * 5));
    const pool_ = [...byT.values()].sort((a, b) => score(b) - score(a)), sel = [], tries = {};
    let fetched = 0;
    for (const p of pool_) {
      if (sel.length >= 5 || fetched >= 14) break;
      const s_ = seg(p); if (sel.some(q => seg(q) === s_) || (tries[s_] || 0) >= 3) continue;
      tries[s_] = (tries[s_] || 0) + 1; fetched++;
      const w = await summary(p.title, p); if (w.ok) { p.wiki = w; sel.push(p); }
    }
    // moins de 3 : on complète, en restant à plus de D/12 km des lieux déjà choisis
    for (const p of pool_) {
      if (sel.length >= 3 || fetched >= 14) break;
      if (sel.includes(p) || sel.some(q => Math.abs(q.km - p.km) < D / 12)) continue;
      fetched++; const w = await summary(p.title, p); if (w.ok) { p.wiki = w; sel.push(p); }
    }
    if (seq !== ST.seq) return;
    ST.voirSel = sel.sort((a, b) => a.km - b.km);
  } catch (e) { if (seq !== ST.seq) return; ST.voirSel = []; ST.voirErr = "Wikipédia ne répond pas pour l'instant : lieux à voir indisponibles."; }
  finally { ST.voirBusy = false; if (seq !== ST.seq && decouv() && !ST.voirSel) setTimeout(() => findVoir(ST.seq), 0); }  // trace ou heure changée entre-temps
  setList(); render(); drawMap(); ST.ctx.onIcons && ST.ctx.onIcons();
}
// appelé par sortie.js après chaque calcul ; ctx = { P, r, map, nut, route, onDone, onIcons }
async function update(ctx, retry) {
  const seq = ++ST.seq; ST.ctx = ctx;
  const sig = sigOf(ctx.route); if (sig !== ST.sig) { ST.sig = sig; ST.gps = (LS.get(K_GPS, {})[sig]) || {}; ST.showAll = false; }
  const L_ = corridor(ctx.P); if (!L_) { ST.poi = []; ST.err = ""; annotate(); render(); return; }
  const key = hash(L_);
  if (key !== ST.key || retry) { ST.poi = null; ST.err = ""; ST.list = []; ST.adv = []; ST.voirSel = null; ST.voirErr = ""; render(); drawMap();
    try { const els = await fetchPois(L_); if (seq !== ST.seq) return; ST.poi = els; ST.key = key; }
    catch (e) { if (seq !== ST.seq) return; ST.err = "Points d'arrêt indisponibles pour l'instant (le service OpenStreetMap ne répond pas)."; ST.key = null; render(); return; } }
  if (ST.poi.some(e => e.t.opening_hours)) await ohLib();
  if (seq !== ST.seq) return;
  annotate(); render(); drawMap(); ctx.onDone && ctx.onDone();
  if (decouv()) findVoir(seq);
}
// icônes sur le profil : [{x (m), ic, adv}]
function icons() {
  if (!ST.ctx || !ST.poi) return [];
  const on = catsOn(), adv = new Set(ST.adv.map(a => a.p.id));
  return ST.list.filter(p => on[p.cat] || adv.has(p.id)).map(p => ({ d: p.km * 1000, ic: KINDS[p.k].ic, adv: adv.has(p.id), name: p.name }));
}
// ------------------------------------------------------------------ Export GPS (GPX et FIT)
// Nom court lisible sur l'Edge (15 caractères au plus) : « Eau cimetière », « Boulang. 14h » (heure de fermeture si connue)
const cut15 = t => t.length <= 15 ? t : t.slice(0, 14).trimEnd() + ".";
const hShort = d => d.getMinutes() ? `${d.getHours()}h${pad(d.getMinutes())}` : `${d.getHours()}h`;
function shortName(p) {
  const K = KINDS[p.k] || {}, until = p.oh && p.oh.open === true && p.oh.next && sameDay(p.oh.next, p.t0) ? hShort(p.oh.next) : "";
  if (p.k === "water") { const n = (p.t.name || "").replace(/^(fontaine|point d'eau|robinet)\s*(du|de la|de l'|des|de)?\s*/i, ""); return cut15(n && n.length <= 11 ? `Eau ${n}` : /^fontaine/i.test(p.t.name || "") ? "Eau fontaine" : "Eau potable"); }
  if (p.k === "cemetery") return "Eau cimetière";
  if (p.k === "cafe") return cut15((p.t.amenity === "cafe" ? "Café" : "Bar") + (until ? " " + until : ""));
  if (p.cat === "voir") return cut15(p.name);
  return cut15(K.s + (until ? " " + until : ""));
}
// arrêts conseillés (sauf décochés) + points cochés, posés sur le tracé (Garmin Connect ignore les waypoints à plus de ~35 m)
function gpsPoints() {
  if (!ST.ctx || !ST.poi) return [];
  const P = ST.ctx.P, r = ST.ctx.r;
  return ST.list.filter(gpsOn).map(p => { const q = P[p.i], K = KINDS[p.k], st = statusTxt(p);
    return { lat: +q.lat.toFixed(6), lon: +q.lon.toFixed(6), d: q.d, t: r.T[p.i], name: shortName(p), type: K.fit || "generic", sym: K.sym || "Flag, Blue",
      desc: `${p.name}${p.name === K.l ? "" : ` · ${K.l}`} · km ${fmt(p.km, 1)} · vers ${hm(p.t0)} · à ${fmt(p.off)} m du tracé${st ? " · " + st : ""}`, adv: ST.adv.some(a => a.p.id === p.id) }; });
}
// pour la carte Nutrition : où remplir les bidons
function advice() { return ST.ctx && ST.poi ? ST.adv : []; }
window.Arrets = { update, icons, advice, gpsPoints, _shortName: shortName, _voirKind: voirKind, _anecdote: anecdote, _ohSimple: ohSimple, _place: place, _advise: advise, _corridor: corridor, _kindOf: kindOf };
})();
