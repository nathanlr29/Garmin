"use strict";
// Bilan de séance (vélo et course à pied ; fenêtre ouverte depuis le Plan ou les dernières sorties) et carte « Progression » de l'onglet Plan.
// Détail seconde par seconde : data/streams/<id>.json, produit par la mise à jour Garmin pour les 6 dernières semaines.
(() => {
const B = { idx: null, cache: {}, wx: {}, prog: 0 };
const pad = n => String(n).padStart(2, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
const hms = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${pad(m)}` : `${m} min${s < 600 && s % 60 ? ` ${pad(s % 60)} s` : ""}`; };
const pct = v => `${nf(v * 100)} %`;
const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } } };
const PZ = [[.55, "Z1 récup", "#a5b1bd"], [.75, "Z2 endurance", "#4aa3df"], [.9, "Z3 tempo", "#2fb380"], [1.05, "Z4 seuil", "#f2b134"], [1.2, "Z5 VO2max", "#ef6c3a"], [1.5, "Z6 anaérobie", "#d6336c"], [99, "Z7 sprint", "#862e9c"]];
const HZC = ["#a5b1bd", "#4aa3df", "#2fb380", "#f2b134", "#ef6c3a"];
const HZN = ["Z1 récup", "Z2 endurance", "Z3 tempo", "Z4 seuil", "Z5 VO2max"];
const HZL = ["zone 1 (récup)", "zone 2 (endurance)", "zone 3 (tempo)", "zone 4 (seuil)", "zone 5 (VO2max)"];

// ------------------------------------------------------------------ Données
async function getIndex() {
  if (!B.idx) { try { const r = await fetch("data/streams/index.json?v=" + Date.now(), { cache: "no-store" }); B.idx = r.ok ? await r.json() : {}; } catch (e) { B.idx = {}; } }
  return B.idx;
}
async function stream(id) {
  if (id in B.cache) return B.cache[id];
  const ix = await getIndex();
  if (!ix[id] || !ix[id].ok) return (B.cache[id] = null);
  try { const r = await fetch(`data/streams/${id}.json`); B.cache[id] = r.ok ? await r.json() : null; } catch (e) { B.cache[id] = null; }
  return B.cache[id];
}
const prof = () => (window.Recup && Recup.data && Recup.data.profile) || {};
const ftpNow = () => (window.Plan && Plan.ftp && Plan.ftp()) || prof().ftp || 250;
const hrMax = () => (prof().hrZones && prof().hrZones.max) || 190;
const kgNow = () => +LS.get("bwWeight", 0) || 0;

// ------------------------------------------------------------------ Calculs sur le détail
function rollNP(P, dt) {
  const w = Math.max(1, Math.round(30 / dt)), v = P.map(x => x || 0); if (v.length < w) return null;
  let s = 0, acc = 0, n = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= w) s -= v[i - w]; if (i >= w - 1) { acc += (s / w) ** 4; n++; } }
  return n ? Math.pow(acc / n, .25) : null;
}
function moving(st, i) { const p = st.p ? st.p[i] : null, v = st.v ? st.v[i] : null, c = st.c ? st.c[i] : null; return (p != null && p > 0) || (v != null && v > 15) || (c != null && c > 0); }
function analyze(a, st) {
  const dt = st.dt, n = st.n, ftp = ftpNow(), hm = hrMax(), out = { dt, n, ftp };
  const mv = Array.from({ length: n }, (_, i) => moving(st, i));
  out.moving = mv.filter(Boolean).length * dt;
  if (st.p && st.p.some(x => x > 0)) {
    const P = st.p.map((x, i) => mv[i] ? (x || 0) : null).filter(x => x != null);
    out.avgP = P.reduce((s, x) => s + x, 0) / Math.max(1, P.length);
    out.np = rollNP(st.p.filter((_, i) => mv[i]), dt) || out.avgP;
    out.IF = out.np / ftp; out.tss = out.moving / 3600 * out.IF ** 2 * 100;
    out.pz = PZ.map(() => 0); st.p.forEach((x, i) => { if (!mv[i] || x == null) return; out.pz[PZ.findIndex(z => x / ftp < z[0])] += dt; });
    out.work = st.p.reduce((s, x) => s + (x || 0) * dt, 0) / 1000;
  }
  if (st.h && st.h.some(x => x > 0)) {
    const H = st.h.filter((x, i) => x > 0 && mv[i]);
    out.avgH = H.reduce((s, x) => s + x, 0) / Math.max(1, H.length); out.maxH = Math.max(...H);
    out.t90 = st.h.filter(x => x >= .9 * hm).length * dt;
    const fl = prof().hrZones && prof().hrZones.floors;
    if (fl && fl.every(v => v != null)) { out.hz = [0, 0, 0, 0, 0]; st.h.forEach((x, i) => { if (!x || !mv[i]) return; let z = 0; for (let k = 1; k < 5; k++) if (x >= fl[k]) z = k; out.hz[z] += dt; }); }
    if (out.np) out.ef = out.np / out.avgH;
  }
  // dérive cardiaque (découplage puissance/cardio) : on retire les 10 premières minutes, puis 1re moitié vs 2de moitié
  if (st.p && st.h) {
    const idx = []; for (let i = Math.ceil(600 / dt); i < n; i++) if (mv[i] && st.p[i] != null && st.h[i] > 0) idx.push(i);
    if (idx.length * dt >= 1800) {
      const half = Math.floor(idx.length / 2), ef = arr => arr.reduce((s, i) => s + st.p[i], 0) / arr.reduce((s, i) => s + st.h[i], 0);
      const e1 = ef(idx.slice(0, half)), e2 = ef(idx.slice(half));
      const pp = idx.map(i => st.p[i]), avg = pp.reduce((s, x) => s + x, 0) / pp.length, np = rollNP(pp, dt) || avg;
      const med = pp.slice().sort((a, b) => a - b)[Math.floor(pp.length / 2)], near = pp.filter(x => Math.abs(x - med) <= .15 * med).length / pp.length;
      out.dec = (e1 - e2) / e1 * 100; out.vi = np / avg; out.steady = out.vi <= 1.06 && near >= .7 && np / ftp >= .5 && np / ftp <= .88;  // séance régulière, pas du fractionné
    }
  }
  return out;
}

// ------------------------------------------------------------------ Course à pied
// Rien de propre au vélo ici : ni vent, ni profil Coggan, ni % FTP, ni conformité au plan (la course entre dans le plan à l'étape 5).
const isRun = a => !!(window.Charge && Charge.RUN_TYPES.has(a.t));
const runIndoor = a => a.t === "treadmill_running" || a.t === "virtual_run";
const RUN_MIN_KMH = 3;          // en dessous de 3 km/h on est à l'arrêt : exclu des moyennes, des zones et de l'axe d'allure
// zones d'allure autour de l'allure seuil : bornes hautes en fraction de la VITESSE seuil (< 78 %, 78-88, 88-95, 95-102, > 102 %)
const RUN_ZONES = [[.78, "Z1 récup", "#a5b1bd"], [.88, "Z2 endurance", "#4aa3df"], [.95, "Z3 tempo", "#2fb380"], [1.02, "Z4 seuil", "#f2b134"], [99, "Z5 VO2max", "#ef6c3a"]];
const RUN_DEC_SKIP = 600;       // découplage allure/FC : on retire les 10 premières minutes…
const RUN_DEC_MIN = 1200;       // …et il faut au moins 20 minutes ensuite
const RUN_CADENCE_LOW = 160;    // pas/min : en dessous, le bilan le signale
const paceTxt = sec => { if (!isFinite(sec) || sec <= 0) return "–"; let m = Math.floor(sec / 60), s = Math.round(sec % 60); if (s === 60) { m++; s = 0; } return `${m}:${pad(s)}`; };
const runMoving = (st, i) => st.v != null && st.v[i] != null && st.v[i] / 10 >= RUN_MIN_KMH;
function runZoneOf(kmh, thrPace) { const r = kmh / (3600 / thrPace); return RUN_ZONES.findIndex(z => r < z[0]); }
// allure moyenne en mouvement d'une activité (s/km)
const runPace = a => a.km > 0 && a.mt > 0 ? a.mt / a.km : null;
function analyzeRun(st, thrPace) {
  const dt = st.dt, n = st.n, mv = Array.from({ length: n }, (_, i) => runMoving(st, i)), out = { dt, n };
  out.moving = mv.filter(Boolean).length * dt;
  const mean = k => { if (!st[k]) return null; const v = st[k].filter((x, i) => x != null && x > 0 && mv[i]); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  out.avgKmh = st.v ? mean("v") / 10 : null;
  out.avgH = mean("h"); if (out.avgH != null) out.maxH = Math.max(...st.h.filter((x, i) => x > 0 && mv[i]));
  out.cad = mean("c"); out.sl = mean("sl"); out.gct = mean("gct"); out.vo = mean("vo");
  if (out.avgKmh && out.avgH) out.ef = out.avgKmh / 3.6 * 60 / out.avgH;   // mètres par battement
  if (thrPace && st.v) { out.rz = RUN_ZONES.map(() => 0); st.v.forEach((x, i) => { if (mv[i]) out.rz[runZoneOf(x / 10, thrPace)] += dt; }); }
  // découplage allure/cardio : 1re moitié vs 2de moitié de la séance, comme le découplage puissance/cardio du vélo
  if (st.v && st.h) {
    const idx = []; for (let i = Math.ceil(RUN_DEC_SKIP / dt); i < n; i++) if (mv[i] && st.h[i] > 0) idx.push(i);
    if (idx.length * dt >= RUN_DEC_MIN) {
      const half = Math.floor(idx.length / 2), ef = arr => arr.reduce((s, i) => s + st.v[i], 0) / arr.reduce((s, i) => s + st.h[i], 0);
      const e1 = ef(idx.slice(0, half)), e2 = ef(idx.slice(half));
      const vv = idx.map(i => st.v[i]), med = vv.slice().sort((a, b) => a - b)[Math.floor(vv.length / 2)], near = vv.filter(x => Math.abs(x - med) <= .15 * med).length / vv.length;
      out.dec = (e1 - e2) / e1 * 100; out.steady = near >= .7;   // allure régulière, pas du fractionné
    }
  }
  return out;
}
function runInfo(a) {  // charge, intensité par rapport à l'allure seuil
  const tss = Charge.tssOf(a), p = Charge.params(), h = a.mt / 3600;
  return { tss, thr: p.runPace, IF: tss > 0 && h > 0 ? Math.sqrt(tss / h / 100) : null };
}
function tilesRun(a, an) {
  const t = (l, v, s) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || "&nbsp;"}</div></div>`, L = [], ri = runInfo(a);
  L.push(t("Durée", hms(a.mt), a.et > a.mt + 120 ? `${hms(a.et)} au total` : ""));
  L.push(t("Distance", `${nf(a.km, 1)}<small> km</small>`, runIndoor(a) ? "tapis" : ""));
  if (runPace(a)) L.push(t("Allure moyenne", `${paceTxt(runPace(a))}<small> /km</small>`, "en mouvement"));
  L.push(t("Dénivelé", `${nf(a.el)}<small> m</small>`, "positif"));
  if (ri.tss > 0) L.push(t("Charge", `${nf(ri.tss)}<small> rTSS</small>`, ri.thr ? `IF ${nf(ri.IF, 2)} · seuil ${paceTxt(ri.thr)} /km` : "estimée à la FC, sans allure seuil"));
  const hr = an && an.avgH ? an.avgH : a.hr; if (hr > 0) L.push(t("Cardio", `${nf(hr)}<small> bpm</small>`, an && an.maxH ? `max ${nf(an.maxH)} bpm` : ""));
  if (a.te > 0) L.push(t("Effet aérobie", nf(a.te, 1), a.tl ? `charge Garmin ${a.tl}` : ""));
  if (an && an.cad) L.push(t("Cadence", `${nf(an.cad)}<small> pas/min</small>`, ""));
  if (an && an.sl) L.push(t("Longueur de pas", `${nf(an.sl)}<small> cm</small>`, ""));
  if (an && an.gct) L.push(t("Contact au sol", `${nf(an.gct)}<small> ms</small>`, ""));
  if (an && an.vo) L.push(t("Oscillation verticale", `${nf(an.vo, 1)}<small> cm</small>`, ""));
  if (a.w > 0) L.push(t("Puissance Garmin", `${nf(a.w)}<small> W</small>`, "à titre d'info, hors charge"));
  return `<div class="tiles bm-tiles">${L.join("")}</div>`;
}
function verdictRun(a, an) {
  const L = [], ri = runInfo(a), hr = an && an.avgH ? an.avgH : a.hr, Z = a.hz || (an && an.hz), zi = Z && Z.some(x => x > 0) ? Z.indexOf(Math.max(...Z)) : -1;
  L.push(`${hms(a.mt)} à <b>${paceTxt(runPace(a))} /km</b> de moyenne${hr ? `, cardio moyen ${nf(hr)} bpm` : ""}${zi >= 0 ? `, surtout en ${HZL[zi]}` : ""}.`);
  if (ri.tss > 0) L.push(ri.thr && ri.IF ? `Intensité <b>${nf(ri.IF * 100)} %</b> de ton allure seuil (${paceTxt(ri.thr)} /km) : charge <b>≈ ${nf(ri.tss)} rTSS</b>.` : `Charge <b>≈ ${nf(ri.tss)} rTSS</b>, estimée à la fréquence cardiaque (pas d'allure seuil connue).`);
  const more = [];
  if (an && an.dec != null && an.steady) more.push(`Découplage allure/cardio ${nf(an.dec, 1)} % sur ${hms(an.moving)} : ${an.dec < 5 ? "endurance solide (moins de 5 %)" : an.dec < 8 ? "correct, la fatigue se fait sentir en fin de séance" : "élevé : manque d'endurance de base, chaleur ou hydratation"}.`);
  if (an && an.cad && an.cad < RUN_CADENCE_LOW) more.push(`Cadence moyenne de ${nf(an.cad)} pas/min, sous les ${RUN_CADENCE_LOW} pas/min.`);
  L.push(...more);
  if (an && an.rz && L.length < 4) { const tot = an.rz.reduce((s, x) => s + x, 0), easy = (an.rz[0] + an.rz[1]) / Math.max(1, tot); if (tot >= 300) L.push(`${pct(easy)} du temps sous 88 % de ta vitesse seuil (zones d'allure 1-2), ${pct((an.rz[3] + an.rz[4]) / Math.max(1, tot))} à 95 % ou plus.`); }
  return `<div class="bm-verdict">${L.slice(0, 4).map(x => `<p>${x}</p>`).join("")}</div>`;
}
function zonesRunHtml(a, an) {
  const bar = (Z, names, cols, title) => { const tot = Z.reduce((s, x) => s + x, 0) || 1;
    return `<section class="bm-sec"><h4>${title}</h4><div class="bm-zbar">${Z.map((x, i) => x ? `<div style="width:${x / tot * 100}%;background:${cols[i]}" title="${names[i]} : ${hms(x)}"></div>` : "").join("")}</div>
    <div class="bm-zleg">${Z.map((x, i) => x >= 30 ? `<span><i style="background:${cols[i]}"></i>${names[i]} <b>${hms(x)}</b> ${nf(x / tot * 100)} %</span>` : "").join("")}</div></section>`; };
  let h = "";
  if (a.hz && a.hz.some(x => x > 0)) h += bar(a.hz, HZN, HZC, "Zones cardio <small>calcul Garmin</small>");
  else if (an && an.hz) h += bar(an.hz, HZN, HZC, "Zones cardio");
  const thr = Charge.params().runPace;
  if (an && an.rz && thr && an.rz.some(x => x > 0)) h += bar(an.rz, RUN_ZONES.map(z => z[1]), RUN_ZONES.map(z => z[2]), `Zones d'allure <small>autour de ton allure seuil ${paceTxt(thr)} /km · vitesse brute, sans correction du dénivelé</small>`);
  return h;
}
function enduRunHtml(an) {
  if (!an || (an.ef == null && an.dec == null)) return "";
  return `<section class="bm-sec"><h4>Endurance</h4><p class="bm-p">${an.ef != null ? `Efficacité : <b>${nf(an.ef, 2)} m par battement</b> (vitesse moyenne ÷ cardio moyen). Plus elle monte d'une sortie facile à l'autre, plus tu avances loin au même cardio.` : ""}${an.dec != null ? ` Découplage allure/cardio : <b>${nf(an.dec, 1)} %</b>${an.steady ? "" : " (allure irrégulière : à prendre avec des pincettes)"}.` : ""}</p></section>`;
}
function chartRun(box, st, thrPace) {
  if (!box) return;
  const W = Math.max(300, box.clientWidth || 600), H = 220, m = { l: 40, r: 34, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = st.n, dt = st.dt;
  const smooth = (arr, w) => { if (!arr || w <= 1) return arr; return arr.map((v, i) => { if (v == null) return null; let s_ = 0, c = 0; for (let k = Math.max(0, i - w + 1); k <= i; k++) if (arr[k] != null) { s_ += arr[k]; c++; } return c ? s_ / c : null; }); };
  // allure lissée sur 30 s (on moyenne la vitesse, pas l'allure) ; à l'arrêt (< 3 km/h) : pas de point
  const sp = st.v ? smooth(st.v.map(x => x != null && x / 10 >= RUN_MIN_KMH ? x / 10 : null), Math.max(1, Math.round(30 / dt))) : null;
  const pc = sp ? sp.map(v => v != null && v > 0 ? 3600 / v : null) : null;
  const vals = pc ? pc.filter(v => v != null).sort((a, b) => a - b) : [];
  let lo = vals.length ? vals[Math.floor(vals.length * .02)] : 240, hi = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * .98))] : 360;
  lo = Math.floor(lo / 15) * 15; hi = Math.ceil(hi / 15) * 15; if (hi - lo < 60) { hi = lo + 60; }
  const x = i => m.l + i / Math.max(1, n - 1) * iw, y = p => m.t + (clamp(p, lo, hi) - lo) / (hi - lo) * ih;   // axe inversé : le plus rapide en haut
  const HR = st.h ? smooth(st.h.map(v => v > 0 ? v : null), Math.round(15 / dt)) : null, H2 = HR ? HR.filter(v => v > 0) : [];
  const hLo = H2.length ? Math.min(...H2) - 5 : 0, hHi = H2.length ? Math.max(...H2) + 5 : 1, yh = v => m.t + ih - (v - hLo) / (hHi - hLo) * ih;
  const A = st.a ? st.a.filter(v => v != null) : [], aLo = A.length ? Math.min(...A) : 0, aHi = A.length ? Math.max(...A) : 1, ya = v => m.t + ih - (v - aLo) / Math.max(10, aHi - aLo) * ih * .3;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Déroulé de la séance"><g class="axis">`;
  const tStep = n * dt > 3 * 3600 ? 3600 : n * dt > 3600 ? 1800 : 600;
  for (let t = 0; t <= n * dt; t += tStep) s += `<text x="${x(t / dt)}" y="${H - 5}" text-anchor="middle">${t >= 3600 ? `${Math.floor(t / 3600)} h${t % 3600 ? pad(t % 3600 / 60) : ""}` : `${t / 60}′`}</text>`;
  const step = hi - lo > 240 ? 60 : hi - lo > 120 ? 30 : 15;
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(p)}" y2="${y(p)}"/><text x="${m.l - 5}" y="${y(p) + 4}" text-anchor="end">${paceTxt(p)}</text>`;
  if (H2.length) [hLo + 5, (hLo + hHi) / 2, hHi - 5].forEach(v => s += `<text x="${W - m.r + 5}" y="${yh(v) + 4}" fill="#c2255c">${Math.round(v)}</text>`);
  s += "</g>";
  if (A.length) { let d = "", pen = false; st.a.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + ya(v).toFixed(1); pen = true; });
    s += `<path d="M${x(0)},${m.t + ih}${d.replace(/^M/, "L").replace(/M/g, "L")}L${x(n - 1)},${m.t + ih}Z" fill="var(--muted)" opacity=".18"/>`; }
  if (thrPace && thrPace >= lo && thrPace <= hi) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(thrPace)}" y2="${y(thrPace)}" stroke="var(--ink)" stroke-dasharray="4 3" opacity=".5"/>`;
  if (pc) { let d = "", pen = false; pc.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; }); s += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" opacity=".95"/>`; }
  if (H2.length) { let d = "", pen = false; HR.forEach((v, i) => { if (!v) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + yh(v).toFixed(1); pen = true; }); s += `<path d="${d}" fill="none" stroke="#c2255c" stroke-width="1.6" stroke-linejoin="round"/>`; }
  s += `<line id="bmCur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="bmHit"/></svg>`;
  box.innerHTML = s + `<div class="legend bm-leg"><span><i style="background:var(--accent)"></i>allure (min/km, plus rapide en haut)</span>${H2.length ? `<span><i style="background:#c2255c"></i>cardio (bpm)</span>` : ""}${A.length ? `<span><i style="background:var(--muted);opacity:.4"></i>altitude (${Math.round(aLo)}–${Math.round(aHi)} m)</span>` : ""}${thrPace && thrPace >= lo && thrPace <= hi ? `<span><i style="background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 6px)"></i>seuil ${paceTxt(thrPace)}</span>` : ""}</div>`;
  const svg = box.querySelector("svg"), cur = box.querySelector("#bmCur"), hit = box.querySelector("#bmHit");
  const mv = e => { const r = svg.getBoundingClientRect(), i = clamp(Math.round(((e.clientX - r.left) * W / r.width - m.l) / iw * (n - 1)), 0, n - 1);
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", .6);
    const t = i * dt; showTip(e, `<b>${t >= 3600 ? `${Math.floor(t / 3600)} h ${pad(Math.floor(t % 3600 / 60))}` : `${Math.floor(t / 60)} min ${pad(t % 60)}`}</b>${pc && pc[i] != null ? `<br>${paceTxt(pc[i])} /km` : ""}${st.h && st.h[i] ? `<br>${st.h[i]} bpm` : ""}${st.a && st.a[i] != null ? `<br>${st.a[i]} m` : ""}${st.c && st.c[i] ? `<br>${st.c[i]} pas/min` : ""}`); };
  hit.addEventListener("pointermove", mv); hit.addEventListener("pointerdown", mv); hit.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
}
function headerRun(a) {
  return `<header class="bm-head"><div><div class="bm-k">Bilan de séance · course à pied</div><h3 id="bmTitle">${esc(a.n)}</h3>
    <div class="bm-sub">${a.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à ${pad(a.dt.getHours())} h ${pad(a.dt.getMinutes())} · ${runIndoor(a) ? "tapis" : "dehors"}</div></div>
    <button class="bm-x" data-bmclose aria-label="Fermer">✕</button></header>`;
}
async function openRun(a, body) {
  body.innerHTML = headerRun(a) + `<p class="note">Analyse en cours…</p>`;
  const st = await stream(a.id), thr = Charge.params().runPace, an = st ? analyzeRun(st, thr) : null;
  body.innerHTML = headerRun(a) + tilesRun(a, an) + verdictRun(a, an) + (st ? `<section class="bm-sec"><h4>Déroulé <small>allure${st.h ? ", cardio" : ""}${st.a ? " et altitude" : ""}</small></h4><div id="bmChart"></div></section>` : "")
    + zonesRunHtml(a, an) + enduRunHtml(an) + (!st ? `<p class="note">${noStreamWhy(a)}</p>` : "")
    + `<div class="bm-foot"><a href="https://connect.garmin.com/modern/activity/${a.id}" target="_blank" rel="noopener">Voir sur Garmin Connect ↗</a><button class="btn2" data-bmclose>Fermer</button></div>`;
  if (st) chartRun(document.getElementById("bmChart"), st, thr);
}

// Séance prévue vs réalisée : on cale le profil prévu sur la puissance (décalage de départ), puis on mesure chaque effort
function compliance(st, plan) {
  if (!plan || !plan.w || !st.p) return null;
  const dt = st.dt, ftp = plan.ftp || ftpNow(), steps = plan.w.steps, T = [], marks = [];
  let t = 0; steps.forEach((s, k) => { marks.push({ k, s, t0: t, t1: t + s.d }); t += s.d; });
  for (let i = 0, j = 0; i * dt < t; i++) { const tc = i * dt + dt / 2; while (j < marks.length - 1 && marks[j].t1 <= tc) j++; const s = marks[j].s; T.push(s.free ? null : ((s.lo + s.hi) / 2) * ftp); }
  const P = st.p.map(x => x || 0);
  let best = { off: 0, sc: -Infinity };
  for (let off = 0; off <= Math.min(180, P.length - 10); off++) {  // jusqu'à 15 min de décalage avec des pas de 5 s
    let sp = 0, st2 = 0, stt = 0, sp2 = 0, nn = 0;
    for (let i = 0; i < T.length && i + off < P.length; i++) { if (T[i] == null) continue; const p = P[i + off]; sp += p; st2 += T[i]; stt += T[i] * T[i]; sp2 += p * T[i]; nn++; }
    if (nn < 20) continue;
    const cov = sp2 / nn - sp / nn * st2 / nn, vt = stt / nn - (st2 / nn) ** 2, sc = vt > 0 ? cov / Math.sqrt(vt) : 0;
    if (sc > best.sc) best = { off, sc };
  }
  const shift = best.off * dt, rows = [];
  marks.forEach(m => { const s = m.s; if (!(s.free || s.lo >= .85) || /^(Activation|Ouverture)/.test(s.label)) return;
    const trim = s.d >= 120 ? Math.min(30, s.d * .1) : 0, a0 = Math.floor((m.t0 + shift + trim) / dt), a1 = Math.ceil((m.t1 + shift - trim) / dt);
    const seg = P.slice(a0, Math.max(a0 + 1, a1)), H = st.h ? st.h.slice(a0, a1).filter(x => x > 0) : [];
    if (!seg.length || a0 >= P.length) { rows.push({ s, miss: true }); return; }
    const avg = seg.reduce((x, y) => x + y, 0) / seg.length, tgt = s.free ? null : (s.lo + s.hi) / 2 * ftp;
    rows.push({ s, avg, tgt, ratio: tgt ? avg / tgt : null, hr: H.length ? Math.max(...H) : null, t0: m.t0 + shift }); });
  // regroupement des efforts identiques consécutifs (séries de 30/15, intervalles)
  const groups = []; rows.forEach(r => { const g = groups[groups.length - 1];
    if (g && !r.s.free && !g.free && g.d === r.s.d && Math.abs(g.lo - r.s.lo) < .001 && r.s.label.split(" ")[0] === g.label.split(" ")[0] && !(r.s.label.startsWith("Série") && r.s.label.split("·")[0] !== g.label.split("·")[0])) { g.rows.push(r); return; }
    groups.push({ d: r.s.d, lo: r.s.lo, free: !!r.s.free, label: r.s.label, rows: [r] }); });
  const scored = rows.filter(r => r.ratio != null);
  const inT = scored.filter(r => r.ratio >= .95 && r.ratio <= 1.1).length;
  return { shift, groups, n: scored.length, inT, mean: scored.length ? scored.reduce((s, r) => s + r.ratio, 0) / scored.length : null, missed: rows.filter(r => r.miss).length };
}

// ------------------------------------------------------------------ Vent subi (sorties dehors)
const PHY = { cda: .34, crr: .006, bike: 9.5, eta: .97, g: 9.81 };
function powerAt(v, M, gr, vw, rho) { const th = Math.atan(gr), va = v + vw; return (M * PHY.g * (PHY.crr * Math.cos(th) + Math.sin(th)) * v + .5 * rho * PHY.cda * va * Math.abs(va) * v) / PHY.eta; }
function speedFor(P, M, gr, vw, rho) { let lo = .3, hi = 25; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (powerAt(m, M, gr, vw, rho) > P) hi = m; else lo = m; } return (lo + hi) / 2; }
function brg(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return (deg(Math.atan2(y, x)) + 360) % 360; }
async function windFor(st) {
  if (!st.g || !st.v) return null;
  const pts = st.g.filter(p => p && p.length === 2); if (pts.length < 20) return null;
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length, lon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const t0 = new Date(st.t0), t1 = new Date(t0.getTime() + st.n * st.dt * 1000), d0 = t0.toISOString().slice(0, 10), d1 = t1.toISOString().slice(0, 10);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${d0},${d1}`;
  if (!B.wx[key]) B.wx[key] = (async () => {
    const q = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=wind_speed_10m,wind_direction_10m,temperature_2m&start_date=${d0}&end_date=${d1}&timezone=GMT`;
    for (const host of ["https://api.open-meteo.com/v1/forecast", "https://archive-api.open-meteo.com/v1/archive"]) {
      try { const r = await fetch(`${host}?${q}`); if (!r.ok) continue; const j = await r.json(); if (j.hourly && j.hourly.wind_speed_10m && j.hourly.wind_speed_10m.some(v => v != null)) return j.hourly; } catch (e) {}
    }
    return null; })();
  const h = await B.wx[key]; if (!h) return null;
  const hourIdx = new Map(h.time.map((t, i) => [t, i]));
  const at = ms => { const d = new Date(ms), k = d.toISOString().slice(0, 13) + ":00", i = hourIdx.get(k); if (i == null) return null; const j = Math.min(h.time.length - 1, i + 1), f = d.getUTCMinutes() / 60;
    const u = q => h.wind_speed_10m[q] * Math.sin(rad(h.wind_direction_10m[q])), v = q => h.wind_speed_10m[q] * Math.cos(rad(h.wind_direction_10m[q]));
    const U = u(i) + (u(j) - u(i)) * f, V = v(i) + (v(j) - v(i)) * f; return { ws: Math.hypot(U, V), wd: (deg(Math.atan2(U, V)) + 360) % 360, temp: h.temperature_2m[i] }; };
  const M = (kgNow() || 75) + PHY.bike, seg = [];
  let face = 0, dos = 0, cote = 0, calme = 0, headSum = 0, tt = 0, wsSum = 0, pSum = 0, p4 = 0;
  for (let i = 0; i < st.n - 1; i++) {
    const g1 = st.g[i], g2 = st.g[i + 1], v = st.v[i]; if (!g1 || !g2 || !v || v < 80) continue;  // à l'arrêt ou sans position
    const w = at(new Date(st.t0).getTime() + i * st.dt * 1000); if (!w) continue;
    const b = brg(g1, g2), head = w.ws * Math.cos(rad(w.wd - b)), vs = v / 36;  // m/s
    const gr = st.a && st.a[i] != null && st.a[i + 1] != null ? clamp((st.a[i + 1] - st.a[i]) / Math.max(1, vs * st.dt), -.12, .12) : 0;
    const rho = 1.225 * 288.15 / (273.15 + (w.temp ?? 15)), P = Math.max(0, powerAt(vs, M, gr, head / 3.6 * .75, rho));
    seg.push({ d: vs * st.dt, gr, head, rho });
    const c = w.ws < 8 ? "calme" : head > w.ws * .5 ? "face" : head < -w.ws * .5 ? "dos" : "cote";
    if (c === "face") face += st.dt; else if (c === "dos") dos += st.dt; else if (c === "cote") cote += st.dt; else calme += st.dt;
    headSum += head * st.dt; wsSum += w.ws * st.dt; tt += st.dt; pSum += P * st.dt; p4 += P ** 4 * st.dt;
  }
  if (tt < 600) return null;
  // coût du vent : même parcours à puissance constante (ta moyenne estimée), avec puis sans le vent
  const avgP = pSum / tt, Pc = Math.max(80, avgP); let tW = 0, t0w = 0;
  seg.forEach(q => { tW += q.d / speedFor(Pc, M, q.gr, q.head / 3.6 * .75, q.rho); t0w += q.d / speedFor(Pc, M, q.gr, 0, q.rho); });
  return { face: face / tt, dos: dos / tt, cote: cote / tt, calme: calme / tt, head: headSum / tt, ws: wsSum / tt, cost: tW - t0w, avgP, np: Math.pow(p4 / tt, .25), M, Pc };
}

// ------------------------------------------------------------------ Fenêtre de bilan
function ensureModal() {
  let m = document.getElementById("bmBack");
  if (m) return m;
  m = document.createElement("div"); m.id = "bmBack"; m.className = "bm-back"; m.hidden = true;
  m.innerHTML = `<div class="bm" role="dialog" aria-modal="true" aria-labelledby="bmTitle"><div id="bmBody"></div></div>`;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-bmclose]")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !m.hidden) close(); });
  return m;
}
function close() { const m = document.getElementById("bmBack"); if (m) { m.hidden = true; document.documentElement.classList.remove("bm-open"); } hideTip(); }
async function open(id) {
  const a = (S.all || []).find(x => x.id === id); if (!a) return;
  const m = ensureModal(); m.hidden = false; document.documentElement.classList.add("bm-open");
  const body = document.getElementById("bmBody");
  if (isRun(a)) return openRun(a, body);
  body.innerHTML = header(a) + `<p class="note">Analyse en cours…</p>`;
  const st = await stream(id);
  const plan = window.Plan && Plan.plannedFor ? Plan.plannedFor(a.d.slice(0, 10)) : null;
  const an = st ? analyze(a, st) : null;
  const co = st && plan && st.p && plan.place === "mw" && isIndoor(a) ? compliance(st, plan) : null;
  body.innerHTML = header(a) + tiles(a, an) + verdict(a, an, co, plan) + (st ? `<section class="bm-sec"><h4>Déroulé <small>${st.p ? "puissance" : "vitesse"}${st.h ? " et cardio" : ""}${co ? " · en pointillés : le prévu" : ""}</small></h4><div id="bmChart"></div></section>` : "")
    + (co ? planTable(co) : "") + zonesHtml(a, an) + enduHtml(an) + (!isIndoor(a) && st && st.g ? `<section class="bm-sec" id="bmWind"><h4>Vent subi</h4><p class="note">Récupération de la météo du jour…</p></section>` : "")
    + (!st ? `<p class="note">${noStreamWhy(a)}</p>` : "")
    + `<div class="bm-foot"><a href="https://connect.garmin.com/modern/activity/${a.id}" target="_blank" rel="noopener">Voir sur Garmin Connect ↗</a><button class="btn2" data-bmclose>Fermer</button></div>`;
  if (st) chart(document.getElementById("bmChart"), st, co ? { plan, shift: co.shift } : null);
  if (!isIndoor(a) && st && st.g) { const w = await windFor(st).catch(() => null), box = document.getElementById("bmWind"); if (box) box.innerHTML = windHtml(a, w); }
}
function noStreamWhy(a) {
  const days = (Date.now() - a.dt) / 864e5;
  return days > 42 ? "Le détail seconde par seconde n'est gardé que pour les sorties des 6 dernières semaines : bilan limité au résumé Garmin." : "Le détail de cette séance arrive au prochain passage de la mise à jour Garmin (toutes les heures).";
}
function header(a) {
  const T = window.Plan && Plan.TYPES, pl = window.Plan && Plan.plannedFor ? Plan.plannedFor(a.d.slice(0, 10)) : null;
  return `<header class="bm-head"><div><div class="bm-k">Bilan de séance${pl ? ` · prévu : <span class="bm-badge" style="background:${T[pl.t].c}">${T[pl.t].l}</span>` : ""}</div><h3 id="bmTitle">${esc(a.n)}</h3>
    <div class="bm-sub">${a.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à ${pad(a.dt.getHours())} h ${pad(a.dt.getMinutes())} · ${isIndoor(a) ? "home trainer" : "dehors"}</div></div>
    <button class="bm-x" data-bmclose aria-label="Fermer">✕</button></header>`;
}
function tiles(a, an) {
  const t = (l, v, s) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || "&nbsp;"}</div></div>`, L = [];
  L.push(t("Durée", hms(an ? an.moving : a.mt), a.et > a.mt + 120 ? `${hms(a.et)} au total` : ""));
  if (!isIndoor(a) || a.km > 1) L.push(t("Distance", `${nf(a.km, 1)}<small> km</small>`, isIndoor(a) ? "virtuelle" : `${nf(a.km / Math.max(1, a.mt) * 3600, 1)} km/h · ${nf(a.el)} m D+`));
  const np = an && an.np ? an.np : a.np, ap = an && an.avgP ? an.avgP : a.w;
  if (ap > 0) L.push(t("Puissance", `${nf(ap)}<small> W</small>`, np ? `normalisée ${nf(np)} W` : ""));
  const ftp = ftpNow(), IF = np ? np / ftp : null;
  if (IF) L.push(t("Intensité", `${nf(IF * 100)}<small> % FTP</small>`, `≈ ${nf(an && an.tss ? an.tss : a.mt / 3600 * IF * IF * 100)} TSS`));
  const hr = an && an.avgH ? an.avgH : a.hr; if (hr > 0) L.push(t("Cardio", `${nf(hr)}<small> bpm</small>`, an && an.maxH ? `max ${nf(an.maxH)} bpm` : ""));
  if (a.te > 0) L.push(t("Effet aérobie", nf(a.te, 1), a.tl ? `charge Garmin ${a.tl}` : ""));
  return `<div class="tiles bm-tiles">${L.join("")}</div>`;
}
function verdict(a, an, co, plan) {
  const T = window.Plan && Plan.TYPES, L = [], hm = hrMax();
  if (co && co.n) {
    const m = co.mean, ok = co.inT / co.n;
    L.push(`<b>${ok >= .8 && m >= .95 ? "Séance réussie" : m >= .9 ? "Séance presque complète" : "Séance en dessous du prévu"}</b> : ${co.inT}/${co.n} effort${co.n > 1 ? "s" : ""} dans la cible, ${pct(m)} de la puissance visée en moyenne${co.missed ? `, ${co.missed} non réalisé${co.missed > 1 ? "s" : ""} (séance écourtée)` : ""}.`);
  } else if (plan) L.push(`Prévu ce jour-là : <b>${esc(plan.w.title)}</b>${plan.place === "out" ? " (dehors, au cardio)" : ""}.`);
  if (an && an.t90 >= 60 && plan && /^vo2|^test/.test(plan.t)) L.push(`${hms(an.t90)} au-dessus de 90 % de ta FC max (${Math.round(.9 * hm)} bpm) : ${an.t90 >= 600 ? "très bon stimulus VO2max" : an.t90 >= 300 ? "bon stimulus VO2max" : "un peu court pour un vrai travail VO2max, le cœur monte avec retard sur les efforts courts"}.`);
  else if (an && an.t90 >= 300) L.push(`${hms(an.t90)} au-dessus de 90 % de ta FC max.`);
  if (an && an.pz) { const easy = (an.pz[0] + an.pz[1]) / Math.max(1, an.pz.reduce((s, x) => s + x, 0));
    if (plan && (plan.t === "end" || plan.t === "rec") && easy < .75) L.push(`Pour une séance ${plan.t === "rec" ? "de récupération" : "d'endurance"}, seulement ${pct(easy)} du temps en zones 1-2 : ${plan.t === "rec" ? "trop appuyé pour bien récupérer" : "garde ces jours vraiment faciles pour réussir les séances dures"}.`);
    else if (!plan && easy >= .85 && an.moving >= 2400) L.push(`Endurance bien dosée : ${pct(easy)} du temps en zones 1-2.`); }
  if (an && an.dec != null && an.steady) L.push(`Dérive cardiaque ${nf(an.dec, 1)} % sur ${hms(an.moving)} : ${an.dec < 5 ? "endurance solide (moins de 5 %)" : an.dec < 8 ? "correcte, la fatigue se fait sentir en fin de séance" : "élevée : manque d'endurance de base, chaleur ou hydratation"}.`);
  if (!isIndoor(a)) {
    const mvT = an ? an.moving : a.mt, sp = a.km / Math.max(1, a.mt) * 3600, hr = an && an.avgH ? an.avgH : a.hr;
    const Z = an && an.hz ? an.hz : a.hz, zi = Z ? Z.indexOf(Math.max(...Z)) : -1;
    L.unshift(`${hms(mvT)} à <b>${nf(sp, 1)} km/h</b> de moyenne${hr ? `, cardio moyen ${nf(hr)} bpm` : ""}${zi >= 0 ? `, surtout en ${HZL[zi]}` : ""}${plan && plan.place === "out" ? ` · prévu : ${esc(plan.w.title)}` : ""}.`);
  }
  if (!L.length) L.push("Séance sur home trainer.");
  return `<div class="bm-verdict">${L.map(x => `<p>${x}</p>`).join("")}</div>`;
}
function planTable(co) {
  const rows = co.groups.map(g => { const R = g.rows.filter(r => !r.miss), n = g.rows.length;
    if (!R.length) return `<tr><td>${n > 1 ? `${n} × ` : ""}${hms(g.d)}</td><td>${esc(g.label.split(" ")[0])}</td><td colspan="2" class="bm-ko">non réalisé</td></tr>`;
    const avg = R.reduce((s, r) => s + r.avg, 0) / R.length, tgt = R[0].tgt, hr = R.map(r => r.hr).filter(Boolean);
    const ratio = tgt ? avg / tgt : null, cls = ratio == null ? "" : ratio >= .95 && ratio <= 1.1 ? "bm-ok" : ratio >= .9 ? "bm-mid" : "bm-ko";
    const name = g.free ? g.label.replace(/^[A-Z ]+:\s*/, "") : g.label.replace(/ · \d+\/\d+$/, "").replace(/\s\d+\/\d+$/, "");
    const extra = g.free && g.d >= 1100 ? ` → FTP estimée <b>${nf(avg * .95)} W</b>` : "";
    return `<tr><td>${n > 1 ? `${n} × ` : ""}${hms(g.d)}</td><td>${esc(name)}</td><td class="${cls}"><b>${nf(avg)} W</b>${tgt ? `<small>visé ${nf(tgt)} W · ${pct(ratio)}</small>` : `<small>effort libre${extra}</small>`}</td><td>${hr.length ? `${Math.max(...hr)} bpm<small>FC max</small>` : ""}</td></tr>`; }).join("");
  return `<section class="bm-sec"><h4>Prévu et réalisé <small>${co.shift ? `séance lancée ${hms(co.shift)} après le début de l'enregistrement` : "efforts mesurés sans les premières secondes de montée en puissance"}</small></h4><table class="bm-tab"><tbody>${rows}</tbody></table></section>`;
}
function zonesHtml(a, an) {
  let Z = null, names, cols, title;
  if (an && an.pz) { Z = an.pz; names = PZ.map(z => z[1]); cols = PZ.map(z => z[2]); title = `Zones de puissance <small>FTP ${ftpNow()} W</small>`; }
  else if (an && an.hz) { Z = an.hz; names = HZN; cols = HZC; title = "Zones cardio"; }
  else if (a.pz) { Z = a.pz; names = PZ.map(z => z[1]); cols = PZ.map(z => z[2]); title = "Zones de puissance <small>calcul Garmin</small>"; }
  else if (a.hz) { Z = a.hz; names = HZN; cols = HZC; title = "Zones cardio <small>calcul Garmin</small>"; }
  if (!Z) return "";
  const tot = Z.reduce((s, x) => s + x, 0) || 1;
  return `<section class="bm-sec"><h4>${title}</h4><div class="bm-zbar">${Z.map((x, i) => x ? `<div style="width:${x / tot * 100}%;background:${cols[i]}" title="${names[i]} : ${hms(x)}"></div>` : "").join("")}</div>
    <div class="bm-zleg">${Z.map((x, i) => x >= 30 ? `<span><i style="background:${cols[i]}"></i>${names[i]} <b>${hms(x)}</b> ${nf(x / tot * 100)} %</span>` : "").join("")}</div></section>`;
}
function enduHtml(an) {
  if (!an || an.ef == null) return "";
  return `<section class="bm-sec"><h4>Moteur aérobie</h4><p class="bm-p">Efficacité : <b>${nf(an.ef, 2)} W par battement</b> (puissance normalisée ÷ cardio moyen). Plus elle monte d'une séance d'endurance à l'autre, plus tu pousses de watts au même cardio.${an.dec != null ? ` Dérive cardiaque : <b>${nf(an.dec, 1)} %</b>${an.steady ? "" : " (séance fractionnée : à prendre avec des pincettes)"}.` : ""}</p></section>`;
}
function windHtml(a, w) {
  if (!w) return `<h4>Vent subi</h4><p class="note">Météo du jour indisponible pour cette sortie.</p>`;
  const cost = w.cost, c = Math.abs(cost) >= 60;
  return `<h4>Vent subi <small>${nf(w.ws)} km/h en moyenne sur ton parcours</small></h4>
    <div class="bm-zbar"><div style="width:${w.face * 100}%;background:#e03131"></div><div style="width:${w.cote * 100}%;background:#f2a93b"></div><div style="width:${w.dos * 100}%;background:#2f9e44"></div><div style="width:${w.calme * 100}%;background:#868e96"></div></div>
    <div class="bm-zleg"><span><i style="background:#e03131"></i>face <b>${pct(w.face)}</b></span><span><i style="background:#f2a93b"></i>côté <b>${pct(w.cote)}</b></span><span><i style="background:#2f9e44"></i>dos <b>${pct(w.dos)}</b></span>${w.calme > .02 ? `<span><i style="background:#868e96"></i>faible <b>${pct(w.calme)}</b></span>` : ""}</div>
    <p class="bm-p">${c ? `À puissance égale (≈ ${nf(w.Pc)} W), le vent ${cost > 0 ? "t'a coûté" : "t'a fait gagner"} <b>environ ${hms(Math.abs(cost))}</b> sur ce parcours par rapport à une journée sans vent.` : "Le vent n'a quasiment rien changé à ton temps sur ce parcours."} Puissance estimée : <b>≈ ${nf(w.avgP)} W</b> de moyenne.</p>
    <p class="note">Estimation sans capteur de puissance : vent à 10 m au centre du parcours, modèle physique (${nf(w.M - PHY.bike)} kg + vélo). En groupe, l'abri fausse le calcul.</p>`;
}
function chart(box, st, cmp) {
  if (!box) return;
  const W = Math.max(300, box.clientWidth || 600), H = 200, m = { l: 34, r: 34, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = st.n, dt = st.dt;
  const smooth = (arr, w) => { if (!arr || w <= 1) return arr; return arr.map((v, i) => { if (v == null) return null; let s_ = 0, c = 0; for (let k = Math.max(0, i - w + 1); k <= i; k++) if (arr[k] != null) { s_ += arr[k]; c++; } return c ? s_ / c : null; }); };
  const isP = !!(st.p && st.p.some(x => x > 0));
  const main = isP ? smooth(st.p, Math.round(20 / dt)) : st.v ? smooth(st.v.map(x => x == null ? null : x / 10), Math.round(60 / dt)) : null;
  const HR = st.h ? smooth(st.h.map(v => v > 0 ? v : null), Math.round(15 / dt)) : null;
  const maxV = main ? Math.max(...main.filter(x => x != null)) * 1.08 || 1 : 1;
  const x = i => m.l + i / Math.max(1, n - 1) * iw, y = v => m.t + ih - v / maxV * ih;
  const H2 = HR ? HR.filter(v => v > 0) : [], hLo = H2.length ? Math.min(...H2) - 5 : 0, hHi = H2.length ? Math.max(...H2) + 5 : 1, yh = v => m.t + ih - (v - hLo) / (hHi - hLo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Déroulé de la séance"><g class="axis">`;
  const tStep = n * dt > 3 * 3600 ? 3600 : n * dt > 3600 ? 1800 : 600;
  for (let t = 0; t <= n * dt; t += tStep) s += `<text x="${x(t / dt)}" y="${H - 5}" text-anchor="middle">${t >= 3600 ? `${Math.floor(t / 3600)} h${t % 3600 ? pad(t % 3600 / 60) : ""}` : `${t / 60}′`}</text>`;
  if (main) [.25, .5, .75, 1].forEach(f => { const v = Math.round(maxV * f / 10) * 10; s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  if (H2.length) [hLo + 5, (hLo + hHi) / 2, hHi - 5].forEach(v => s += `<text x="${W - m.r + 5}" y="${yh(v) + 4}" fill="#c2255c">${Math.round(v)}</text>`);
  s += "</g>";
  if (main) { let d = "", pen = false; main.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; });
    s += `<path d="M${x(0)},${y(0)}${d.replace(/^M/, "L").replace(/M/g, "L")}L${x(n - 1)},${y(0)}Z" fill="var(--accent)" opacity=".28"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.2" opacity=".9"/>`; }
  if (cmp && isP) { let t = cmp.shift, d = ""; cmp.plan.w.steps.forEach(stp => { const a = stp.free ? null : stp.lo * cmp.plan.ftp, b = stp.free ? null : stp.hi * cmp.plan.ftp;
      if (a != null) d += `M${x(t / dt).toFixed(1)},${y(a).toFixed(1)}L${x((t + stp.d) / dt).toFixed(1)},${y(b).toFixed(1)}`; t += stp.d; });
    s += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="4 3" opacity=".75"/>`; }
  if (H2.length) { let d = "", pen = false; HR.forEach((v, i) => { if (!v) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + yh(v).toFixed(1); pen = true; }); s += `<path d="${d}" fill="none" stroke="#c2255c" stroke-width="1.8" stroke-linejoin="round"/>`; }
  s += `<line id="bmCur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="bmHit"/></svg>`;
  box.innerHTML = s + `<div class="legend bm-leg"><span><i style="background:var(--accent)"></i>${isP ? "puissance (W)" : "vitesse (km/h)"}</span>${H2.length ? `<span><i style="background:#c2255c"></i>cardio (bpm)</span>` : ""}${cmp && isP ? `<span><i style="background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 6px)"></i>prévu</span>` : ""}</div>`;
  const svg = box.querySelector("svg"), cur = box.querySelector("#bmCur"), hit = box.querySelector("#bmHit");
  const mv = e => { const r = svg.getBoundingClientRect(), i = clamp(Math.round(((e.clientX - r.left) * W / r.width - m.l) / iw * (n - 1)), 0, n - 1);
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", .6);
    const t = i * dt; showTip(e, `<b>${t >= 3600 ? `${Math.floor(t / 3600)} h ${pad(Math.floor(t % 3600 / 60))}` : `${Math.floor(t / 60)} min ${pad(t % 60)}`}</b>${st.p && st.p[i] != null ? `<br>${st.p[i]} W` : ""}${st.h && st.h[i] ? `<br>${st.h[i]} bpm` : ""}${st.v && st.v[i] != null ? `<br>${nf(st.v[i] / 10, 1)} km/h` : ""}`); };
  hit.addEventListener("pointermove", mv); hit.addEventListener("pointerdown", mv); hit.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
}

// ------------------------------------------------------------------ Carte « Progression » (onglet Plan)
// Profil de puissance de Coggan (hommes, W/kg) : de « débutant » à « classe mondiale »
const COG = { "5": [10.17, 24.04], "60": [5.64, 11.5], "300": [2.33, 7.6], "1200": [1.86, 6.4] };
const COGL = ["débutant", "moyen", "correct", "bon", "très bon", "excellent", "exceptionnel", "classe mondiale"];
async function progress(el, opt = {}) {
  if (!el) return;
  const seq = ++B.prog, ftp = opt.ftp || ftpNow(), now = Date.now(), R = (S.all || []).filter(a => RIDE_TYPES.has(a.t));
  // 1. FTP estimée séance par séance (meilleur 20 min × 95 %)
  const cut = now - 120 * 864e5, pts = R.filter(a => a.dt.getTime() >= cut && a.pc && a.pc["1200"] && a.pc["1200"] * .95 >= .8 * ftp).map(a => ({ t: a.dt.getTime(), v: a.pc["1200"] * .95, a }));
  // 2. efficacité aérobie sur les séances régulières (home trainer, intensité modérée)
  const ef = R.filter(a => a.dt.getTime() >= cut && isIndoor(a) && a.np > 0 && a.w > 0 && a.hr > 0 && a.mt >= 1800 && a.np / a.w <= 1.07 && a.np / ftp >= .5 && a.np / ftp <= .85).map(a => ({ t: a.dt.getTime(), v: a.np / a.hr, a }));
  // 3. profil de coureur sur 90 jours
  const c90 = now - 90 * 864e5, best = {}; R.filter(a => a.dt.getTime() >= c90 && a.pc).forEach(a => ["5", "60", "300", "1200"].forEach(k => { const v = a.pc[k]; if (v && (!best[k] || v > best[k].v)) best[k] = { v, a }; }));
  const kg = kgNow(), goal = opt.goal || { ftp: 300 };
  let html = `<div class="pg-grid">`;
  html += `<div class="pg-box"><h4>FTP estimée <small>tes efforts de 20 min × 95 %</small></h4>${pts.length ? `<div id="pgFtp"></div>` : `<p class="note">Pas encore d'effort soutenu de 20 min (au moins 80 % de ta FTP) ces 4 derniers mois.</p>`}</div>`;
  html += `<div class="pg-box"><h4>Efficacité aérobie <small>W par battement, séances régulières</small></h4>${ef.length >= 2 ? `<div id="pgEf"></div><p class="bm-p" id="pgEfTxt"></p>` : `<p class="note">Il faut au moins 2 séances régulières sur MyWhoosh (endurance, tempo, sweet spot) pour suivre ta progression.</p>`}</div>`;
  html += `<div class="pg-box pg-wide"><h4>Profil de coureur <small>meilleures valeurs des 90 derniers jours${kg ? ` · ${nf(kg, 1)} kg` : ""}</small></h4>${profileHtml(best, kg)}</div>`;
  html += `<div class="pg-box pg-wide"><h4>Endurance de base <small>dérive cardiaque des dernières séances régulières</small></h4><div id="pgDec"><p class="note">Analyse des séances…</p></div></div></div>`;
  if (seq !== B.prog) return;
  el.innerHTML = html;
  if (pts.length) dots(document.getElementById("pgFtp"), pts, { unit: "W", goal: goal.ftp, hist: (opt.profile && opt.profile.ftpHist) || prof().ftpHist, d: 0, best: true });
  if (ef.length >= 2) {
    dots(document.getElementById("pgEf"), ef, { unit: "W/bpm", d: 2, trend: true });
    const w4 = now - 28 * 864e5, a1 = ef.filter(p => p.t >= w4), a0 = ef.filter(p => p.t < w4 && p.t >= w4 - 28 * 864e5), m = A => A.reduce((s, p) => s + p.v, 0) / A.length;
    document.getElementById("pgEfTxt").innerHTML = a1.length && a0.length ? `Sur les 4 dernières semaines : <b>${m(a1) >= m(a0) ? "+" : "−"}${nf(Math.abs(m(a1) / m(a0) - 1) * 100, 1)} %</b> par rapport aux 4 précédentes${m(a1) > m(a0) * 1.02 ? " : à cardio égal, tu pousses plus de watts." : m(a1) < m(a0) * .98 ? " : fatigue, chaleur ou séances plus intenses ?" : "."}` : "La tendance apparaîtra avec quelques semaines de séances.";
  }
  // dérive cardiaque : les 6 dernières séances régulières de 45 min et plus qui ont leur détail
  const cand = R.filter(a => a.mt >= 2700 && a.np > 0 && a.hr > 0 && (now - a.dt) <= 42 * 864e5).slice(-12).reverse(), rows = [];
  for (const a of cand) { if (rows.length >= 6) break; const st = await stream(a.id); if (seq !== B.prog) return; if (!st) continue; const an = analyze(a, st); if (an.dec != null && an.steady) rows.push({ a, an }); }
  const box = document.getElementById("pgDec"); if (!box) return;
  box.innerHTML = rows.length ? `<table class="bm-tab">${rows.map(({ a, an }) => `<tr><td>${a.dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</td><td><button class="lnk" data-pgb="${a.id}">${esc(a.n)}</button></td><td class="${an.dec < 5 ? "bm-ok" : an.dec < 8 ? "bm-mid" : "bm-ko"}"><b>${nf(an.dec, 1)} %</b><small>${hms(an.moving)} · ${nf(an.np)} W</small></td></tr>`).join("")}</table><p class="note">Moins de 5 % de dérive sur une séance régulière d'une heure ou plus : ta base aérobie tient l'effort.</p>`
    : `<p class="note">Pas encore de séance régulière de 45 min ou plus avec son détail (endurance, tempo, sweet spot sur MyWhoosh).</p>`;
  box.querySelectorAll("[data-pgb]").forEach(b => b.onclick = () => open(+b.dataset.pgb));
}
function profileHtml(best, kg) {
  const L = [["5", "Sprint", "5 s"], ["60", "Anaérobie", "1 min"], ["300", "VO2max", "5 min"], ["1200", "Seuil", "20 min"]];
  if (!L.some(([k]) => best[k])) return `<p class="note">Pas encore de puissances maximales mesurées sur 90 jours.</p>`;
  const sc = {};
  const rows = L.map(([k, nm, d]) => { const b = best[k]; if (!b) return `<div class="pf-row"><span>${nm} <small>${d}</small></span><div class="pf-bar"></div><span class="pf-v">–</span></div>`;
    const v = k === "1200" ? b.v * .95 : b.v, wkg = kg ? v / kg : null, f = wkg ? clamp((wkg - COG[k][0]) / (COG[k][1] - COG[k][0]), 0, 1) : null; if (f != null) sc[k] = f;
    return `<div class="pf-row"><span>${nm} <small>${d}${k === "1200" ? " × 95 %" : ""}</small></span><div class="pf-bar">${f != null ? `<div style="width:${Math.max(3, f * 100)}%"></div>` : ""}</div><span class="pf-v"><b>${nf(v)} W</b>${wkg ? `<small>${nf(wkg, 2)} W/kg · ${COGL[Math.min(7, Math.floor(f * 8))]}</small>` : ""}</span></div>`; }).join("");
  let txt = "";
  if (Object.keys(sc).length === 4) {
    const sp = (sc["5"] + sc["60"]) / 2, en = (sc["300"] + sc["1200"]) / 2, diff = sp - en;
    const type = diff > .12 ? "plutôt puncheur / sprinteur" : diff < -.12 ? "plutôt rouleur / diesel" : "polyvalent";
    const names = { "5": "le sprint", "60": "l'effort d'une minute", "300": "la VO2max (5 min)", "1200": "le seuil (20 min)" };
    const weak = Object.keys(sc).reduce((a, b) => sc[b] < sc[a] ? b : a), strong = Object.keys(sc).reduce((a, b) => sc[b] > sc[a] ? b : a);
    txt = `<p class="bm-p">Profil <b>${type}</b> : point fort ${names[strong]}, point faible ${names[weak]}.${weak === "5" || weak === "60" ? " Attention : tes meilleures valeurs courtes viennent surtout de séances en ERG, sans vrai sprint ; le test court (sprint, 1 min, 5 min) les mesurera vraiment." : weak === "1200" || weak === "300" ? " C'est justement ce que travaillent tes blocs seuil et VO2max." : ""}</p>`;
  } else if (!kg) txt = `<p class="note">Indique ton poids (carte « Ton niveau ») pour situer chaque valeur sur l'échelle de Coggan.</p>`;
  return `<div class="pf">${rows}</div>${txt}<p class="note">Échelle : tableau de profil de puissance de Coggan (hommes), du débutant à la classe mondiale.</p>`;
}
function dots(box, P, o) {
  if (!box) return;
  const W = Math.max(280, box.clientWidth || 400), H = 170, m = { l: 40, r: 10, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = Math.min(...P.map(p => p.t)), t1 = Math.max(Date.now(), ...P.map(p => p.t));
  const vals = P.map(p => p.v).concat(o.goal ? [o.goal] : []), lo0 = Math.min(...vals), hi0 = Math.max(...vals), padv = (hi0 - lo0) * .15 || hi0 * .05, lo = lo0 - padv, hi = hi0 + padv;
  const x = t => m.l + (t - t0) / Math.max(1, t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="axis">`;
  const tk = niceTicks(hi - lo, 3)[1] || 1; for (let v = Math.ceil(lo / tk) * tk; v <= hi; v += tk) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end">${nf(v, o.d)}</text>`;
  const d0 = new Date(t0); for (let k = 1; k < 14; k++) { const f = new Date(d0.getFullYear(), d0.getMonth() + k, 1); if (f.getTime() > t1) break; s += `<text x="${x(f.getTime())}" y="${H - 5}" text-anchor="middle">${MONTHS[f.getMonth()]}</text>`; }
  s += "</g>";
  if (o.goal) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(o.goal)}" y2="${y(o.goal)}" stroke="var(--accent)" stroke-dasharray="5 4"/><text x="${W - m.r}" y="${y(o.goal) - 5}" text-anchor="end" font-size="11" font-weight="700" fill="var(--accent)">objectif ${o.goal} W</text>`;
  if (o.hist && o.hist.length) { const H2 = o.hist.map(([d, v]) => [new Date(d).getTime(), v]).filter(([t]) => t >= t0 - 60 * 864e5); let d = ""; H2.forEach(([t, v], i) => { const xx = x(Math.max(t, t0)); d += (i ? `L${xx},${y(H2[i - 1][1])}L` : "M") + `${xx},${y(v)}`; }); if (H2.length) d += `L${x(t1)},${y(H2[H2.length - 1][1])}`; s += `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="1.5"/>`; }
  if (o.best && P.length >= 2) { const S2 = P.slice().sort((a, b) => a.t - b.t), bestAt = t => Math.max(...S2.filter(q => q.t <= t && q.t > t - 42 * 864e5).map(q => q.v));
    let d = "", prev = null; S2.forEach(p => { const v = bestAt(p.t); d += prev == null ? `M${x(p.t).toFixed(1)},${y(v).toFixed(1)}` : `L${x(p.t).toFixed(1)},${y(prev).toFixed(1)}L${x(p.t).toFixed(1)},${y(v).toFixed(1)}`; prev = v; });
    s += `<path d="${d}L${x(t1).toFixed(1)},${y(prev).toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="2"/>`; }
  if (o.trend && P.length >= 3) { const S2 = P.slice().sort((a, b) => a.t - b.t); let d = ""; S2.forEach((p, i) => { const w = S2.filter(q => q.t <= p.t && q.t > p.t - 28 * 864e5), v = w.reduce((s2, q) => s2 + q.v, 0) / w.length; d += (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(v).toFixed(1); }); s += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>`; }
  P.forEach((p, i) => s += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="4" fill="var(--accent)" fill-opacity=".75" stroke="var(--card)" stroke-width="1.5" data-i="${i}" style="cursor:pointer"/>`);
  box.innerHTML = s + "</svg>" + (o.hist ? `<div class="legend bm-leg"><span><i style="background:var(--accent)"></i>efforts de 20 min${o.best ? " (meilleur sur 6 semaines)" : ""}</span><span><i style="background:var(--muted)"></i>FTP Garmin</span></div>` : "");
  const svg = box.querySelector("svg");
  svg.addEventListener("pointermove", e => { const c = e.target.closest("circle[data-i]"); if (!c) return hideTip(); const p = P[+c.dataset.i]; showTip(e, `<b>${p.a.dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</b> · ${esc(p.a.n)}<br>${nf(p.v, o.d)} ${o.unit}`); });
  svg.addEventListener("pointerleave", hideTip);
  svg.addEventListener("click", e => { const c = e.target.closest("circle[data-i]"); if (c) open(P[+c.dataset.i].a.id); });
}

// ------------------------------------------------------------------ Branchements
// « Dernières sorties » (onglet Vélo) : un clic ouvre le bilan au lieu de Garmin Connect (lien gardé dans le bilan)
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a.ride"); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const id = +String(a.getAttribute("href") || "").split("/").pop(), act = (S.all || []).find(x => x.id === id);
  if (!act || !(RIDE_TYPES.has(act.t) || isRun(act))) return;
  e.preventDefault(); open(id);
}, true);
document.addEventListener("velo:loaded", () => { B.idx = null; B.cache = {}; });
window.Bilan = { open, close, progress, _analyze: analyze, _compliance: compliance, _wind: windFor, _run: { paceTxt, pace: runPace, analyze: analyzeRun, zoneOf: runZoneOf, zones: RUN_ZONES, verdict: verdictRun, tiles: tilesRun } };
})();
