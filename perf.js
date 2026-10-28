// Carte « Tes performances » (onglet Plan) : records de puissance, courbe de puissance, FTP / VO2max / volume / vitesse dehors,
// repère de classement en une ligne, et les champs Poids (#pKg) / Âge (#pAge) que plan.js branche (bwWeight, bwAge).
// API : Perf.html(opt) → HTML de la section ; Perf.bind(el, onChange) → graphe, clics, infobulles ; Perf._ = fonctions pures (tests/perf.mjs).
(function () {
  const DAY = 864e5;
  const DUR = [["5", "5 s"], ["60", "1 min"], ["300", "5 min"], ["1200", "20 min"], ["3600", "1 h"]];
  const WIN = 90;               // fenêtre des records récents (jours), comparée aux 90 jours d'avant
  const STABLE = 3;             // ±3 % : « stable »
  const OUT_KM = 40;            // sorties dehors retenues pour la vitesse moyenne
  // repères de classement (mêmes tables que plan.js)
  const ZWIFT = [[0, 0], [1.5, 2], [2, 6], [2.5, 13], [3.2, 42], [4, 85], [4.6, 95], [5.2, 99], [6.5, 100]];  // % cumulé des coureurs
  const AFY = { "<30": [4.95, 5.77], "30-39": [4.3, 5.59], "40-49": [4, 4.88], "50-59": [3.63, 4.38], "60+": [3.23, 4.18] };  // médiane, top 10 % (hommes)
  const AGE_TXT = { "<30": "moins de 30 ans", "30-39": "30 à 39 ans", "40-49": "40 à 49 ans", "50-59": "50 à 59 ans", "60+": "60 ans et plus" };
  const RIDE0 = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);

  const rideSet = () => (typeof RIDE_TYPES !== "undefined" ? RIDE_TYPES : RIDE0);
  const tOf = a => (a.dt instanceof Date ? a.dt.getTime() : new Date(a.dt || a.d).getTime());
  const ms = n => (n instanceof Date ? n.getTime() : n == null ? Date.now() : +n);
  const indoor = a => a.t === "VirtualRide" || a.tr === 1;
  const fmt = (n, d = 0) => (typeof nf === "function" ? nf(n, d) : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n));
  const sg = (n, d = 0) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n), d);   // signe typographique
  const E = s => (typeof esc === "function" ? esc(s) : String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  const dfr = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const ls = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

  // ------------------------------------------------------------------ Fonctions pures
  const rides = acts => (acts || []).filter(a => a && rideSet().has(a.t));
  // meilleure valeur pc[k] dans [from, to[
  function bestIn(R, k, from, to) {
    let b = null;
    for (const a of R) { const v = a.pc && a.pc[k], t = tOf(a); if (v > 0 && t >= from && t < to && (!b || v > b.v || (v === b.v && t < b.t))) b = { v, t, id: a.id, n: a.n }; }   // à égalité, la plus ancienne
    return b;
  }
  // records par durée : 90 derniers jours, 90 jours d'avant, record des 12 mois
  function records(acts, now) {
    const N = ms(now) + 1, R = rides(acts), c = N - WIN * DAY, p = c - WIN * DAY, y = N - 365 * DAY;
    return DUR.map(([k, l]) => {
      const cur = bestIn(R, k, c, N), prev = bestIn(R, k, p, c), year = bestIn(R, k, y, N);
      const d = cur && prev ? cur.v - prev.v : null;
      return { k, l, cur, prev, year, d, pct: d != null ? d / prev.v * 100 : null, rec: cur && year ? (year.id === cur.id ? "battu" : cur.v >= year.v ? "égalé" : "") : "" };
    }).filter(r => r.year);
  }
  // tendance : médiane des variations des durées comparables ; la durée la plus proche de cette médiane est citée (un sprint isolé ne fait pas la phrase)
  function trend(recs) {
    const C = (recs || []).filter(r => r.pct != null);
    if (!C.length) return null;
    const s = C.map(r => r.pct).sort((a, b) => a - b), med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    const dir = med > STABLE ? "up" : med < -STABLE ? "down" : "flat";
    const ref = dir === "flat" ? 0 : med, pick = C.reduce((a, b) => (Math.abs(b.pct - ref) <= Math.abs(a.pct - ref) + 1e-9 ? b : a));   // à égalité, la plus longue durée
    return { dir, med, pick, n: C.length };
  }
  const wkg = (w, kg) => (w > 0 && kg > 0 ? w / kg : null);
  // phrase-réponse de la carte
  function headline(recs, ftp, kg, goal) {
    const T = trend(recs), parts = [];
    if (!recs || !recs.length) parts.push("Pas encore de record de puissance sur 12 mois : ils viennent de tes séances sur home trainer, avec la puissance.");
    else if (!T) parts.push("Pas assez de séances avec puissance sur les 6 derniers mois pour dire si tes records montent.");
    else {
      const p = T.pick, cmp = `${fmt(p.cur.v)} W contre ${fmt(p.prev.v)}`;
      parts.push(T.dir === "up" ? `Tes records de puissance montent : ${sg(p.pct)} % sur ${p.l} en 90 jours (${cmp}).`
        : T.dir === "down" ? `Tes records de puissance baissent : ${sg(p.pct)} % sur ${p.l} en 90 jours (${cmp}).`
          : `Tes records de puissance sont stables sur 90 jours (${p.l} : ${cmp}).`);
    }
    if (ftp > 0) {
      const g = goal && goal.ftp > 0 ? goal.ftp - ftp : null, gTxt = g == null ? "" : g > 0 ? `, à ${fmt(g)} W de ton objectif` : ", objectif atteint";
      const x = wkg(ftp, kg);
      parts.push(x ? `Ta FTP de travail (${fmt(ftp)} W) te place à ${fmt(x, 2)} W/kg${gTxt}.` : `Ta FTP de travail est de ${fmt(ftp)} W${gTxt}.`);
    }
    return parts.join(" ");
  }
  // dernière valeur connue au plus tard à la date t (liste [[date, v]])
  function valAt(hist, t) { let v = null; for (const [d, x] of hist || []) { if (new Date(d).getTime() <= t && x != null) v = { d, v: x }; } return v; }
  function vo2Tile(profile, now, goal) {
    const H = ((profile && profile.vo2) || []).filter(r => r && r[1] != null).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!H.length) return null;
    const N = ms(now), cur = { d: H[H.length - 1][0], v: H[H.length - 1][1] }, old = valAt(H, N - 90 * DAY);
    return { v: cur.v, d: cur.d, d90: old ? cur.v - old.v : null, gap: goal && goal.vo2 > 0 ? goal.vo2 - cur.v : null, goal: goal && goal.vo2 };
  }
  function ftpTile(ftp, kg, goal) {
    if (!(ftp > 0)) return null;
    return { w: ftp, wkg: wkg(ftp, kg), goal: goal && goal.ftp > 0 ? goal.ftp : null, gap: goal && goal.ftp > 0 ? goal.ftp - ftp : null, gwkg: goal && goal.ftp > 0 ? wkg(goal.ftp, kg) : null };
  }
  // volume vélo : 4 dernières semaines contre la moyenne des 12 semaines (moyennes hebdomadaires)
  function volume(acts, now) {
    const N = ms(now) + 1, R = rides(acts), sum = (from) => R.filter(a => { const t = tOf(a); return t >= from && t < N; }).reduce((s, a) => ({ h: s.h + (a.mt || 0) / 3600, km: s.km + (a.m || 0) / 1000, n: s.n + 1 }), { h: 0, km: 0, n: 0 });
    const a4 = sum(N - 28 * DAY), a12 = sum(N - 84 * DAY);
    if (!a12.n) return null;
    const wk4 = a4.h / 4, wk12 = a12.h / 12;
    return { h: a4.h, km: a4.km, n: a4.n, wk4, wk12, km12: a12.km / 12, pct: wk12 > 0 ? (wk4 / wk12 - 1) * 100 : null };
  }
  // vitesse moyenne des sorties dehors ≥ 40 km : 8 dernières semaines contre 12 mois (distance totale ÷ temps en mouvement)
  function outSpeed(acts, now) {
    const N = ms(now) + 1, O = rides(acts).filter(a => !indoor(a) && (a.m || 0) >= OUT_KM * 1000 && a.mt > 0);
    const avg = from => { const S2 = O.filter(a => { const t = tOf(a); return t >= from && t < N; }); const m = S2.reduce((s, a) => s + a.m, 0), t = S2.reduce((s, a) => s + a.mt, 0); return S2.length ? { v: m / t * 3.6, n: S2.length } : null; };
    const r8 = avg(N - 56 * DAY), y = avg(N - 365 * DAY);
    if (!y) return null;
    return { v8: r8 && r8.v, n8: r8 ? r8.n : 0, vy: y.v, ny: y.n, d: r8 ? r8.v - y.v : null };
  }
  // plus longue sortie de l'année civile, comparée à celle de l'année d'avant
  function longest(acts, now) {
    const Y = new Date(ms(now)).getFullYear(), R = rides(acts).filter(a => (a.m || 0) > 0);
    const top = y => R.filter(a => new Date(tOf(a)).getFullYear() === y).reduce((b, a) => (!b || a.m > b.m ? a : b), null);
    const c = top(Y), p = top(Y - 1);
    return c ? { km: c.m / 1000, t: tOf(c), id: c.id, n: c.n, y: Y, prevKm: p ? p.m / 1000 : null } : null;
  }
  // repère de classement
  const cdfPts = x => { if (x <= 0) return 0; for (let i = 1; i < ZWIFT.length; i++) if (x <= ZWIFT[i][0]) { const [a, b] = ZWIFT[i - 1], [c, d] = ZWIFT[i]; return b + (d - b) * (x - a) / (c - a); } return 100; };
  const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const topOf = c => Math.max(1, Math.round(100 - c));
  function rank(ftp, kg, age) {
    const x = wkg(ftp, kg); if (!x) return null;
    const [med, p90] = AFY[age] || AFY["30-39"], sd = (p90 - med) / 1.2816;
    const a = AFY[age] ? age : "30-39";
    return { wkg: x, zwift: topOf(cdfPts(x)), lab: topOf(100 * .5 * (1 + erf((x - med) / sd / Math.SQRT2))), age: a, ageTxt: AGE_TXT[a] };
  }
  // points de la courbe de puissance (une série par fenêtre)
  function curve(recs) {
    const pts = w => recs.filter(r => r[w]).map(r => ({ s: +r.k, v: r[w].v, l: r.l, r }));
    return { cur: pts("cur"), prev: pts("prev") };
  }

  // ------------------------------------------------------------------ Rendu
  let M = null;   // dernier modèle calculé par html(), relu par bind()
  const tile = (l, v, u, s) => `<div class="tile crtile"><div class="l">${l}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div><div class="s">${s}</div></div>`;
  const cls = d => (d > 0 ? "pf-up" : d < 0 ? "pf-dn" : "");

  function tilesHtml(o) {
    const T = [];
    if (o.ftp) {
      const f = o.ftp;
      T.push(tile("FTP de travail", f.wkg ? fmt(f.wkg, 2) : fmt(f.w), f.wkg ? "W/kg" : "W",
        `${f.wkg ? `${fmt(f.w)} W · ` : ""}${f.goal ? (f.gap > 0 ? `objectif ${fmt(f.goal)} W : encore ${fmt(f.gap)} W` : `objectif ${fmt(f.goal)} W atteint`) : "sans objectif"}`));
    }
    if (o.vo2) {
      const v = o.vo2, bits = [v.d90 != null ? (Math.abs(v.d90) < .05 ? "stable sur 90 j" : `${sg(v.d90, 1)} en 90 j`) : "", v.goal ? (v.gap > 0 ? `objectif ${fmt(v.goal)} : encore ${fmt(v.gap, 1)}` : `objectif ${fmt(v.goal)} atteint`) : ""].filter(Boolean);
      T.push(tile("VO2max Garmin", fmt(v.v, 1), "", bits.join(" · ") || `mesurée le ${dfr(v.d)}`));
    }
    if (o.vol) {
      const v = o.vol;
      T.push(tile("Vélo, 4 dernières semaines", fmt(v.h, 0), `h · ${fmt(v.km)} km`, `${fmt(v.wk4, 1)} h/sem. contre ${fmt(v.wk12, 1)} sur 12 sem.`));
    }
    if (o.spd) {
      const v = o.spd;
      T.push(tile(`Vitesse dehors, sorties ≥ ${OUT_KM} km`, v.v8 != null ? fmt(v.v8, 1) : "–", "km/h",
        v.v8 != null ? `${v.n8} sortie${v.n8 > 1 ? "s" : ""} en 8 sem. · ${fmt(v.vy, 1)} sur 12 mois` : `aucune en 8 sem. · ${fmt(v.vy, 1)} sur 12 mois`));
    }
    if (o.lng) {
      const v = o.lng;
      T.push(tile(`Plus longue sortie ${v.y}`, fmt(v.km), "km", `${dfr(v.t)}${v.prevKm ? ` · ${v.y - 1} : ${fmt(v.prevKm)} km` : ""}`));
    }
    return T.length ? `<div class="crtiles pf-tiles">${T.join("")}</div>` : "";
  }
  function recsHtml(recs, kg) {
    if (!recs.length) return `<p class="note">Pas encore de puissance mesurée sur 12 mois : tes records viendront de tes séances sur home trainer.</p>`;
    const rows = recs.map(r => {
      const c = r.cur, y = r.year;
      return `<div class="pf-rec"><span class="pf-d">${r.l}</span>
        <span class="pf-now">${c ? `<b>${fmt(c.v)} W</b>${kg ? `<small>${fmt(c.v / kg, 2)} W/kg</small>` : ""}` : `<b>–</b><small>rien en 90 j</small>`}</span>
        <span class="pf-delta ${r.d != null ? cls(r.d) : ""}">${r.d === 0 ? `<b>=</b><small>égal aux 90 j d'avant</small>` : r.d != null ? `<b>${sg(r.d)} W</b><small>${sg(r.pct, 1)} % sur 90 j d'avant</small>` : `<small>pas de valeur les 90 j d'avant</small>`}</span>
        <span class="pf-best"><small>record 12 mois${r.rec ? `, ${r.rec} ces 90 j` : ""}</small><button class="lnk" data-pfb="${y.id}" title="${E(y.n || "")}">${fmt(y.v)} W, ${dfr(y.t)}</button></span></div>`;
    }).join("");
    return `<div class="pf-recs">${rows}</div>`;
  }
  function html(opt = {}) {
    const now = ms(opt.now), acts = opt.acts || (typeof S !== "undefined" ? S.all : []) || [], profile = opt.profile || {}, goal = opt.goal || {};
    const kg = opt.kg != null ? +opt.kg || 0 : +ls("bwWeight") || 0, age = opt.age || ls("bwAge") || "30-39";
    const ftp = opt.ftp || profile.ftp || 0, recs = records(acts, now);
    M = { recs, kg, curve: curve(recs) };
    const parts = {
      ftp: ftpTile(ftp, kg, goal), vo2: vo2Tile(profile, now, goal), vol: volume(acts, now), spd: outSpeed(acts, now), lng: longest(acts, now),
    };
    const rk = rank(ftp, kg, age);
    const hasCurve = M.curve.cur.length >= 2 || M.curve.prev.length >= 2;
    return `<section class="card span12 rank perf"><h2>Tes performances <small>${ftp ? `FTP de travail ${fmt(ftp)} W` : ""}${kg ? ` · ${fmt(kg, 1)} kg` : ""}</small></h2>
    <p class="tdmsg">${headline(recs, ftp, kg, goal)}</p>
    ${tilesHtml(parts)}
    <div class="pg-grid pf-grid">
      <div class="pg-box"><h4>Records de puissance <small>meilleur des 90 derniers jours, sur home trainer</small></h4>${recsHtml(recs, kg)}</div>
      <div class="pg-box"><h4>Courbe de puissance <small>90 derniers jours contre les 90 d'avant</small></h4>${hasCurve ? `<div class="pf-curve" id="pfCurve"></div>` : `<p class="note">Il faut au moins deux durées mesurées pour tracer la courbe.</p>`}</div>
    </div>
    ${rk ? `<p class="note pf-rank">Repère : à ${fmt(rk.wkg, 2)} W/kg, tu serais dans le top ${rk.zwift} % des coureurs d'une course Zwift ${rk.lab >= 90 ? `, mais sous la plupart des hommes de ${rk.ageTxt} testés en laboratoire` : ` et le top ${rk.lab} % des hommes de ${rk.ageTxt} testés en laboratoire`} (populations plus entraînées que la moyenne).</p>` : ""}
    <div class="rkform pf-form"><label>Poids <input id="pKg" type="number" min="35" max="150" step="0.1" value="${kg || ""}" placeholder="kg"> kg</label>
      <label>Âge <select id="pAge">${Object.keys(AFY).map(k => `<option ${k === age ? "selected" : ""}>${k}</option>`).join("")}</select></label></div>
    <p class="note pf-priv">${kg ? "" : "Indique ton poids pour avoir tes watts par kilo. "}Poids et âge restent uniquement sur cet appareil.</p></section>`;
  }

  // courbe de puissance : durée en abscisse logarithmique, étiquettes au bout des courbes
  function drawCurve(box) {
    if (!box || !M) return;
    const { cur, prev } = M.curve, all = cur.concat(prev); if (!all.length) return;
    const W = Math.max(280, box.clientWidth || 400), H = 190, m = { l: 40, r: 92, t: 12, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const s0 = Math.min(...all.map(p => p.s)), s1 = Math.max(...all.map(p => p.s)), L0 = Math.log(s0), L1 = Math.log(s1);
    // ordonnée logarithmique aussi : le sprint de 5 s n'écrase pas les écarts à 5 et 20 min
    const vals = all.map(p => p.v), lo = Math.min(...vals) / 1.12, hi = Math.max(...vals) * 1.08, Y0 = Math.log(lo), Y1 = Math.log(hi);
    const x = s => m.l + (L1 > L0 ? (Math.log(s) - L0) / (L1 - L0) : .5) * iw, y = v => m.t + ih - (Math.log(v) - Y0) / (Y1 - Y0) * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de puissance"><g class="axis">`;
    for (const v of [100, 150, 200, 300, 400, 600, 800, 1000, 1500].filter(v => v >= lo && v <= hi)) s += `<line class="gridline" x1="${m.l}" x2="${m.l + iw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${m.l - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;
    DUR.filter(([k]) => +k >= s0 && +k <= s1).forEach(([k, l]) => s += `<text x="${x(+k).toFixed(1)}" y="${H - 6}" text-anchor="middle">${l}</text>`);
    s += "</g>";
    const line = (P, col, w, dash) => P.length >= 2 ? `<path d="${P.map((p, i) => (i ? "L" : "M") + x(p.s).toFixed(1) + "," + y(p.v).toFixed(1)).join("")}" fill="none" stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>` : "";
    s += line(prev, "var(--muted)", 1.6, "5 4") + line(cur, "var(--accent)", 2.4);
    const dotsOf = (P, col, w) => P.map(p => `<circle cx="${x(p.s).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${col}" stroke="var(--card)" stroke-width="1.5" data-w="${w}" data-s="${p.s}"/>`).join("");
    s += dotsOf(prev, "var(--muted)", "prev") + dotsOf(cur, "var(--accent)", "cur");
    // étiquettes au bout des lignes, écartées si elles se chevauchent
    const ends = [[cur, "ces 90 j", "var(--accent)"], [prev, "90 j d'avant", "var(--muted)"]].filter(([P]) => P.length).map(([P, t, c]) => { const p = P[P.length - 1]; return { x: x(p.s) + 8, y: y(p.v) + 4, t, c }; });
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) { const mid = (ends[0].y + ends[1].y) / 2, up = ends[0].y <= ends[1].y ? 0 : 1; ends[up].y = mid - 7; ends[1 - up].y = mid + 7; }
    ends.forEach(e => s += `<text x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}" font-size="12" font-weight="700" fill="${e.c}">${e.t}</text>`);
    box.innerHTML = s + "</svg>";
    const svg = box.querySelector("svg");
    svg.addEventListener("pointermove", e => {
      const c = e.target.closest && e.target.closest("circle[data-w]"); if (!c) return typeof hideTip === "function" && hideTip();
      const P = M.curve[c.dataset.w].find(p => p.s === +c.dataset.s), a = P && P.r[c.dataset.w]; if (!a || typeof showTip !== "function") return;
      showTip(e, `<b>${P.l} : ${fmt(a.v)} W</b>${M.kg ? ` · ${fmt(a.v / M.kg, 2)} W/kg` : ""}<br>${dfr(a.t)} · ${E(a.n || "")}`);
    });
    svg.addEventListener("pointerleave", () => typeof hideTip === "function" && hideTip());
    svg.addEventListener("click", e => { const c = e.target.closest && e.target.closest("circle[data-w]"); if (!c) return; const P = M.curve[c.dataset.w].find(p => p.s === +c.dataset.s); if (P && window.Bilan) Bilan.open(P.r[c.dataset.w].id); });
  }
  // onChange (facultatif) : si fourni, Poids et Âge sont enregistrés ici (bwWeight, bwAge) puis onChange() est appelé ;
  // sinon les champs sont laissés aux handlers de plan.js (affectation .onchange : un seul handler actif).
  function bind(el, onChange) {
    if (!el) return;
    drawCurve(el.querySelector("#pfCurve"));
    el.querySelectorAll("[data-pfb]").forEach(b => b.onclick = () => window.Bilan ? Bilan.open(+b.dataset.pfb) : window.open(`https://connect.garmin.com/modern/activity/${b.dataset.pfb}`, "_blank", "noopener"));
    if (typeof onChange === "function") {
      const kgIn = el.querySelector("#pKg"), ageIn = el.querySelector("#pAge"), set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
      if (kgIn) kgIn.onchange = () => { const v = +kgIn.value; set("bwWeight", v >= 35 && v <= 150 ? v : null); onChange(); };
      if (ageIn) ageIn.onchange = () => { set("bwAge", ageIn.value); onChange(); };
    }
  }

  window.Perf = { html, bind, _: { DUR, WIN, STABLE, OUT_KM, ZWIFT, AFY, rides, bestIn, records, trend, headline, valAt, vo2Tile, ftpTile, volume, outSpeed, longest, rank, cdfPts, curve } };
})();
