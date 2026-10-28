/* Carte « Zones cardio » de l'onglet Plan : tes 5 zones de fréquence cardiaque, la répartition de ton temps
   (champ hz des activités = secondes par zone Garmin) sur 4 semaines contre les 4 d'avant, les heures par zone
   sur 8 semaines et des repères cardio pour rouler dehors sans capteur de puissance.
   API : Zones.html({ profile, acts, now }) → chaîne de la section ; Zones.bind(el) après insertion ; Zones._ = fonctions pures. */
(() => {
  const DAY = 864e5;
  const WIN = 28;                    // fenêtre de comparaison : 4 semaines, contre les 4 d'avant
  const WEEKS = 8;                   // graphe : 8 semaines (lundi-dimanche, la semaine en cours comprise)
  const REF = { easy: .80, gray: .20, easyOk: .75, easyLow: .65, hardMin: .05, minSec: 7200, minN: 3 };   // gray = détecteur zone grise de la Synthèse (> 20 % en zone 3)
  const KARV = [.5, .6, .7, .8, .9]; // planchers en part de la réserve cardiaque (ou de la FC max sans FC de repos)
  const AGE = { "<30": 25, "30-39": 35, "40-49": 45, "50-59": 55, "60+": 65 };
  const NAMES = ["récup", "endurance", "tempo", "seuil", "VO2max"];
  const USES = ["récupération active, retour au calme", "le fond : sorties longues, base aérobie", "rythme soutenu ; la « zone grise » si elle s'invite partout",
    "efforts au seuil, blocs de 8 à 20 min", "efforts courts et durs : 30/15, 3 min"];
  const SPORTS = [["bike", "Vélo"], ["run", "Course"], ["all", "Tout"]];
  const NOUN = { bike: "vélo", run: "course", all: "vélo et course" };
  const HELP_ALL = "« Tout » = vélo et course (la marche et la muscu sont laissées de côté).";

  const RIDE = () => (typeof RIDE_TYPES !== "undefined" ? RIDE_TYPES : new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]));
  const RUN = () => (window.Charge && window.Charge.RUN_TYPES) || new Set(["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]);
  const fmt = (n, d = 0) => (typeof nf === "function" ? nf(n, d) : (+n).toFixed(d).replace(".", ","));
  const E = s => (typeof esc === "function" ? esc(s) : String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ------------------------------------------------------------------ Fonctions pures
  function ageOf(bw) {
    let v = bw; try { v = JSON.parse(bw); } catch (e) {}
    if (typeof v === "number" && v >= 10 && v <= 100) return v;
    return AGE[v] || 25;
  }
  // zones depuis le profil : planchers Garmin, sinon Karvonen (FC max et repos), sinon % de la FC max (220 − âge si inconnue)
  function zonesFrom(profile, o = {}) {
    const z = (profile && profile.hrZones) || {}, fl = z.floors;
    const ok = Array.isArray(fl) && fl.length === 5 && fl.every((v, i) => v > 0 && (!i || v > fl[i - 1]));
    if (ok) { const max = z.max > fl[4] ? z.max : fl[4] + 15; return { method: "garmin", max, rest: z.rest || null, z: fl.map((lo, i) => ({ lo, hi: i < 4 ? fl[i + 1] - 1 : max })) }; }
    const ageMax = !(z.max > 0);
    const max = z.max > 0 ? z.max : 220 - ageOf(o.age), rest = z.rest > 0 ? z.rest : (o.rest > 0 ? o.rest : null);
    const lows = KARV.map(p => Math.round(rest ? rest + p * (max - rest) : p * max));
    return { method: rest ? "karvonen" : "max", ageMax, age: ageMax ? ageOf(o.age) : null, max, rest, z: lows.map((lo, i) => ({ lo, hi: i < 4 ? lows[i + 1] - 1 : max })) };
  }
  function sportOk(a, sport) {
    const b = RIDE().has(a.t), r = RUN().has(a.t);
    return sport === "bike" ? b : sport === "run" ? r : (b || r);
  }
  const valid = a => Array.isArray(a.hz) && a.hz.length >= 5 && a.hz.some(v => v > 0);
  // secondes par zone des activités du sport, dans ]from, to]
  function agg(acts, sport, from, to) {
    const sec = [0, 0, 0, 0, 0]; let n = 0;
    for (const a of acts || []) {
      const t = +a.dt; if (!(t > from && t <= to) || !sportOk(a, sport) || !valid(a)) continue;
      for (let i = 0; i < 5; i++) sec[i] += +a.hz[i] || 0;
      n++;
    }
    return { sec, n, total: sec.reduce((s, v) => s + v, 0) };
  }
  function shares(g) {
    const T = g.total || 0, p = T ? g.sec.map(v => v / T) : [0, 0, 0, 0, 0];
    return { p, easy: p[0] + p[1], gray: p[2], hard: p[3] + p[4] };
  }
  const pct = x => Math.round(x * 100);
  // verdict : référence ~80 % en zones 1-2, peu de zone 3 (zone grise au-delà de 20 %), le reste en zones 4-5
  function verdict(g) {
    if (!g || g.n < REF.minN || g.total < REF.minSec) return { k: "nodata", txt: "pas assez de données" };
    const s = shares(g);
    if (s.gray > REF.gray) return { k: "gray", txt: "trop de zone grise, ni facile ni dur", good: false };
    if (s.easy < REF.easyLow) return { k: "hard", txt: "trop peu de facile, beaucoup d'intensité", good: false };
    if (s.easy >= REF.easyOk && s.hard >= REF.hardMin) return { k: "polar", txt: "bonne répartition polarisée", good: true };
    if (s.easy >= REF.easyOk) return { k: "easy", txt: "presque tout en facile, bonne base mais peu d'intensité", good: true };
    return { k: "ok", txt: "répartition correcte, proche du 80/20", good: true };
  }
  function hm(sec) {
    const m = Math.round((sec || 0) / 60); if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
  }
  function answer(cur, sport) {
    const v = verdict(cur), noun = NOUN[sport];
    if (v.k === "nodata") return cur.total ? `Ces 4 semaines, trop peu de temps ${noun} avec cardio (${hm(cur.total)}, ${cur.n} séance${cur.n > 1 ? "s" : ""}) pour juger ta répartition.` : `Ces 4 semaines, aucune séance ${noun} avec cardio : rien à répartir pour l'instant.`;
    const s = shares(cur);
    return `Ces 4 semaines, ${pct(s.easy)} % de ton temps ${noun} est en zones 1-2 et ${pct(s.gray)} % en zone 3 : ${v.txt}.`;
  }
  // repère : les 4 semaines d'avant et la référence
  function compare(cur, prev) {
    const ref = "Repère : environ 80 % en zones 1-2, peu de zone 3, le reste en zones 4-5.";
    if (!prev || prev.n < REF.minN || prev.total < REF.minSec) return `Les 4 semaines d'avant : trop peu de données pour comparer. ${ref}`;
    const a = shares(prev), b = shares(cur), d = pct(b.easy) - pct(a.easy);
    const dTxt = cur.total && verdict(cur).k !== "nodata" ? (d === 0 ? " (autant de facile)" : ` (${d > 0 ? "↑" : "↓"} ${Math.abs(d)} pt${Math.abs(d) > 1 ? "s" : ""} de facile)`) : "";
    return `Les 4 semaines d'avant : ${pct(a.easy)} % en zones 1-2, ${pct(a.gray)} % en zone 3, ${hm(prev.total)}${dTxt}. ${ref}`;
  }
  const mondayOf = t => window.Charge.mondayOf(t);
  // heures par zone par semaine (lundi-dimanche), la plus ancienne d'abord, la semaine en cours en dernier
  function weeks(acts, sport, now, n = WEEKS) {
    const m0 = mondayOf(now), out = [];
    for (let i = n - 1; i >= 0; i--) {
      const s = new Date(m0); s.setDate(s.getDate() - 7 * i); const e = new Date(s); e.setDate(e.getDate() + 7);
      const g = agg(acts, sport, +s - 1, Math.min(+e - 1, now));
      out.push({ mon: s, cur: i === 0, ...g });
    }
    return out;
  }
  // titre du graphe : ce qu'il faut regarder (part de zone 3, sinon volume, sinon stabilité)
  function weeksTitle(W) {
    const sum = arr => arr.reduce((g, w) => ({ sec: g.sec.map((v, i) => v + w.sec[i]), total: g.total + w.total, n: g.n + w.n }), { sec: [0, 0, 0, 0, 0], total: 0, n: 0 });
    const all = sum(W); if (!all.total) return "Pas encore de temps en zones ces 8 semaines.";
    const h = Math.floor(W.length / 2), A = sum(W.slice(0, h)), B = sum(W.slice(h));
    if (A.total && B.total) {
      const ga = pct(shares(A).gray), gb = pct(shares(B).gray);
      if (gb - ga >= 5) return `Ta part de zone 3 monte (${ga} % → ${gb} % sur les 4 dernières semaines) : surveille les sorties « entre deux ».`;
      if (ga - gb >= 5) return gb / 100 > REF.gray ? `Ta part de zone 3 baisse (${ga} % → ${gb} % sur les 4 dernières semaines), mais reste au-dessus de 20 %.` : `Ta part de zone 3 baisse (${ga} % → ${gb} %) : tes séances faciles le sont vraiment.`;
      const ha = A.total / h / 3600, hb = B.total / (W.length - h) / 3600;
      if (ha > 0 && Math.abs(hb / ha - 1) >= .2) return `Ton volume avec cardio ${hb > ha ? "monte" : "baisse"} : ${fmt(ha, 1)} h → ${fmt(hb, 1)} h par semaine en moyenne, pour une répartition à peu près stable.`;
    }
    const sa = shares(all);
    return `Répartition stable sur 8 semaines : environ ${pct(sa.easy)} % en zones 1-2 et ${pct(sa.gray)} % en zone 3${sa.gray > REF.gray ? ", c'est beaucoup de zone grise" : ""}.`;
  }
  // repères pour rouler dehors au cardio (sans changer les séances du Plan)
  function practical(Z) {
    const r = i => `${Z.z[i].lo}-${Z.z[i].hi} bpm`;
    return `Dehors sans capteur : endurance (zone 2, les 67 % de FTP du Plan) = ${r(1)}, seuil (zone 4) = ${r(3)}. Le cardio met 1 à 2 min à se caler au début d'un effort : juge-le sur la durée du bloc.`;
  }
  function methodNote(Z) {
    if (Z.method === "garmin") return `Zones de ta montre Garmin (FC max ${Z.max} bpm).`;
    const src = Z.ageMax ? `FC max estimée à 220 − âge (${Z.age} ans) = ${Z.max} bpm` : `FC max ${Z.max} bpm`;
    const base = Z.method === "karvonen" ? `Zones calculées avec la réserve cardiaque (Karvonen : 50, 60, 70, 80 et 90 % entre FC de repos ${Z.rest} et ${src})` : `Zones calculées en part de la FC max (50 à 90 %, ${src})`;
    return `${base}. La répartition du temps utilise les zones enregistrées par ta montre.`;
  }

  // ------------------------------------------------------------------ Rendu
  let last = null, lastW = [];
  const sportCur = () => { const v = LS.get("hrzSport"); return SPORTS.some(s => s[0] === v) ? v : "bike"; };
  function weeksSvg(W) {
    const max = Math.max(1, ...W.map(w => w.total)) / 3600, ticks = typeof niceTicks === "function" ? niceTicks(max, 4) : [0, max];
    const top = Math.max(max, ticks[ticks.length - 1] || max), VW = 320, VH = 140, bw = VW / W.length;
    let g = ticks.map(t => `<line x1="0" x2="${VW}" y1="${VH - t / top * VH}" y2="${VH - t / top * VH}" class="hrz-grid-l"/>`).join("");
    W.forEach((w, i) => {
      let y = VH; const x = i * bw + bw * .18, wd = bw * .64;
      w.sec.forEach((s, z) => { if (!s) return; const h = s / 3600 / top * VH; y -= h; g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wd.toFixed(1)}" height="${h.toFixed(1)}" style="fill:var(--z${z + 1})"${w.cur ? ' opacity=".55"' : ""}/>`; });
      g += `<rect x="${i * bw}" y="0" width="${bw}" height="${VH}" fill="transparent" data-w="${i}"/>`;
    });
    const lab = W.map(w => `<span>${w.mon.getDate()}/${w.mon.getMonth() + 1}${w.cur ? "<br>en cours" : ""}</span>`).join("");
    const yl = ticks.filter(t => t > 0).map(t => `<span style="bottom:${(t / top * 100).toFixed(1)}%">${fmt(t, t % 1 ? 1 : 0)} h</span>`).join("");
    return `<div class="hrz-chart"><div class="hrz-y">${yl}</div><svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" role="img" aria-label="Heures par zone cardio, 8 semaines">${g}</svg></div><div class="hrz-x">${lab}</div>`;
  }
  function tipHtml(w) {
    if (!w.total) return `Semaine du ${w.mon.getDate()}/${w.mon.getMonth() + 1} : rien avec cardio`;
    return `<b>Semaine du ${w.mon.getDate()}/${w.mon.getMonth() + 1}${w.cur ? " (en cours)" : ""}</b><br>${hm(w.total)} · ${w.n} séance${w.n > 1 ? "s" : ""}<br>` +
      w.sec.map((s, z) => `Z${z + 1} ${NAMES[z]} : ${hm(s)} (${pct(s / w.total)} %)`).join("<br>");
  }
  function html(opt = {}) {
    last = opt;
    const now = opt.now || Date.now(), acts = opt.acts || [], sport = sportCur();
    const Z = zonesFrom(opt.profile, { age: LS.get("bwAge") });
    const cur = agg(acts, sport, now - WIN * DAY, now), prev = agg(acts, sport, now - 2 * WIN * DAY, now - WIN * DAY), s = shares(cur), v = verdict(cur);
    const W = weeks(acts, sport, now); lastW = W;
    const chips = SPORTS.map(([k, l]) => `<button class="chip" data-hrz="${k}" aria-pressed="${k === sport}">${l}</button>`).join("");
    const bar = cur.total ? `<div class="hrz-bar" role="img" aria-label="Répartition du temps par zone">${cur.sec.map((x, z) => x ? `<div style="flex:${x};background:var(--z${z + 1})" title="Zone ${z + 1} : ${pct(x / cur.total)} %"></div>` : "").join("")}</div>
      <div class="hrz-ref"><span style="left:80%">80 % facile</span></div>` : "";
    const rows = Z.z.map((r, z) => {
      const p0 = prev.total ? pct(prev.sec[z] / prev.total) : null;
      return `<div class="hrz-row" style="--zc:var(--z${z + 1})"><div class="hrz-n"><b>Z${z + 1} ${NAMES[z]}</b><span class="hrz-bpm">${r.lo}-${r.hi} bpm</span><span class="hrz-pm">${pct(r.lo / Z.max)}-${pct(r.hi / Z.max)} % de ta FC max</span><small>${USES[z]}</small></div>
        <div class="hrz-v">${cur.total ? `<b>${pct(s.p[z])} %</b><small>${hm(cur.sec[z])}${p0 != null ? ` · avant ${p0} %` : ""}</small>` : `<small>—</small>`}</div></div>`;
    }).join("");
    return `<section class="card span12 hrz"><h2>Zones cardio <small>${Z.method === "garmin" ? "zones de ta montre" : Z.method === "karvonen" ? "réserve cardiaque" : "part de la FC max"} · 4 dernières semaines</small></h2>
  <div class="chips hrz-chips" role="group" aria-label="Sport">${chips}</div>
  <div class="hrz-cols">
    <div>
      <p class="hrz-ans${v.good === false ? " hrz-warn" : ""}">${E(answer(cur, sport))}</p>
      ${bar}
      <p class="note hrz-cmp">${E(compare(cur, prev))}</p>
      <div class="hrz-rows">${rows}</div>
      <p class="note">${E(methodNote(Z))}${sport === "all" ? " " + HELP_ALL : ""}</p>
    </div>
    <div>
      <h3 class="hrz-t">${E(weeksTitle(W))}</h3>
      ${weeksSvg(W)}
      <div class="legend hrz-leg">${NAMES.map((n, z) => `<span><i style="background:var(--z${z + 1})"></i>Z${z + 1} ${n}</span>`).join("")}</div>
      <p class="hrz-tip">${E(practical(Z))}</p>
    </div>
  </div>
</section>`;
  }
  function bind(el) {
    const sec = el && (el.matches && el.matches(".hrz") ? el : el.querySelector && el.querySelector(".hrz"));
    if (!sec || !last) return;
    sec.querySelectorAll("[data-hrz]").forEach(b => b.onclick = () => {
      LS.set("hrzSport", b.dataset.hrz);
      const tmp = document.createElement("div"); tmp.innerHTML = html(last); const n = tmp.firstElementChild;
      sec.replaceWith(n); bind(n);
    });
    const W = lastW;
    sec.querySelectorAll("rect[data-w]").forEach(r => {
      const w = W[+r.dataset.w]; if (!w) return;
      r.addEventListener("mousemove", e => { if (typeof showTip === "function") showTip(e, tipHtml(w)); });
      r.addEventListener("mouseleave", () => { if (typeof hideTip === "function") hideTip(); });
      r.addEventListener("click", e => { if (typeof showTip === "function") showTip(e, tipHtml(w)); });
    });
  }

  window.Zones = { html, bind, _: { ageOf, zonesFrom, sportOk, agg, shares, verdict, answer, compare, weeks, weeksTitle, practical, methodNote, hm, mondayOf, tipHtml, REF, WIN, KARV, NAMES } };
})();
