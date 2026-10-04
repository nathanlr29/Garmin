"use strict";
// Onglet « Sortie » : on importe une trace GPX, et on prépare la sortie (vent, météo, soleil, montées).
(() => {
const $ = id => document.getElementById(id);
const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };
const pad = n => String(n).padStart(2, "0");
const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 0) => nf(v, d);
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${d.getHours()} h ${pad(d.getMinutes())}`;
const dur = s => { const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? `${h} h ${pad(m)}` : `${m} min`; };
const ticks = (lo, hi, n) => { const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(Math.round(v * 100) / 100); return out; };
const STEP = 25;  // un point de profil tous les 25 m
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const dirName = d => DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const DIRF = ["le nord", "le nord-nord-est", "le nord-est", "l'est-nord-est", "l'est", "l'est-sud-est", "le sud-est", "le sud-sud-est", "le sud", "le sud-sud-ouest", "le sud-ouest", "l'ouest-sud-ouest", "l'ouest", "l'ouest-nord-ouest", "le nord-ouest", "le nord-nord-ouest"];
const vers = d => DIRF[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const vdu = d => { const n = dirName(d); return /^[AEIOU]/.test(n) ? `d'${n}` : `du ${n}`; };  // « vent d'ouest », « vent du nord »
const WMO = c => c == null ? "" : c === 0 ? "Ciel clair" : c === 1 ? "Peu nuageux" : c === 2 ? "Éclaircies" : c === 3 ? "Couvert" : c <= 48 ? "Brouillard" : c <= 57 ? "Bruine" : c <= 67 ? "Pluie" : c <= 77 ? "Neige" : c <= 82 ? "Averses" : c <= 86 ? "Averses de neige" : "Orage";
const COL = { face: "#e03131", travers: "#f2a93b", dos: "#2f9e44", calme: "#868e96" };
const CAT = [["HC", 80000, "#7b1fa2"], ["1", 64000, "#c2255c"], ["2", 32000, "#e03131"], ["3", 16000, "#e8501c"], ["4", 8000, "#f08c00"], ["", 3500, "#a0896b"]];

const SO = { route: null, P: null, climbs: null, wx: null, wxKey: null, res: null, map: null, layers: [], hover: null, busy: false };

// ------------------------------------------------------------------ Géométrie
function dist(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]); const x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * 6371e3 * Math.asin(Math.sqrt(x)); }
function brg(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return (deg(Math.atan2(y, x)) + 360) % 360; }

function parseGPX(text, fname) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Ce fichier n'est pas un GPX lisible.");
  let nodes = [...doc.getElementsByTagName("trkpt")];
  if (nodes.length < 2) nodes = [...doc.getElementsByTagName("rtept")];
  if (nodes.length < 2) throw new Error("Aucune trace trouvée dans ce GPX.");
  const pts = nodes.map(n => { const e = n.getElementsByTagName("ele")[0]; const v = e ? parseFloat(e.textContent) : NaN; return [+n.getAttribute("lat"), +n.getAttribute("lon"), isFinite(v) ? v : null]; }).filter(p => isFinite(p[0]) && isFinite(p[1]));
  const nm = doc.querySelector("metadata > name, trk > name, rte > name");
  return { name: (nm && nm.textContent.trim()) || fname.replace(/\.gpx$/i, ""), pts: thin(pts) };
}
function thin(pts) {  // au plus un point tous les 10 m, pour alléger
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1], pts[i]); if (acc >= 10 || i === pts.length - 1) { out.push(pts[i]); acc = 0; } }
  return out.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, p[2] == null ? null : Math.round(p[2] * 10) / 10]);
}
async function fillElevation(pts) {  // GPX sans altitude (ou trace d'une sortie) : on demande l'altitude à Open-Meteo
  const have = pts.filter(p => p[2] != null).length;
  if (have > pts.length * .8) return pts;
  let cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1], n = clamp(Math.min(pts.length, Math.round(total / 100)), 2, 200);  // l'API compte chaque point : on reste sobre
  const idx = []; for (let k = 0, j = 0; k < n; k++) { const t = total * k / (n - 1); while (j < cum.length - 1 && cum[j] < t) j++; idx.push(j); }
  const el = [];
  for (let s = 0; s < idx.length; s += 100) {
    const part = idx.slice(s, s + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${part.map(i => pts[i][0]).join(",")}&longitude=${part.map(i => pts[i][1]).join(",")}`;
    let r = await fetch(url);
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 2500)); r = await fetch(url); }
    if (!r.ok) throw new Error(r.status === 429 ? "Le service d'altitude est saturé, réessaie dans une minute." : "Altitude indisponible pour cette trace.");
    el.push(...(await r.json()).elevation);
  }
  let k = 0;
  return pts.map((p, i) => { while (k < idx.length - 2 && idx[k + 1] <= i) k++; const a = idx[k], b = idx[k + 1], f = b > a ? (i - a) / (b - a) : 0; return [p[0], p[1], Math.round((el[k] + (el[k + 1] - el[k]) * clamp(f, 0, 1)) * 10) / 10]; });
}

// Profil régulier tous les 25 m : altitude lissée, pente, cap
function profile(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1], n = Math.max(2, Math.floor(total / STEP) + 1), P = [];
  let j = 0; let lastE = pts.find(p => p[2] != null)?.[2] ?? 0;
  for (let k = 0; k < n; k++) {
    const d = Math.min(total, k * STEP); while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const a = pts[j], b = pts[j + 1] || a, f = cum[j + 1] > cum[j] ? (d - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    const ea = a[2] ?? lastE, eb = b[2] ?? ea; lastE = ea;
    P.push({ d, lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, raw: ea + (eb - ea) * f });
  }
  if (P[P.length - 1].d < total) { const z = pts[pts.length - 1]; P.push({ d: total, lat: z[0], lon: z[1], raw: z[2] ?? lastE }); }
  const W = 4;  // lissage sur ± 100 m
  P.forEach((p, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - W); k <= Math.min(P.length - 1, i + W); k++) { s += P[k].raw; c++; } p.e = s / c; });
  P.forEach((p, i) => { const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)]; p.g = b.d > a.d ? (b.e - a.e) / (b.d - a.d) * 100 : 0; p.b = brg([a.lat, a.lon], [b.lat, b.lon]); });
  return P;
}
function climbs(P) {
  const out = [], n = P.length, TOL = 12;
  let i = 0;
  while (i < n - 1) {
    while (i < n - 1 && P[i + 1].e <= P[i].e) i++;
    let lo = i, peak = i, j = i;
    while (j < n - 1) { j++; if (P[j].e >= P[peak].e) peak = j; else if (P[peak].e - P[j].e > TOL) break; }
    // on retire les replats au pied et au sommet
    const gr = (a, b) => (P[b].e - P[a].e) / Math.max(1, P[b].d - P[a].d) * 100;
    while (lo < peak - 8 && gr(lo, lo + 8) < 2) lo += 2;
    let hi = peak; while (hi > lo + 8 && gr(hi - 8, hi) < 2) hi -= 2;
    const len = P[hi].d - P[lo].d, gain = P[hi].e - P[lo].e, avg = gain / Math.max(1, len) * 100;
    if (len >= 300 && gain >= 20 && avg >= 3) {
      const score = len * avg, cat = CAT.find(c => score >= c[1]);
      if (cat) { let mx = 0; for (let k = lo; k + 4 <= hi; k++) mx = Math.max(mx, gr(k, k + 4)); out.push({ lo, hi, len, gain, avg, max: Math.max(mx, avg), score, cat: cat[0], col: cat[2] }); }
    }
    i = Math.max(peak, i + 1);
  }
  return out;
}

// ------------------------------------------------------------------ Météo (Open-Meteo, sans clé)
function samples(P) {  // points météo tous les ~12 km
  const total = P[P.length - 1].d, n = clamp(Math.round(total / 12000) + 1, 2, 16), out = [];
  for (let k = 0; k < n; k++) { const d = total * k / (n - 1); out.push(P[Math.min(P.length - 1, Math.round(d / STEP))]); }
  return out;
}
async function loadWx(P, day) {  // uniquement le jour choisi (et le lendemain), pour ménager l'API
  const d2 = new Date(day); d2.setDate(d2.getDate() + 1);
  const S_ = samples(P), key = S_.map(p => p.lat.toFixed(2) + "," + p.lon.toFixed(2)).join(";") + "|" + ymd(day) + "|" + new Date().toISOString().slice(0, 13);
  if (SO.wxKey === key && SO.wx) return SO.wx;
  const H = "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${S_.map(p => p.lat.toFixed(3)).join(",")}&longitude=${S_.map(p => p.lon.toFixed(3)).join(",")}&hourly=${H}&daily=sunrise,sunset&start_date=${ymd(day)}&end_date=${ymd(d2)}&timezone=Europe%2FParis`;
  const r = await fetch(url);
  if (r.status === 400) throw new Error("Pas encore de prévisions pour cette date (16 jours maximum).");
  if (!r.ok) throw new Error(r.status === 429 ? "Trop de demandes météo, réessaie dans une minute." : "Prévisions météo indisponibles pour l'instant.");
  let j = await r.json(); if (!Array.isArray(j)) j = [j];
  const t0 = parseLocal(j[0].hourly.time[0]).getTime();
  SO.wx = { S: S_, loc: j, t0, nH: j[0].hourly.time.length, step: P[P.length - 1].d / Math.max(1, S_.length - 1) };
  SO.wxKey = key;
  return SO.wx;
}
function wxAt(wx, d, t) {  // valeurs météo interpolées au point (distance d) et à l'heure t
  const li = clamp(Math.round(d / wx.step), 0, wx.loc.length - 1), h = wx.loc[li].hourly;
  const x = (t - wx.t0) / 3600e3; if (x < 0 || x > wx.nH - 1) return null;
  const i = Math.floor(x), f = x - i, i2 = Math.min(wx.nH - 1, i + 1), L = k => h[k][i] + ((h[k][i2] ?? h[k][i]) - h[k][i]) * f;
  const u = k => h.wind_speed_10m[k] * Math.sin(rad(h.wind_direction_10m[k])), v = k => h.wind_speed_10m[k] * Math.cos(rad(h.wind_direction_10m[k]));
  const U = u(i) + (u(i2) - u(i)) * f, V = v(i) + (v(i2) - v(i)) * f;
  const near = f < .5 ? i : i2;
  return { ws: L("wind_speed_10m"), wd: (deg(Math.atan2(U, V)) + 360) % 360, gust: L("wind_gusts_10m"), temp: L("temperature_2m"), app: L("apparent_temperature"),
    pp: h.precipitation_probability[near] ?? 0, mm: h.precipitation[near] ?? 0, code: h.weather_code[near], cloud: h.cloud_cover[near], uv: h.uv_index[near] ?? 0, day: h.is_day[near], li };
}
function sun(wx, date) {
  const d = wx.loc[0].daily, k = d.time.indexOf(ymd(date));
  return k < 0 ? null : { rise: parseLocal(d.sunrise[k] + ":00"), set: parseLocal(d.sunset[k] + ":00") };
}

// ------------------------------------------------------------------ Simulation de la sortie
// ------------------------------------------------------------------ Modèle physique (puissance ↔ vitesse)
const PHY = { cda: .34, crr: .006, bike: 9.5, eta: .97, g: 9.81 };  // position mains sur les cocottes, routes bretonnes
const riderKg = () => +LS.get("bwWeight", 0) || 0;
const rhoAt = T => 1.225 * 288.15 / (273.15 + (T ?? 15));
function powerAt(v, M, gr, vw, rho) {  // v en m/s, gr = pente (fraction), vw = vent de face en m/s
  const th = Math.atan(gr), va = v + vw;
  return (M * PHY.g * (PHY.crr * Math.cos(th) + Math.sin(th)) * v + .5 * rho * PHY.cda * va * Math.abs(va) * v) / PHY.eta;
}
function speedFor(P, M, gr, vw, rho) { let lo = .5, hi = 25; for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (powerAt(m, M, gr, vw, rho) > P) hi = m; else lo = m; } return (lo + hi) / 2; }

function simulate(P, wx, start, v0, reverse) {
  const n = P.length, T = new Float64Array(n), Hd = new Float32Array(n), W = new Array(n);
  const idx = k => reverse ? n - 1 - k : k;
  let t = start.getTime(); T[idx(0)] = t;
  let face = 0, dos = 0, trav = 0, calme = 0, headSum = 0, dtSum = 0, rain = 0, ppMax = 0, gust = 0, uv = 0, tmin = 99, tmax = -99, amin = 99, codeMax = -1, U = 0, V = 0, dark = 0;
  let kj = 0, p4 = 0, tAll = 0;
  const total = P[n - 1].d, sn = wx ? sun(wx, start) : null;
  // puissance « de croisière » qui donne la vitesse prévue sur le plat sans vent ; on pousse un peu plus en montée, on récupère en descente
  const M = (riderKg() || 75) + PHY.bike, P0 = powerAt(v0 / 3.6, M, 0, 0, rhoAt(15));
  for (let k = 1; k < n; k++) {
    const p = P[idx(k)], q = P[idx(k - 1)], step = Math.abs(p.d - q.d), g = reverse ? -p.g : p.g, b = reverse ? (p.b + 180) % 360 : p.b;
    const w = wx ? wxAt(wx, p.d, t) : null; W[idx(k)] = w;
    const head = w ? w.ws * Math.cos(rad(w.wd - b)) : 0, gr = clamp(g, -25, 25) / 100;
    const Pt = gr > 0 ? P0 * (1 + Math.min(.25, 3 * gr)) : P0 * Math.max(0, 1 + 15 * gr);
    const v = clamp(speedFor(Pt, M, gr, head / 3.6 * .75, rhoAt(w ? w.temp : 15)), 1.9, 15.3);  // 7 à 55 km/h
    const dt = step / v; t += dt * 1000; T[idx(k)] = t; Hd[idx(k)] = head;
    kj += Pt * dt / 1000; p4 += Pt ** 4 * dt; tAll += dt;
    if (w) {
      const km = step / 1000, c = w.ws < 8 ? "calme" : head > w.ws * .5 ? "face" : head < -w.ws * .5 ? "dos" : "travers";
      if (c === "face") face += km; else if (c === "dos") dos += km; else if (c === "travers") trav += km; else calme += km;
      headSum += head * dt; dtSum += dt; rain += w.mm * dt / 3600; ppMax = Math.max(ppMax, w.pp); gust = Math.max(gust, w.gust); uv = Math.max(uv, w.uv);
      tmin = Math.min(tmin, w.temp); tmax = Math.max(tmax, w.temp); amin = Math.min(amin, w.app); codeMax = Math.max(codeMax, w.code);
      U += w.ws * Math.sin(rad(w.wd)) * dt; V += w.ws * Math.cos(rad(w.wd)) * dt;
      if (sn && (t < sn.rise.getTime() || t > sn.set.getTime())) dark += dt;
    }
  }
  const secs = (t - start.getTime()) / 1000, ok = wx && dtSum > 0;
  return { T, Hd, W, secs, end: new Date(t), ok, face, dos, trav, calme, total: total / 1000, head: ok ? headSum / dtSum : 0, rain, ppMax, gust, uv, tmin, tmax, amin, codeMax,
    ws: ok ? Math.hypot(U, V) / dtSum : 0, wd: ok ? (deg(Math.atan2(U, V)) + 360) % 360 : 0, dark, sun: sn,
    kj, avgP: kj * 1000 / Math.max(1, tAll), np: Math.pow(p4 / Math.max(1, tAll), .25), P0, M };
}
function penalty(r) {
  return Math.max(0, r.head) * 1.2 + Math.min(0, r.head) * .4 + r.rain * 6 + r.ppMax * .08 + r.dark / 60 * .25 + Math.max(0, 8 - r.amin) * 1.5 + Math.max(0, r.tmax - 28) * 1.5;
}

// ------------------------------------------------------------------ Réglages
function defSpeed() {
  const cut = Date.now() - 90 * 864e5, R = (S.all || []).filter(a => RIDE_TYPES.has(a.t) && !isIndoor(a) && a.dt.getTime() > cut && a.km >= 30 && a.mt > 0);
  const km = R.reduce((s, a) => s + a.km, 0), h = R.reduce((s, a) => s + a.mt, 0) / 3600;
  return h > 0 ? Math.round(km / h * 1.04 * 2) / 2 : 27;
}
function settings() {
  const s = LS.get("sortieSet", {}), now = new Date();
  let date = s.date && s.date >= ymd(now) ? s.date : null, hour = s.hour ?? 9;
  if (!date) { date = ymd(now); if (now.getHours() >= 15) { const t = new Date(now); t.setDate(t.getDate() + 1); date = ymd(t); } else hour = Math.max(hour, now.getHours() + 1); }
  return { date, hour, min: s.min ?? 0, speed: s.speed || defSpeed() };
}
const startOf = s => { const [y, m, d] = s.date.split("-").map(Number); return new Date(y, m - 1, d, s.hour, s.min); };

// ------------------------------------------------------------------ Affichage
async function ensureLeaflet() {
  if (window.L) return;
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(css);
  await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = ok; s.onerror = () => ko(new Error("Carte indisponible")); document.head.appendChild(s); });
}
function shell() {
  const box = $("sortie");
  if (box.dataset.ready) return;
  box.dataset.ready = 1;
  box.innerHTML = `<div class="grid">
    <section class="card span12" id="soLoad"></section>
    <div class="span12 sosub" id="soBody" hidden>
      <div class="grid">
        <section class="span12"><div class="tiles sotiles" id="soTiles"></div></section>
        <section class="card span12 soverdict" id="soVerdict"></section>
        <section class="card span8"><h2>Vent sur le parcours <span class="legend"><span><i style="background:${COL.face}"></i>face</span><span><i style="background:${COL.travers}"></i>côté</span><span><i style="background:${COL.dos}"></i>dos</span><span><i style="background:${COL.calme}"></i>faible</span></span></h2><div id="soMap"></div><p class="note">Flèches : sens du vent prévu (à 10 m du sol, au guidon c'est souvent un peu moins, surtout entre les talus).</p></section>
        <section class="card span4"><h2>Meilleur créneau <small id="soBestInfo"></small></h2><div id="soBest"></div></section>
        <section class="card span12"><h2>Profil <small id="soProfInfo"></small></h2><div id="soProf"></div></section>
        <section class="card span7"><h2>Montées <small id="soClimbInfo"></small></h2><div id="soClimbs"></div></section>
        <section class="card span5"><h2>Pratique</h2><div id="soTips"></div></section>
        <section class="card span12"><h2>Nutrition <small id="soNutInfo"></small></h2><div id="soNut"></div></section>
        <section class="card span12"><h2>Météo au fil de la sortie</h2><div id="soTimeline"></div></section>
      </div>
    </div>
  </div>`;
}
function renderLoad() {
  const r = SO.route, s = settings();
  const recent = (S.all || []).filter(a => RIDE_TYPES.has(a.t) && !isIndoor(a) && a.km >= 20 && S.traces && S.traces[a.id]).slice(-30).reverse();
  $("soLoad").innerHTML = r ? `
    <div class="sohead"><div><div class="soname">${esc(r.name)}</div><div class="sosmall">${fmt(SO.P[SO.P.length - 1].d / 1000, 1)} km · ${fmt(gain(SO.P))} m D+</div></div>
      <div class="soform">
        <label>Départ <input type="date" id="soDate" value="${s.date}" min="${ymd(new Date())}"></label>
        <label><select id="soHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === s.hour ? "selected" : ""}>${h} h</option>`).join("")}</select></label>
        <label><select id="soMin">${[0, 15, 30, 45].map(m => `<option value="${m}" ${m === s.min ? "selected" : ""}>${pad(m)}</option>`).join("")}</select></label>
        <label>Vitesse sur le plat <input type="number" id="soSpeed" min="12" max="45" step="0.5" value="${s.speed}"> km/h</label>
        <label>Poids <input type="number" id="soKg" min="35" max="150" step="0.1" value="${riderKg() || ""}" placeholder="75"> kg</label>
        <button class="btn" id="soChange">Changer de trace</button><button class="btn" id="soLoop">${SO.genOpen ? "Masquer" : "Créer une boucle"}</button>${r.gen ? `<button class="btn" id="soGpx">Exporter en GPX</button>` : ""}
      </div></div>
    <div class="sogen" id="soGen" ${SO.genOpen ? "" : "hidden"}></div>
    <input type="file" id="soFile" hidden>` : `
    <h2>Planifier une sortie</h2>
    <label class="sodrop" id="soDrop"><input type="file" id="soFile"><b>Importer une trace GPX</b><span>Dans Garmin Connect : Entraînement et planification → Parcours → ouvre le parcours → ⋯ → Exporter au format GPX.</span></label>
    ${recent.length ? `<div class="sorecent"><label>ou refaire une sortie récente <select id="soRecent"><option value="">choisir…</option>${recent.map(a => `<option value="${a.id}">${a.dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${esc(a.n)} · ${fmt(a.km)} km</option>`).join("")}</select></label></div>` : ""}
    <p class="soerr" id="soErr"></p>
    <div class="sogen" id="soGen"></div>`;
  const file = $("soFile");
  file.onchange = async () => { const f = file.files[0]; if (!f) return; try { setRoute(parseGPX(await f.text(), f.name)); } catch (e) { showErr(e.message); } };
  if ($("soChange")) $("soChange").onclick = () => file.click();
  if ($("soLoop")) $("soLoop").onclick = () => { SO.genOpen = !SO.genOpen; renderLoad(); };
  if ($("soGpx")) $("soGpx").onclick = exportGPX;
  if ($("soGen") && !$("soGen").hidden) renderGen();
  const drop = $("soDrop");
  if (drop) { drop.ondragover = e => { e.preventDefault(); drop.classList.add("on"); }; drop.ondragleave = () => drop.classList.remove("on");
    drop.ondrop = async e => { e.preventDefault(); drop.classList.remove("on"); const f = e.dataTransfer.files[0]; if (f) try { setRoute(parseGPX(await f.text(), f.name)); } catch (er) { showErr(er.message); } }; }
  if ($("soRecent")) $("soRecent").onchange = e => { const a = S.all.find(x => String(x.id) === e.target.value); if (a) setRoute({ name: a.n, pts: S.traces[a.id].map(p => [p[0], p[1], null]) }); };
  const save = () => { LS.set("sortieSet", { date: $("soDate").value, hour: +$("soHour").value, min: +$("soMin").value, speed: +$("soSpeed").value || defSpeed() }); compute(); };
  ["soDate", "soHour", "soMin", "soSpeed"].forEach(id => { if ($(id)) $(id).onchange = save; });
  if ($("soKg")) $("soKg").onchange = () => { const v = +$("soKg").value; LS.set("bwWeight", v >= 35 && v <= 150 ? v : null); compute(); };
}
function showErr(m) { const e = $("soErr"); if (e) e.textContent = m; else alert(m); }
function gain(P) { let g = 0; for (let i = 1; i < P.length; i++) g += Math.max(0, P[i].e - P[i - 1].e); return g; }

async function setRoute(r) {
  showErr("Analyse de la trace…");
  try {
    r.pts = await fillElevation(r.pts);
    if (!LS.set("sortieRoute", r)) { r.pts = r.pts.filter((_, i) => i % 3 === 0 || i === r.pts.length - 1); LS.set("sortieRoute", r); }
    SO.route = r; SO.P = profile(r.pts); SO.climbs = climbs(SO.P); SO.wx = null;
    renderLoad(); $("soBody").hidden = false; compute();
  } catch (e) { showErr(e.message); }
}

async function compute() {
  if (!SO.P) return;
  const s = settings(), start = startOf(s);
  let wx = null, err = "";
  try { wx = await loadWx(SO.P, start); } catch (e) { err = e.message; }
  if (wx && wx.loc[0].hourly.temperature_2m.every(v => v == null)) { err = "Pas encore de prévisions pour cette date (16 jours maximum)."; wx = null; }
  const res = simulate(SO.P, wx, start, s.speed, false);
  SO.res = res;
  const loop = dist([SO.P[0].lat, SO.P[0].lon], [SO.P[SO.P.length - 1].lat, SO.P[SO.P.length - 1].lon]) < 3000;
  const rev = wx && loop ? simulate(SO.P, wx, start, s.speed, true) : null;
  // créneaux de départ de la journée
  const best = [];
  if (wx) for (let h = 6; h <= 19; h++) { const st = new Date(start); st.setHours(h, 0, 0, 0); if (st < Date.now() - 36e5) continue; const r = simulate(SO.P, wx, st, s.speed, false); if (r.ok) best.push({ h, r, p: penalty(r) }); }
  renderTiles(res, err); renderVerdict(res, rev, best, err, s); renderBest(best, s);
  await renderMap(res, wx); renderProfile(res); renderClimbs(res); renderTips(res, wx); renderNutrition(res); renderTimeline(res, wx);
}

function renderTiles(r, err) {
  const sn = r.sun, late = sn && r.end > sn.set;
  const tile = (l, v, s, c) => `<div class="tile"><div class="l">${l}</div><div class="v"${c ? ` style="color:${c}"` : ""}>${v}</div><div class="s">${s}</div></div>`;
  $("soTiles").innerHTML = [
    tile("Distance", `${fmt(r.total, 1)}<small> km</small>`, `${fmt(gain(SO.P))} m D+ · ${fmt(r.total ? gain(SO.P) / r.total : 0)} m/km`),
    tile("Durée estimée", dur(r.secs), `arrivée vers ${hm(r.end)}${late ? " · après le coucher du soleil" : ""}`, late ? "#e03131" : null),
    r.ok ? tile("Vent", `${fmt(r.ws)}<small> km/h</small>`, `${vdu(r.wd)} · rafales ${fmt(r.gust)} km/h`) : tile("Vent", "–", err || "prévisions indisponibles"),
    r.ok ? tile("Vent de face", `${fmt(r.face / r.total * 100)}<small> %</small>`, `de dos ${fmt(r.dos / r.total * 100)} % · côté ${fmt(r.trav / r.total * 100)} %`, r.face / r.total > .4 ? "#e03131" : r.dos > r.face ? "#2f9e44" : null) : "",
    r.ok ? tile("Températures", `${fmt(r.tmin)}–${fmt(r.tmax)}<small> °C</small>`, `ressenti mini ${fmt(r.amin)} °C`) : "",
    r.ok ? tile("Pluie", r.rain >= .2 ? `${fmt(r.rain, 1)}<small> mm</small>` : `${fmt(r.ppMax)}<small> %</small>`, r.rain >= .2 ? `risque max ${fmt(r.ppMax)} % · ${WMO(r.codeMax).toLowerCase()}` : `risque max · ${WMO(r.codeMax).toLowerCase()}`, r.rain >= 1 ? "#1c7ed6" : null) : "",
  ].join("");
}
function renderVerdict(r, rev, best, err, s) {
  const box = $("soVerdict");
  if (!r.ok) { box.innerHTML = `<p>${err || "Prévisions indisponibles."} Je peux quand même t'afficher le profil et les montées.</p>`; return; }
  const L = [];
  // où se trouve le vent de face
  const n = SO.P.length, parts = [0, 1, 2].map(k => { let s_ = 0, c = 0; for (let i = Math.floor(n * k / 3); i < Math.floor(n * (k + 1) / 3); i++) { s_ += r.Hd[i]; c++; } return s_ / Math.max(1, c); });
  const worst = parts.indexOf(Math.max(...parts)), names = ["le premier tiers", "le milieu", "le dernier tiers"];
  L.push(`Vent ${vdu(r.wd)} autour de ${fmt(r.ws)} km/h (rafales ${fmt(r.gust)}).` + (parts[worst] > 5 ? ` C'est dans ${names[worst]} de la sortie que tu l'auras le plus de face.` : " Peu gênant sur ce parcours."));
  if (parts[2] > 6 && parts[0] < 0) L.push("Attention : retour vent de face, garde des forces.");
  else if (parts[0] > 6 && parts[2] < 0) L.push("Bonne configuration : vent de face à l'aller, retour poussé par le vent.");
  if (rev) { const a = r.face / r.total, b = rev.face / rev.total; if (b < a - .1 || (parts[2] > 6 && rev.head < r.head - 2)) L.push(`Dans l'autre sens, tu aurais ${fmt(b * 100)} % de vent de face au lieu de ${fmt(a * 100)} % : ça vaut le coup d'y penser.`); }
  if (r.rain >= 1) L.push(`Pluie attendue (${fmt(r.rain, 1)} mm sur la sortie) : garde-boue, veste, et chaîne à regraisser au retour.`);
  else if (r.ppMax >= 40) L.push(`Risque d'averse jusqu'à ${fmt(r.ppMax)} % : prends un coupe-vent.`);
  const bb = best.length ? best.reduce((a, b) => b.p < a.p ? b : a) : null, cur = best.find(b => b.h === s.hour);
  if (bb && cur && bb.h !== s.hour && cur.p - bb.p > 4) L.push(`Un départ à ${bb.h} h serait plus agréable (${bb.r.rain >= .5 ? `${fmt(bb.r.rain, 1)} mm de pluie, ` : ""}${fmt(bb.r.face / bb.r.total * 100)} % de vent de face).`);
  box.innerHTML = `<p>${L.join(" ")}</p>`;
}
function renderBest(best, s) {
  const box = $("soBest");
  if (!best.length) { box.innerHTML = `<p class="note">Choisis une date dans les 16 prochains jours.</p>`; $("soBestInfo").textContent = ""; return; }
  const mx = Math.max(...best.map(b => b.p)), mn = Math.min(...best.map(b => b.p));
  $("soBestInfo").textContent = new Date(startOf(s)).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
  box.innerHTML = `<div class="sobest">${best.map(b => { const q = mx > mn ? 1 - (b.p - mn) / (mx - mn) : 1, col = q > .75 ? "#2f9e44" : q > .45 ? "#f2a93b" : "#e03131";
    return `<button data-h="${b.h}" class="${b.h === s.hour ? "sel" : ""}" title="${b.h} h : vent de face ${fmt(b.r.face / b.r.total * 100)} %, pluie ${fmt(b.r.rain, 1)} mm, ${fmt(b.r.tmin)}-${fmt(b.r.tmax)} °C"><i style="height:${18 + q * 62}px;background:${col}"></i><span>${b.h}</span></button>`; }).join("")}</div>
    <p class="note">Plus la barre est haute, plus le créneau est agréable (vent, pluie, froid, nuit). Touche une heure pour la choisir.</p>`;
  box.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { LS.set("sortieSet", { ...settings(), hour: +b.dataset.h, min: 0 }); renderLoad(); compute(); });
}

function arrowIcon(w) {
  const sz = 28;
  return L.divIcon({ className: "sowind", iconSize: [sz, sz + 14], iconAnchor: [sz / 2, sz / 2],
    html: `<svg viewBox="-17 -17 34 34" width="${sz}" height="${sz}" style="transform:rotate(${(w.wd + 180) % 360}deg)"><circle r="15" fill="#fff" stroke="#1c7ed6" stroke-width="1.5" opacity=".92"/><path d="M0,-11 L7,5 L0,1 L-7,5 Z" fill="#1c7ed6"/></svg><b>${fmt(w.ws)}</b>` });
}
async function renderMap(r, wx) {
  try { await ensureLeaflet(); } catch (e) { $("soMap").innerHTML = `<p class="note">Carte indisponible.</p>`; return; }
  if (!SO.map) {
    SO.map = L.map("soMap", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(SO.map);
  }
  SO.layers.forEach(l => l.remove()); SO.layers = [];
  const P = SO.P, add = l => { l.addTo(SO.map); SO.layers.push(l); return l; };
  // tracé coloré par tronçons de 500 m selon le vent
  const seg = 20;
  add(L.polyline(P.map(p => [p.lat, p.lon]), { color: "#fff", weight: 8, opacity: .9 }));
  for (let i = 0; i < P.length - 1; i += seg) {
    const j = Math.min(P.length - 1, i + seg), mid = Math.floor((i + j) / 2), w = r.W[mid] || r.W[j];
    const c = !w ? "#e8501c" : w.ws < 8 ? COL.calme : r.Hd[mid] > w.ws * .5 ? COL.face : r.Hd[mid] < -w.ws * .5 ? COL.dos : COL.travers;
    add(L.polyline(P.slice(i, j + 1).map(p => [p.lat, p.lon]), { color: c, weight: 5, opacity: 1, lineCap: "round" }));
  }
  // montées
  SO.climbs.forEach((c, k) => add(L.polyline(P.slice(c.lo, c.hi + 1).map(p => [p.lat, p.lon]), { color: c.col, weight: 3, opacity: .9, dashArray: "1 7" })));
  SO.climbs.forEach((c, k) => add(L.marker([P[c.hi].lat, P[c.hi].lon], { icon: L.divIcon({ className: "soclimb", html: `<span style="background:${c.col}">${c.cat || "▲"}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(`Montée ${k + 1} · ${fmt(c.len / 1000, 1)} km à ${fmt(c.avg, 1)} %`)));
  // flèches de vent aux points météo, à l'heure de passage
  if (wx) wx.S.filter((_, i, a) => a.length <= 9 || i % Math.ceil(a.length / 9) === 0).forEach(p => { const k = Math.min(P.length - 1, Math.round(p.d / STEP)), w = r.W[k] || wxAt(wx, p.d, r.T[k]); if (w) add(L.marker([p.lat, p.lon], { icon: arrowIcon(w), interactive: false })); });
  add(L.circleMarker([P[0].lat, P[0].lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#2f9e44", fillOpacity: 1 }).bindTooltip("Départ"));
  add(L.circleMarker([P[P.length - 1].lat, P[P.length - 1].lon], { radius: 6, color: "#fff", weight: 3, fillColor: "#15171c", fillOpacity: 1 }).bindTooltip("Arrivée"));
  SO.hover = add(L.circleMarker([P[0].lat, P[0].lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#e8501c", opacity: 0, fillOpacity: 0 }));
  SO.map.fitBounds(L.latLngBounds(P.map(p => [p.lat, p.lon])), { padding: [24, 24] });
  setTimeout(() => SO.map.invalidateSize(), 50);
}

function renderProfile(r) {
  const P = SO.P, box = $("soProf"), Wd = Math.max(320, box.clientWidth || 800), H = 190, pl = 34, pr = 8, pt = 10, pb = 34;
  const total = P[P.length - 1].d, emin = Math.min(...P.map(p => p.e)), emax = Math.max(...P.map(p => p.e));
  const lo = Math.floor((emin - 5) / 10) * 10, hi = Math.max(lo + 40, Math.ceil((emax + 5) / 10) * 10);
  const X = d => pl + d / total * (Wd - pl - pr), Y = e => pt + (1 - (e - lo) / (hi - lo)) * (H - pt - pb);
  const step = Math.max(1, Math.floor(P.length / 600)), pts = P.filter((_, i) => i % step === 0 || i === P.length - 1);
  const area = `M${X(0)},${Y(lo)}` + pts.map(p => `L${X(p.d).toFixed(1)},${Y(p.e).toFixed(1)}`).join("") + `L${X(total)},${Y(lo)}Z`;
  const cl = SO.climbs.map((c, k) => { const ps = P.slice(c.lo, c.hi + 1).filter((_, i) => i % step === 0); return `<path d="M${X(P[c.lo].d)},${Y(lo)}${ps.map(p => `L${X(p.d).toFixed(1)},${Y(p.e).toFixed(1)}`).join("")}L${X(P[c.hi].d)},${Y(P[c.hi].e)}L${X(P[c.hi].d)},${Y(lo)}Z" fill="${c.col}" opacity=".75"/><text x="${X((P[c.lo].d + P[c.hi].d) / 2)}" y="${Y(P[c.hi].e) - 5}" text-anchor="middle" class="socl">${k + 1}</text>`; }).join("");
  const yt = ticks(lo, hi, 4).map(v => `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 5}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join("");
  const kmT = ticks(0, total / 1000, Wd < 500 ? 4 : 8).map(v => `<text x="${X(v * 1000)}" y="${H - pb + 13}" text-anchor="middle" class="ax">${v}</text>`).join("");
  let strip = "";
  if (r.ok) { const sg = 20; for (let i = 0; i < P.length - 1; i += sg) { const j = Math.min(P.length - 1, i + sg), m = Math.floor((i + j) / 2), w = r.W[m]; if (!w) continue; const c = w.ws < 8 ? COL.calme : r.Hd[m] > w.ws * .5 ? COL.face : r.Hd[m] < -w.ws * .5 ? COL.dos : COL.travers; strip += `<rect x="${X(P[i].d)}" y="${H - 14}" width="${Math.max(.5, X(P[j].d) - X(P[i].d) + .3)}" height="8" fill="${c}"/>`; } }
  box.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" height="${H}" class="soprof">${yt}<path d="${area}" fill="var(--accent-soft)" stroke="none"/>${cl}<path d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p.e).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2"/>${kmT}${strip}<line id="soCur" y1="${pt}" y2="${H - pb}" stroke="var(--ink)" stroke-width="1" opacity="0"/><rect x="${pl}" y="0" width="${Wd - pl - pr}" height="${H}" fill="transparent" id="soHit"/></svg>`;
  $("soProfInfo").textContent = `${fmt(emin)}–${fmt(emax)} m · bande du bas : vent`;
  const hit = $("soHit"), cur = $("soCur");
  const move = ev => {
    const rc = hit.getBoundingClientRect(), x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rc.left) / rc.width;
    const d = clamp(x, 0, 1) * total, k = Math.min(P.length - 1, Math.round(d / STEP)), p = P[k], w = r.W[k];
    cur.setAttribute("x1", X(d)); cur.setAttribute("x2", X(d)); cur.setAttribute("opacity", ".5");
    if (SO.hover) { SO.hover.setLatLng([p.lat, p.lon]); SO.hover.setStyle({ opacity: 1, fillOpacity: 1 }); }
    showTip(ev.touches ? ev.touches[0] : ev, `<b>km ${fmt(d / 1000, 1)}</b> · ${fmt(p.e)} m · ${fmt(p.g, 1)} %<br>passage vers ${hm(new Date(r.T[k]))}${w ? `<br>${fmt(w.temp)} °C · vent ${vdu(w.wd)} ${fmt(w.ws)} km/h${w.ws >= 8 ? ` (${r.Hd[k] > w.ws * .5 ? "de face" : r.Hd[k] < -w.ws * .5 ? "de dos" : "de côté"})` : ""}${w.pp >= 20 ? `<br>pluie ${fmt(w.pp)} %` : ""}` : ""}`);
  };
  hit.onmousemove = move; hit.ontouchmove = e => { move(e); e.preventDefault(); }; hit.ontouchstart = move;
  hit.onmouseleave = hit.ontouchend = () => { hideTip(); cur.setAttribute("opacity", "0"); if (SO.hover) SO.hover.setStyle({ opacity: 0, fillOpacity: 0 }); };
}
function renderClimbs(r) {
  const C = SO.climbs, P = SO.P;
  const cats = C.filter(c => c.cat).length;
  $("soClimbInfo").textContent = C.length ? `${C.length} montée${C.length > 1 ? "s" : ""}${cats ? `, dont ${cats} classée${cats > 1 ? "s" : ""}` : ""}` : "";
  if (!C.length) { $("soClimbs").innerHTML = `<p class="note">Pas de vraie montée sur ce parcours (aucune côte de plus de 300 m à 3 % et 20 m de dénivelé).</p>`; return; }
  $("soClimbs").innerHTML = `<table class="sotab"><thead><tr><th></th><th>km</th><th>Longueur</th><th>D+</th><th>Pente</th><th>Max</th><th>Passage</th></tr></thead><tbody>${C.map((c, k) => { const m = Math.floor((c.lo + c.hi) / 2), w = r.W[m], hd = r.Hd[m];
    return `<tr><td><span class="socat" style="background:${c.col}">${c.cat ? (c.cat === "HC" ? "HC" : "Cat " + c.cat) : "Côte"}</span></td><td>${fmt(P[c.lo].d / 1000, 1)}</td><td>${c.len >= 1000 ? fmt(c.len / 1000, 1) + " km" : fmt(c.len) + " m"}</td><td>${fmt(c.gain)} m</td><td><b>${fmt(c.avg, 1)} %</b></td><td>${fmt(c.max, 1)} %</td><td>${hm(new Date(r.T[c.lo]))}${w && w.ws >= 8 ? `<small>${hd > w.ws * .5 ? "vent de face" : hd < -w.ws * .5 ? "vent de dos" : "vent de côté"}</small>` : ""}</td></tr>`; }).join("")}</tbody></table>
    <p class="note">Catégories façon Strava (longueur × pente). Pente max mesurée sur 100 m, profil lissé : les vrais murs peuvent être un peu plus raides.</p>`;
}
function renderTips(r, wx) {
  const T = [];
  if (r.ok) {
    const a = r.amin, wet = r.rain >= .5 || r.ppMax >= 50;
    const kit = a < 3 ? "Hiver : collant long, veste thermique, gants longs, couvre-chaussures, cache-cou." : a < 8 ? "Frais : collant ou jambières, maillot manches longues + coupe-vent, gants longs." : a < 13 ? "Mi-saison : manchettes et jambières (ou genouillères), gilet coupe-vent." : a < 18 ? "Cuissard court, manchettes au départ, gilet dans la poche." : "Tenue d'été." + (r.tmax >= 26 ? " Couleurs claires, ça va chauffer." : "");
    T.push(["Tenue", kit + (wet ? " Veste de pluie et garde-boue." : "")]);
    if (r.sun) { const late = r.end > r.sun.set, dusk = r.end > new Date(r.sun.set.getTime() - 1800e3); T.push(["Soleil", `Lever ${hm(r.sun.rise)}, coucher ${hm(r.sun.set)}.${late ? " Tu rentres de nuit : éclairage avant et arrière obligatoires." : dusk ? " Arrivée proche du coucher : prends tes lumières." : ""}${r.uv >= 5 ? ` UV jusqu'à ${fmt(r.uv)} : crème solaire.` : ""}`]); }
    if (r.gust >= 50) T.push(["Rafales", `Jusqu'à ${fmt(r.gust)} km/h : prudence dans les descentes et sur les zones dégagées.`]);
  }
  try { const st = window.Chain?.status?.(); if (st && st.km != null) { const after = st.km + r.total; T.push(["Chaîne", r.rain >= .5 ? "Sortie humide : nettoie et regraisse la chaîne en rentrant (Squirt)." : after >= st.lim ? `Avec cette sortie tu seras à ${fmt(after)} km depuis le graissage (rappel à ${st.lim}) : graisse-la la veille.` : `${fmt(after)} km sur la chaîne après cette sortie, ça passe.`]); } } catch (e) {}
  $("soTips").innerHTML = T.length ? `<dl class="sotips">${T.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : `<p class="note">Les conseils apparaissent avec les prévisions.</p>`;
}
// ------------------------------------------------------------------ Nutrition
function renderNutrition(r) {
  const box = $("soNut"); if (!box) return;
  const ftp = (window.Plan && Plan.ftp && Plan.ftp()) || 0, kg = riderKg(), h = r.secs / 3600, P = SO.P;
  const IF = ftp ? r.np / ftp : null, x = IF ?? .7;
  const kcal = r.kj / (4.184 * .24);                          // rendement humain ≈ 24 %
  const choFrac = clamp(.35 + (x - .5) * 1.5, .3, .95);       // part des glucides dans l'énergie selon l'intensité
  const burn = kcal * choFrac / 4 / h;                        // g de glucides brûlés par heure
  const lvl = clamp((x - .6) / .2, 0, 1);
  let rate = h < 1.25 ? 0 : h < 2 ? 30 : h < 3 ? 45 + 15 * lvl : 60 + 30 * lvl;
  rate = Math.round(Math.max(Math.min(rate, burn), h >= 3 ? 45 : 0) / 5) * 5;  // jamais plus que ce qu'on brûle, mais au moins 45 g/h au-delà de 3 h
  const tAvg = r.ok ? (r.tmin + r.tmax) / 2 : 15;
  const drink = Math.round(clamp(.4 + .03 * (tAvg - 10) + .5 * (x - .6), .35, 1.3) * .8 * 20) / 20;  // L/h (≈ 80 % de la sueur)
  const na = Math.round(drink * (tAvg > 25 ? 700 : 500) / 50) * 50;                                 // mg de sodium par heure
  const water = drink * h, carbs = rate * h, iso = rate >= 60;
  // horaire : on mange toutes les 30 min à partir de 30-40 min, et on repère quand les 2 bidons sont vides
  const kmAt = tt => { let k = 0; while (k < P.length - 1 && r.T[k] < tt) k++; return P[k].d / 1000; };
  const t0 = r.T[0], rows = [];
  if (rate > 0) for (let m = 35; m <= h * 60 - 20; m += 30) {
    const late = m > h * 40, g = Math.round((iso ? rate - 36 : rate) / 2);
    const food = g <= 0 ? "boisson iso uniquement" : g <= 22 ? (late ? "1 gel" : "1 banane ou 1 pâte de fruits") : g <= 32 ? (late ? "1 gel + quelques gorgées iso" : "1 barre") : late ? "1 gel + 1 pâte de fruits" : "1 barre + 1 gel";
    rows.push({ t: new Date(t0 + m * 6e4), km: kmAt(t0 + m * 6e4), what: `${food} <small>≈ ${Math.max(0, g)} g</small>` });
  }
  const cap = 1.2;  // 2 bidons de 600 ml
  for (let k = 1; k * cap < water; k++) { const tt = t0 + k * cap / drink * 3600e3; rows.push({ t: new Date(tt), km: kmAt(tt), what: `<b>Remplir les bidons</b> <small>(${fmt(k * cap, 1)} L bus)</small>`, water: 1 }); }
  rows.sort((a, b) => a.t - b.t);
  $("soNutInfo").textContent = `${fmt(kcal)} kcal${ftp ? ` · intensité ${Math.round(x * 100)} % FTP` : ""}`;
  const tile = (l, v, s_) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s_}</div></div>`;
  box.innerHTML = `<div class="tiles sotiles nuttiles">
      ${tile("Dépense", `${fmt(kcal)}<small> kcal</small>`, `${fmt(r.kj)} kJ · ${fmt(r.avgP)} W moyens`)}
      ${tile("Intensité", ftp ? `${Math.round(x * 100)}<small> % FTP</small>` : "–", ftp ? `≈ ${fmt(r.np)} W normalisés (FTP ${ftp} W)` : "FTP inconnue")}
      ${tile("Glucides", rate ? `${rate}<small> g/h</small>` : "0", rate ? `${fmt(carbs)} g au total` : "sortie courte : l'eau suffit")}
      ${tile("Boire", `${fmt(drink * 1000)}<small> ml/h</small>`, `${fmt(water, 1)} L · ${Math.ceil(water / .6)} bidon${Math.ceil(water / .6) > 1 ? "s" : ""}`)}
      ${tile("Sel", `${na}<small> mg/h</small>`, tAvg > 25 ? "chaleur : pastilles d'électrolytes" : "boisson iso ou pastille")}
      ${tile("Brûlés", `${fmt(burn)}<small> g/h</small>`, `glucides utilisés (${Math.round(choFrac * 100)} % de l'énergie)`)}
    </div>
    <div class="nutgrid">
      <div><h3>Avant</h3><p>${h >= 2 ? (kg ? `Repas 2 à 3 h avant avec environ <b>${Math.round(kg * (h >= 3 ? 2 : 1.2) / 10) * 10} g de glucides</b> (pâtes, riz, pain, flocons d'avoine), peu de fibres et de graisses.` : "Repas riche en glucides 2 à 3 h avant (indique ton poids pour la quantité).") : "Un repas normal ou une collation 1 à 2 h avant suffit."}${h >= 4 ? " La veille, un dîner riche en glucides." : ""}</p>
        <h3>Après</h3><p>${h >= 2 ? `Dans l'heure : ${kg ? `environ <b>${Math.round(kg / 5) * 5} g de glucides</b>` : "des glucides"} et 20 à 25 g de protéines, plus ${fmt(Math.max(.5, water * .5), 1)} L à boire dans les heures qui suivent.` : "Un repas normal."}</p></div>
      <div><h3>Pendant</h3>${rows.length ? `<table class="sotab nuttab"><tbody>${rows.map(rw => `<tr${rw.water ? ' class="w"' : ""}><td>${hm(rw.t)}</td><td>km ${fmt(rw.km)}</td><td>${rw.what}</td></tr>`).join("")}</tbody></table>` : "<p>Pas besoin de manger : boire régulièrement suffit.</p>"}
        ${iso ? `<p class="note">Avec ${rate} g/h : un bidon de boisson iso (≈ 36 g) par heure, le reste en solide puis en gels.</p>` : ""}</div>
    </div>
    <p class="note">Calcul à partir d'un modèle physique (poids ${kg ? fmt(kg, 1) + " kg" : "75 kg par défaut"} + vélo, pente, vent prévu, vitesse visée). Au-delà de 60 g/h, entraîne ton estomac à l'entraînement avant le jour J.</p>`;
}
function renderTimeline(r, wx) {
  if (!r.ok) { $("soTimeline").innerHTML = `<p class="note">Pas de prévisions pour ce départ.</p>`; return; }
  const P = SO.P, rows = []; let next = r.T[0];
  for (let k = 0; k < P.length; k++) { if (r.T[k] >= next || k === P.length - 1) { const w = r.W[k] || r.W[k + 1]; if (w) rows.push({ k, t: new Date(r.T[k]), w }); next = r.T[k] + (r.secs > 4 * 3600 ? 45 : 30) * 60e3; } }
  $("soTimeline").innerHTML = `<div class="sotl">${rows.map(({ k, t, w }) => { const hd = r.Hd[k], c = w.ws < 8 ? COL.calme : hd > w.ws * .5 ? COL.face : hd < -w.ws * .5 ? COL.dos : COL.travers;
    return `<div class="sotc"><div class="h">${hm(t)}</div><div class="k">km ${fmt(P[k].d / 1000)}</div><div class="t">${fmt(w.temp)}°</div><div class="c">${WMO(w.code)}</div>
      <div class="w"><svg viewBox="-10 -10 20 20" width="20" height="20" style="transform:rotate(${(w.wd + 180) % 360}deg)"><path d="M0,-8 L5,5 L0,2 L-5,5 Z" fill="${c}"/></svg>${fmt(w.ws)}<small> km/h</small></div>
      <div class="p" style="opacity:${w.pp >= 20 ? 1 : .45}">${fmt(w.pp)} %${w.mm >= .1 ? ` · ${fmt(w.mm, 1)} mm` : ""}</div></div>`; }).join("")}</div>`;
}

// ------------------------------------------------------------------ Générateur de boucle face au vent
// Itinéraires : BRouter (open source, sans clé) avec un profil « routes ouvertes » : pas de pistes cyclables,
// voies vertes, chemins, ni grands axes si on peut l'éviter. Le point de départ reste sur cet appareil.
const BR = "https://brouter.de/brouter", BRF_V = 1;
const BRF = `---context:global
assign validForBikes = true
assign allow_steps = false
assign allow_ferries = false
assign allow_motorways = false
assign use_proposed_cycleroutes = false
assign consider_traffic = 0.3
assign consider_noise = false
assign consider_river = false
assign consider_forest = false
assign consider_town = false
assign consider_elevation = true
assign downhillcost = 60
assign downhillcutoff = 1.5
assign uphillcost = 0
assign uphillcutoff = 1.5
assign downhillcost = if consider_elevation then downhillcost else 0
assign uphillcost = if consider_elevation then uphillcost else 0
assign totalMass = 90
assign maxSpeed = 45
assign S_C_x = 0.225
assign C_r = 0.01
assign bikerPower = 100
assign turnInstructionMode = 0
assign turnInstructionCatchingRange = 40
assign turnInstructionRoundabouts = true
assign considerTurnRestrictions = true
assign correctMisplacedViaPoints = false
assign correctMisplacedViaPointsDistance = 400
assign processUnusedTags = false
---context:way
assign any_cycleroute
 switch not use_proposed_cycleroutes
 or route_bicycle_icn=yes or route_bicycle_ncn=yes or route_bicycle_rcn=yes route_bicycle_lcn=yes
 or route_bicycle_icn=yes|proposed or route_bicycle_ncn=yes|proposed or route_bicycle_rcn=yes|proposed route_bicycle_lcn=yes|proposed
assign nodeaccessgranted or any_cycleroute lcn=yes
assign ispaved or surface=paved or surface=asphalt or surface=concrete or surface=paving_stones or surface=sett or smoothness=excellent smoothness=good
assign isunpaved not or ispaved or ( and surface= smoothness= ) or surface=fine_gravel or surface=cobblestone smoothness=intermediate
assign turncost = if junction=roundabout then 0
 else 90
assign initialclassifier =
 if route=ferry then 1
 else 0
assign initialcost switch route=ferry 10000 0
assign defaultaccess
 switch access=
 (
 if motorroad=yes then false
 else if highway=motorway|motorway_link then false
 else true
 )
 switch or access=private access=no
 false
 true
assign bikeaccess =
 switch bicycle=
 switch bicycle_road=yes
 true
 switch vehicle=
 ( if highway=footway then false else defaultaccess )
 not vehicle=private|no
 not or bicycle=private or bicycle=no or bicycle=dismount bicycle=use_sidepath
assign footaccess =
 or bicycle=dismount
 switch foot=
 defaultaccess
 not or foot=private or foot=no foot=use_sidepath
assign accesspenalty
 switch bikeaccess
 0
 switch footaccess
 5
 switch any_cycleroute
 15
 switch bicycle=use_sidepath
 25
 10000
assign badoneway =
 if reversedirection=yes then
 if oneway:bicycle=yes then true
 else if oneway= then junction=roundabout
 else oneway=yes|true|1
 else oneway=-1
assign hascycleway = not
 and ( or cycleway= cycleway=no|none ) and ( or cycleway:left= cycleway:left=no ) and ( or cycleway:right= cycleway:right=no ) ( or cycleway:both= cycleway:both=no )
assign onewaypenalty =
 if ( badoneway ) then
 (
 if (
 and hascycleway
 or and cycleway:left=lane|track|shared_lane|share_busway
 cycleway:left:oneway=no|-1
 or and cycleway:right=lane|track|shared_lane|share_busway
 cycleway:right:oneway=no|-1
 or and cycleway:both=lane|track|shared_lane|share_busway
 or cycleway:left:oneway=no|-1
 cycleway:right:oneway=no|-1
 or cycleway=opposite|opposite_lane|opposite_track
 or cycleway:left=opposite|opposite_lane|opposite_track
 cycleway:right=opposite|opposite_lane|opposite_track
 ) then 0
 else if ( oneway:bicycle=no ) then 0
 else if ( not footaccess ) then 100
 else if ( junction=roundabout|circular ) then 60
 else if ( highway=primary|primary_link ) then 50
 else if ( highway=secondary|secondary_link ) then 30
 else if ( highway=tertiary|tertiary_link ) then 20
 else 6.0
 )
 else 0.0
assign trafficpenalty =
 if not consider_traffic then 0
 else
 min switch hascycleway 0.3 100
 if estimated_traffic_class=|1|2 then 0
 else if estimated_traffic_class=3 then multiply 0.3 consider_traffic
 else if estimated_traffic_class=4 then multiply 0.6 consider_traffic
 else if estimated_traffic_class=5 then multiply 0.9 consider_traffic
 else if estimated_traffic_class=6|7 then multiply 1.5 consider_traffic
 else 0
assign isresidentialorliving = or highway=residential|living_street living_street=yes
assign noise_penalty
 switch consider_noise
 switch estimated_noise_class= 0
 switch estimated_noise_class=1 0.3
 switch estimated_noise_class=2 0.5
 switch estimated_noise_class=3 0.7
 switch estimated_noise_class=4 1
 switch estimated_noise_class=5 1.2
 switch estimated_noise_class=6 1.5 0 0
assign no_river_penalty
 switch consider_river
 switch estimated_river_class= 3
 switch estimated_river_class=1 2
 switch estimated_river_class=2 1.5
 switch estimated_river_class=3 1
 switch estimated_river_class=4 0.5
 switch estimated_river_class=5 0.2
 switch estimated_river_class=6 0 99 0
assign no_forest_penalty
 switch consider_forest
 switch estimated_forest_class= 1
 switch estimated_forest_class=1 0.5
 switch estimated_forest_class=2 0.4
 switch estimated_forest_class=3 0.25
 switch estimated_forest_class=4 0.15
 switch estimated_forest_class=5 0.1
 switch estimated_forest_class=6 0 99 0
assign town_penalty
 switch consider_town
 switch estimated_town_class= 0
 switch estimated_town_class=1 0.2
 switch estimated_town_class=2 0.4
 switch estimated_town_class=3 0.6
 switch estimated_town_class=4 0.7
 switch estimated_town_class=5 0.8
 switch estimated_town_class=6 1 99 0
assign costfactor
 switch and highway= not route=ferry 10000
 switch or highway=proposed highway=abandoned 10000
 min 9999
 add max onewaypenalty accesspenalty
 add trafficpenalty
 add town_penalty
 add no_forest_penalty
 add no_river_penalty
 add noise_penalty
 switch or highway=motorway highway=motorway_link switch allow_motorways 1.5 10000
 switch or highway=trunk highway=trunk_link switch allow_motorways 1.5 10
 switch or highway=primary highway=primary_link 2.0
 switch or highway=secondary highway=secondary_link 1.2
 switch or highway=tertiary highway=tertiary_link 1.0
 switch highway=unclassified switch isunpaved 40 1.0
 switch highway=pedestrian 10
 switch highway=steps switch allow_steps 120 10000
 switch route=ferry switch allow_ferries 5.67 10000
 switch highway=bridleway 40
 switch highway=cycleway 6
 switch isresidentialorliving switch isunpaved 40 1.3
 switch highway=service switch isunpaved 40 1.6
 switch or highway=track or highway=road or highway=path highway=footway
 switch tracktype=grade1 switch isunpaved 40 6
 switch tracktype=grade2 40
 switch tracktype=grade3 60
 switch tracktype=grade4 80
 switch tracktype=grade5 100
 switch or bicycle=designated bicycle_road=yes switch isunpaved 40 8
 switch ispaved 6 switch isunpaved 50 25
 10.0
assign priorityclassifier =
 if ( highway=motorway ) then 30
 else if ( highway=motorway_link ) then 29
 else if ( highway=trunk ) then 28
 else if ( highway=trunk_link ) then 27
 else if ( highway=primary ) then 26
 else if ( highway=primary_link ) then 25
 else if ( highway=secondary ) then 24
 else if ( highway=secondary_link ) then 23
 else if ( highway=tertiary ) then 22
 else if ( highway=tertiary_link ) then 21
 else if ( highway=unclassified ) then 20
 else if ( isresidentialorliving ) then 6
 else if ( highway=service ) then 6
 else if ( highway=cycleway ) then 6
 else if ( or bicycle=designated bicycle_road=yes ) then 6
 else if ( highway=track ) then if tracktype=grade1 then 6 else 4
 else if ( highway=bridleway|road|path|footway ) then 4
 else if ( highway=steps ) then 2
 else if ( highway=pedestrian ) then 2
 else 0
assign isbadoneway = not equal onewaypenalty 0
assign isgoodoneway = if reversedirection=yes then oneway=-1
 else if oneway= then junction=roundabout else oneway=yes|true|1
assign isroundabout = junction=roundabout
assign islinktype = highway=motorway_link|trunk_link|primary_link|secondary_link|tertiary_link
assign isgoodforcars = if greater priorityclassifier 6 then true
 else if ( or isresidentialorliving highway=service ) then true
 else if ( and highway=track tracktype=grade1 ) then true
 else false
assign classifiermask add isbadoneway
 add multiply isgoodoneway 2
 add multiply isroundabout 4
 add multiply islinktype 8
 multiply isgoodforcars 16
assign dummyUsage = smoothness=
---context:node
assign defaultaccess
 switch access=
 1
 switch or access=private access=no
 0
 1
assign bikeaccess
 or nodeaccessgranted=yes
 switch bicycle=
 switch vehicle=
 defaultaccess
 switch or vehicle=private vehicle=no
 0
 1
 switch or bicycle=private or bicycle=no bicycle=dismount
 0
 1
assign footaccess
 or bicycle=dismount
 switch foot=
 defaultaccess
 switch or foot=private foot=no
 0
 1
assign initialcost
 switch or highway=traffic_signals and highway=crossing crossing=traffic_signals 20
 switch bikeaccess
 0
 switch footaccess
 300
 1000000
`;
const GEN = { busy: false, res: null, msg: "" };
function dest(p, b, km) { const R = 6371, d = km / R, la = rad(p[0]), lo = rad(p[1]), br = rad(b);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br)), lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(la2), ((deg(lo2) + 540) % 360) - 180]; }
function startPt() { const h = LS.get("soStart", null); return h && isFinite(h.lat) ? { lat: h.lat, lon: h.lon, label: h.label || "ton point de départ", own: true } : { lat: S.cfg.latitude ?? 48.1173, lon: S.cfg.longitude ?? -1.6778, label: `centre de ${S.cfg.ville || "Rennes"}`, own: false }; }
async function brProfile(force) {
  const c = LS.get("soBrf", null); if (!force && c && c.v === BRF_V && Date.now() - c.at < 2 * 864e5) return c.id;
  const r = await fetch(BR + "/profile", { method: "POST", body: BRF }); const j = r.ok ? await r.json() : {};
  if (!j.profileid || j.error) throw new Error("Le service d'itinéraires BRouter ne répond pas, réessaie dans un moment.");
  LS.set("soBrf", { id: j.profileid, at: Date.now(), v: BRF_V }); return j.profileid;
}
async function brRoute(wps, prof) {
  const ll = wps.map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join("|");
  const r = await fetch(`${BR}?lonlats=${ll}&profile=${prof}&alternativeidx=0&format=geojson`);
  if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error(t.slice(0, 120) || "itinéraire impossible"); e.prof = /profile|lookup|ParseException|not found/i.test(t); throw e; }
  const f = (await r.json()).features[0], pr = f.properties, M = pr.messages || [], head = M[0] || [], iT = head.indexOf("WayTags"), iD = head.indexOf("Distance");
  const share = { bad: 0, main: 0, dirt: 0, tot: 0 };
  M.slice(1).forEach(m => { const d = +m[iD] || 0, wt = m[iT] || ""; share.tot += d;
    if (/highway=(cycleway|path|footway|track|bridleway|pedestrian)/.test(wt)) share.bad += d;
    if (/highway=(primary|trunk)/.test(wt)) share.main += d;
    if (/surface=(gravel|compacted|ground|dirt|fine_gravel|unpaved|grass|sand)/.test(wt)) share.dirt += d; });
  return { pts: f.geometry.coordinates.map(c => [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5, c[2] != null ? Math.round(c[2] * 10) / 10 : null]), km: +pr["track-length"] / 1000, asc: +pr["filtered ascend"] || 0,
    bad: share.tot ? share.bad / share.tot : 0, main: share.tot ? share.main / share.tot : 0, dirt: share.tot ? share.dirt / share.tot : 0 };
}
async function windHere(st, day) {  // prévisions à un seul point (départ) pour noter les boucles
  const d2 = new Date(day); d2.setDate(d2.getDate() + 1);
  const H = "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day";
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${st.lat.toFixed(3)}&longitude=${st.lon.toFixed(3)}&hourly=${H}&daily=sunrise,sunset&start_date=${ymd(day)}&end_date=${ymd(d2)}&timezone=Europe%2FParis`);
  if (r.status === 400) throw new Error("Pas encore de prévisions pour cette date (16 jours maximum).");
  if (!r.ok) throw new Error(r.status === 429 ? "Trop de demandes météo, réessaie dans une minute." : "Prévisions météo indisponibles pour l'instant.");
  const j = await r.json();
  return { S: [{ d: 0, lat: st.lat, lon: st.lon }], loc: [j], t0: parseLocal(j.hourly.time[0]).getTime(), nH: j.hourly.time.length, step: 1e12 };
}
function overlap(pts) {  // part du parcours qui repasse sur ses pas (aller-retour), hors abords du départ
  const cell = p => `${Math.round(p[0] * 600)}:${Math.round(p[1] * 400)}`, seen = new Map(); let cum = 0, rep = 0, tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); cum += d; const k = cell(pts[i]);
    if (dist(pts[i], pts[0]) > 2000) { tot += d; const f = seen.get(k); if (f != null && cum - f > 1500) rep += d; }
    if (!seen.has(k)) seen.set(k, cum); }
  return tot ? rep / tot : 0;
}
function scoreLoop(c, o, wx) {
  const P = profile(c.pts), r = simulate(P, wx, o.start, o.speed, false), n = P.length; c.asc = gain(P);
  const part = (a, b) => { let s_ = 0, k = 0; for (let i = Math.floor(n * a); i < Math.floor(n * b); i++) { s_ += r.Hd[i] || 0; k++; } return s_ / Math.max(1, k); };
  const first = part(0, .4), last = part(.6, 1), mpk = c.asc / Math.max(1, c.km);
  const windPen = r.ok ? Math.max(0, last) * 2 + Math.max(0, last - first) * .8 + Math.max(0, r.head) * .5 : 0;
  const relPen = o.rel === "flat" ? Math.max(0, mpk - 6) * 3 : o.rel === "hilly" ? Math.max(0, 9 - mpk) * 3 : 0;
  const ov = overlap(c.pts);
  c.P = P; c.sim = r; c.first = first; c.last = last; c.ov = ov; c.mpk = mpk;
  c.pen = windPen + Math.abs(c.km - o.km) / o.km * 40 + relPen + ov * 60 + c.bad * 60 + c.main * 25 + c.dirt * 40;
  return c;
}
async function makeLoops(o) {
  const st = startPt(), S0 = [st.lat, st.lon]; let prof = await brProfile(), profErr = false;
  GEN.msg = "Prévisions de vent…"; renderGen();
  const wx = await windHere(st, o.start);
  const w0 = wxAt(wx, 0, o.start.getTime()), w1 = wxAt(wx, 0, o.start.getTime() + o.km / o.speed * 3600e3 / 2) || w0;
  if (!w0) throw new Error("Pas de prévisions pour ce départ.");
  const U = w0.ws * Math.sin(rad(w0.wd)) + w1.ws * Math.sin(rad(w1.wd)), V = w0.ws * Math.cos(rad(w0.wd)) + w1.ws * Math.cos(rad(w1.wd));
  const ws = Math.hypot(U, V) / 2, wd = (deg(Math.atan2(U, V)) + 360) % 360, calm = ws < 8;
  // formes : triangle (2 points) et losange (3 points), orientées face au vent (le vent vient de wd)
  const shapes = [{ k: "tri", pts: [[-35, 1], [35, 1]] }, { k: "los", pts: [[-55, .62], [0, 1], [55, .62]] }];
  const rots = calm ? [0, 90, 180, 270] : [-25, 0, 25], C = [];
  shapes.forEach(sh => { const unit = (() => { let pv = S0, L = 0; sh.pts.forEach(([b, f]) => { const q = dest(S0, b, f); L += dist(pv, q) / 1000; pv = q; }); return L + dist(pv, S0) / 1000; })();
    rots.forEach(rt => [1, -1].forEach(dir => { if (calm && dir < 0 && sh.k === "los") return;
      const ord = dir > 0 ? sh.pts : sh.pts.slice().reverse();
      C.push({ sh: sh.k, rt, dir, unit, ord, rk: o.km / 1.3 / unit }); })); });
  const wpsOf = c => [S0, ...c.ord.map(([b, f]) => dest(S0, wd + c.rt + b, c.rk * f)), S0];
  const pool = async (items, fn, k = 3) => { const out = []; let i = 0; await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } })); return out; };
  let ok = 0;
  const route = async c => { try { Object.assign(c, await brRoute(wpsOf(c), prof)); ok++; GEN.msg = `Itinéraires : ${ok} calculés…`; renderGen(); return scoreLoop(c, o, wx); }
    catch (e) { if (e.prof) profErr = true; return null; } };
  let res = (await pool(C, route)).filter(Boolean);
  if (!res.length && profErr) { prof = await brProfile(true); profErr = false; res = (await pool(C, route)).filter(Boolean); }  // profil expiré sur le serveur : on le renvoie une fois
  if (!res.length) throw new Error("Aucun itinéraire trouvé : réessaie, ou choisis un autre point de départ.");
  // on recale la distance des meilleures boucles
  res.sort((a, b) => a.pen - b.pen);
  const top = res.slice(0, 4).filter(c => Math.abs(c.km - o.km) / o.km > .06).map(c => ({ sh: c.sh, rt: c.rt, dir: c.dir, unit: c.unit, ord: c.ord, rk: c.rk * clamp(o.km / c.km, .6, 1.6), refit: true }));
  res = res.concat((await pool(top, route)).filter(Boolean)).sort((a, b) => a.pen - b.pen);
  // 3 boucles vraiment différentes
  // 3 boucles vraiment différentes : on écarte celles qui empruntent en grande partie les mêmes routes
  const cells = c => new Set(c.pts.map(p => `${Math.round(p[0] * 300)}:${Math.round(p[1] * 200)}`));
  const seen = new Set(), pick = [];
  res.forEach(c => { const k = `${c.sh}${c.rt}${c.dir}`; if (seen.has(k) || pick.length >= 3) return; c.cells = cells(c);
    if (pick.some(p => { let inter = 0; c.cells.forEach(x => { if (p.cells.has(x)) inter++; }); return inter / (c.cells.size + p.cells.size - inter) > .55; })) return;
    seen.add(k); pick.push(c); });
  return { list: pick, ws, wd, calm };
}
function loopTrace(c) { const st = Math.max(1, Math.floor(c.pts.length / 160)); return traceSvg(c.pts.filter((_, i) => i % st === 0).map(p => [p[0], p[1]])); }
function renderGen() {
  const box = $("soGen"); if (!box) return;
  const st = startPt(), s = settings(), R = GEN.res;
  box.innerHTML = `<h3>Créer une boucle face au vent</h3>
    <p class="sosmall">Départ : <b>${esc(st.label)}</b>${st.own ? "" : " (définis le tien ci-dessous)"} · aller face au vent, retour poussé. Uniquement des routes : pas de pistes cyclables, voies vertes ni chemins de halage.</p>
    <div class="soform gform">
      <label>Distance <input type="number" id="gKm" min="20" max="300" step="5" value="${LS.get("soGenKm", 80)}"> km</label>
      <label>Relief <select id="gRel">${[["flat", "plutôt plat"], ["any", "peu importe"], ["hilly", "vallonné"]].map(([v, l]) => `<option value="${v}" ${LS.get("soGenRel", "any") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Le <input type="date" id="gDate" value="${s.date}" min="${ymd(new Date())}"></label>
      <label>à <select id="gHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === s.hour ? "selected" : ""}>${h} h</option>`).join("")}</select></label>
      <button class="btn2 primary" id="gGo" ${GEN.busy ? "disabled" : ""}>${GEN.busy ? "Calcul…" : "Créer la boucle"}</button>
    </div>
    <details class="gstart"><summary>Changer le point de départ</summary>
      <div class="soform"><button class="btn" id="gHere">Ma position actuelle</button><input type="text" id="gAddr" placeholder="ou une adresse, une ville…" aria-label="Adresse de départ"><button class="btn" id="gFind">Chercher</button>${st.own ? `<button class="btn" id="gReset">Revenir au centre de ${esc(S.cfg.ville || "Rennes")}</button>` : ""}</div>
      <p class="note">Ce point reste sur cet appareil : il n'est jamais envoyé sur GitHub ni affiché sur le site.</p></details>
    <p class="soerr" id="gMsg">${esc(GEN.msg || "")}</p>
    ${R && R.list.length ? `<p class="sosmall">${R.calm ? `Vent faible (${fmt(R.ws)} km/h) : boucles dans plusieurs directions.` : `Vent ${vdu(R.wd)} à ${fmt(R.ws)} km/h : on part vers ${vers(R.wd)}, face au vent, pour l'avoir dans le dos au retour.`}</p>
      <div class="gres">${R.list.map((c, i) => `<div class="gcard"><div class="map">${loopTrace(c)}</div><div class="gtx"><b>Boucle ${i + 1} · ${fmt(c.km)} km</b>
        <span>${fmt(c.asc)} m D+ · ${dur(c.sim.secs)} à ${fmt(s.speed, 1)} km/h</span>
        <span>vent de face : ${fmt(Math.max(0, c.first))} km/h à l'aller, ${c.last > 1 ? `${fmt(c.last)} km/h de face` : c.last < -1 ? `${fmt(-c.last)} km/h dans le dos` : "neutre"} au retour</span>
        ${c.ov > .08 || c.main > .03 ? `<small>${c.ov > .08 ? `${fmt(c.ov * 100)} % en aller-retour` : ""}${c.ov > .08 && c.main > .03 ? " · " : ""}${c.main > .03 ? `${fmt(c.main * 100)} % sur grande route` : ""}</small>` : ""}
        <button class="btn" data-gi="${i}">Choisir</button></div></div>`).join("")}</div>` : ""}`;
  const save = () => { LS.set("soGenKm", clamp(+$("gKm").value || 80, 20, 300)); LS.set("soGenRel", $("gRel").value); LS.set("sortieSet", { ...settings(), date: $("gDate").value, hour: +$("gHour").value, min: 0 }); };
  ["gKm", "gRel", "gDate", "gHour"].forEach(id => $(id).onchange = save);
  $("gGo").onclick = async () => { if (GEN.busy) return; save(); GEN.busy = true; GEN.res = null; GEN.msg = "Préparation…"; renderGen();
    const s2 = settings();
    try { GEN.res = await makeLoops({ km: LS.get("soGenKm", 80), rel: LS.get("soGenRel", "any"), start: startOf(s2), speed: s2.speed }); GEN.msg = GEN.res.list.length ? "" : "Aucune boucle trouvée, essaie une autre distance."; }
    catch (e) { GEN.msg = e.message || "Création impossible pour l'instant."; }
    GEN.busy = false; renderGen(); };
  $("gHere").onclick = () => { if (!navigator.geolocation) { GEN.msg = "Géolocalisation indisponible sur cet appareil."; return renderGen(); }
    GEN.msg = "Localisation…"; renderGen();
    navigator.geolocation.getCurrentPosition(p => { LS.set("soStart", { lat: Math.round(p.coords.latitude * 1e4) / 1e4, lon: Math.round(p.coords.longitude * 1e4) / 1e4, label: "ma position" }); GEN.msg = ""; GEN.res = null; renderGen(); },
      () => { GEN.msg = "Position refusée ou introuvable."; renderGen(); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }); };
  $("gFind").onclick = async () => { const q = $("gAddr").value.trim(); if (!q) return; GEN.msg = "Recherche de l'adresse…"; renderGen();
    try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(q)}`); const j = r.ok ? await r.json() : [];
      if (!j.length) throw 0; LS.set("soStart", { lat: Math.round(+j[0].lat * 1e4) / 1e4, lon: Math.round(+j[0].lon * 1e4) / 1e4, label: j[0].display_name.split(",").slice(0, 2).join(",") }); GEN.msg = ""; GEN.res = null; }
    catch (e) { GEN.msg = "Adresse introuvable."; } renderGen(); };
  if ($("gReset")) $("gReset").onclick = () => { LS.set("soStart", null); GEN.res = null; renderGen(); };
  box.querySelectorAll("[data-gi]").forEach(b => b.onclick = () => { const c = GEN.res.list[+b.dataset.gi];
    setRoute({ name: `Boucle ${fmt(c.km)} km · ${GEN.res.calm ? "vent faible" : "vent " + vdu(GEN.res.wd)}`, pts: c.pts, gen: true }); SO.genOpen = false; });
}
function toGPX(r) {
  const x = t => String(t).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Breizh Watts" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(r.name)}</name></metadata>\n<trk><name>${x(r.name)}</name><trkseg>\n${r.pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ""}</trkpt>`).join("\n")}\n</trkseg></trk>\n</gpx>\n`;
}
function exportGPX() { const r = SO.route; if (!r) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([toGPX(r)], { type: "application/gpx+xml" })); a.download = `${r.name.replace(/[^A-Za-z0-9À-ÿ ]/g, "").trim().replace(/\s+/g, "_") || "boucle"}.gpx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

// ------------------------------------------------------------------ Entrée
async function open() {
  $("title").textContent = "Planifier une sortie";
  shell();
  // profil Garmin (FTP, zones) nécessaire à la nutrition : chargé sans toucher à l'affichage
  if (window.Recup && !Recup.data) { try { await Recup.ensure("soProfil", () => {}); } catch (e) {} }
  if (!SO.route) { const r = LS.get("sortieRoute", null); if (r && r.pts && r.pts.length > 1) { SO.route = r; SO.P = profile(r.pts); SO.climbs = climbs(SO.P); } }
  renderLoad();
  $("soBody").hidden = !SO.route;
  if (SO.route) compute();
}
window.Sortie = { open, _parse: parseGPX, _profile: profile, _climbs: climbs };
let rt, lw = innerWidth; addEventListener("resize", () => { if (innerWidth === lw) return; lw = innerWidth; clearTimeout(rt); rt = setTimeout(() => { if (window.Recup?.curTab() === "sortie" && SO.res) renderProfile(SO.res); }, 200); });
document.addEventListener("velo:loaded", () => { if (window.Recup?.curTab() === "sortie") open(); });
})();
