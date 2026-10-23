"use strict";
/* Carte « Ta reprise course » de l'onglet Plan : programme de reprise progressive par paliers d'une semaine (demande du 23/10/2026,
   après une périostite tibiale), en complément du vélo. Footing facile seulement, pas de fractionné.
   La course est un bouche-trou : pas de jours fixes ni de questionnaire. La progression se lit dans les courses Garmin de chaque semaine
   (voir progress) et la carte propose les jours libres du Plan où caser les sorties qui restent.
   API : Reprise.html({ acts, items, now }) → chaîne de la section ; Reprise._ = fonctions pures (node tests/reprise.mjs). */
(() => {
  const DAY = 864e5;
  const START = "2026-11-02";   // lundi du palier 1
  // durées des sorties de chaque palier (min) ; une semaine allégée tous les 4 paliers (LIGHT)
  const LADDER = [[25, 25, 30], [25, 30, 35], [30, 30, 40], [25, 25, 30],
    [25, 25, 30, 40], [25, 30, 35, 45], [30, 30, 35, 50], [25, 25, 30, 35],
    [30, 35, 40, 55], [25, 30, 30, 35, 60], [30, 30, 35, 40, 65], [30, 30, 35, 45],
    [30, 35, 40, 45, 70], [35, 35, 40, 50, 75], [35, 40, 45, 50, 80], [30, 35, 40, 55],
    [40, 40, 45, 55, 85]];
  const LIGHT = new Set([3, 7, 11, 15]);
  const RULE = { ok: .9, okLight: .5, back: .5 };   // part des minutes prévues : ≥ 90 % palier suivant (50 % en semaine allégée) ; < 50 % un palier en arrière
  const LONG = { days: 30, plus: 5, floor: 25 };    // la plus longue sortie : au plus 5 min de plus que la plus longue des 30 derniers jours
  const SPLIT_FROM = 8;                             // jamais deux jours de course de suite avant le palier 9 (index 8)
  const PACE = 340;                                 // allure de footing pour estimer les km (5:40/km, tes footings d'octobre 2026)
  const DAYN = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

  const RUN = () => (window.Charge && window.Charge.RUN_TYPES) || new Set(["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]);
  const parseYmd = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const mondayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
  const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t; };
  const dayIdx = (t, mon) => Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - mon) / DAY);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
  const km = min => Math.round(min * 60 / PACE);
  const dShort = d => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const list = a => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} et ${a[a.length - 1]}`;

  // ------------------------------------------------------------------ Fonctions pures
  // courses d'une semaine (lundi → dimanche) : [{ d: jour 0-6, min }]
  function weekRuns(acts, mon) {
    const R = RUN();
    return (acts || []).filter(a => R.has(a.t) && a.dt && a.mt > 0).map(a => ({ d: dayIdx(a.dt, mon), min: a.mt / 60 })).filter(x => x.d >= 0 && x.d <= 6);
  }
  // Où en est le programme : on rejoue chaque semaine finie depuis START. Minutes courues / minutes du palier :
  // ≥ 90 % (50 % en semaine allégée) → palier suivant ; 50 à 90 % → même palier ; moins de 50 % (semaine chargée, pause, gêne) → un palier en arrière.
  function progress(acts, now, start = START) {
    const s = parseYmd(start), cur = mondayOf(now), hist = [];
    let k = 0;
    for (let mon = s; mon < cur; mon = addDays(mon, 7)) {
      const runs = weekRuns(acts, mon), min = Math.round(sum(runs.map(r => r.min))), T = sum(LADDER[k]), r = min / T;
      const res = r >= (LIGHT.has(k) ? RULE.okLight : RULE.ok) ? "up" : r >= RULE.back ? "same" : "down";
      hist.push({ mon, k, min, n: runs.length, T, res });
      k = res === "up" ? Math.min(k + 1, LADDER.length - 1) : res === "down" ? Math.max(k - 1, 0) : k;
    }
    return { started: now >= s, start: s, k, hist, last: hist[hist.length - 1] || null };
  }
  // plafond de la plus longue sortie : la plus longue des 30 derniers jours + 5 min (25 min au moins)
  function longCap(acts, now) {
    const R = RUN(), from = now - LONG.days * DAY;
    const L = Math.max(0, ...(acts || []).filter(a => R.has(a.t) && a.dt && a.dt >= from && a.dt < now).map(a => a.mt / 60));
    return Math.max(LONG.floor, Math.floor((L + LONG.plus) / 5) * 5);
  }
  // sorties de la semaine : celles du palier, la plus longue plafonnée ; les courses faites cochent les plus longues d'abord
  function week(k, done, cap) {
    const tgt = LADDER[k].map(m => Math.min(m, cap)).sort((a, b) => b - a), D = done.map(r => r.min).sort((a, b) => b - a);
    const rows = tgt.map((m, i) => ({ min: m, done: i < D.length ? Math.round(D[i]) : null }));
    return { rows, capped: Math.max(...LADDER[k]) > cap, T: sum(LADDER[k]), doneMin: Math.round(sum(D)), left: rows.filter(r => r.done == null).map(r => r.min).sort((a, b) => a - b) };
  }
  // Jours libres de la semaine du Plan pour caser les sorties restantes. items : semaine du Plan (bike { t, st }, muscu { s, st }) ;
  // hard(t) : séance clé, sortie longue, de groupe ou test (pas de course ce jour-là). Avant le palier 9, pas de course la veille ou le lendemain d'une autre.
  function slots(items, from, runDays, n, k, hard) {
    if (n <= 0) return [];
    const busy = d => { const it = items && items[d]; if (!it) return false; const b = it.bike, m = it.muscu;
      return !!((b && b.st !== "missed" && hard(b.t)) || (m && m.s === "legs" && m.st !== "missed")); };
    const taken = new Set(runDays), C = [];
    for (let d = from; d < 7; d++) {
      if (taken.has(d) || busy(d)) continue;
      const b = items && items[d] && items[d].bike;
      C.push({ d, sc: (b && b.st !== "missed" ? 0 : 2) + (d >= 5 ? 1 : 0), what: b && b.st !== "missed" ? "en plus du vélo facile" : "pas de vélo" });
    }
    // choix : les meilleurs jours, sans deux jours de suite avant le palier 9 (avec les courses déjà faites)
    const out = [];
    for (const c of C.slice().sort((a, b) => b.sc - a.sc || a.d - b.d)) {
      if (out.length >= n) break;
      if (k < SPLIT_FROM && [...taken].some(d => Math.abs(d - c.d) === 1)) continue;
      out.push(c); taken.add(c.d);
    }
    return out.sort((a, b) => a.d - b.d);
  }
  // phrase-réponse de la carte
  function answer(P, W, now) {
    if (!P.started) return `Ta reprise démarre le lundi ${dShort(P.start)} : ${LADDER[0].length} sorties de ${list(LADDER[0].map(String))} min en footing facile, environ ${km(sum(LADDER[0]))} km.`;
    const k = P.k, L = P.last, n = W.rows.length, done = W.rows.filter(r => r.done != null).length;
    const why = !L ? "" : L.res === "up" ? ` Semaine dernière réussie (${fmtMin(L.min)} sur ${fmtMin(L.T)}) : palier suivant.`
      : L.res === "same" ? ` Semaine dernière à ${Math.round(L.min / L.T * 100)} % du prévu : on refait le même palier.`
        : ` Semaine dernière à ${Math.round(L.min / L.T * 100)} % du prévu : un palier en arrière, sans risque pour les tibias.`;
    const prev = L ? ` (${km(L.min)} km la semaine dernière)` : "";
    const head = `Palier ${k + 1} sur ${LADDER.length}${LIGHT.has(k) ? ", semaine allégée" : ""} : ${n} sorties de ${list(W.rows.map(r => r.min).sort((a, b) => a - b).map(String))} min, environ ${km(sum(W.rows.map(r => r.min)))} km${prev}.`;
    const state = done >= n ? ` Tout est fait cette semaine${W.doneMin > W.T * 1.2 ? ", et même un peu plus : garde de la marge pour les tibias" : ""}.`
      : done ? ` Tu en as fait ${done}, il reste ${list(W.left.map(String))} min.` : "";
    return head + why + state;
  }

  // ------------------------------------------------------------------ Rendu
  function html(o) {
    const now = o.now || Date.now(), P = progress(o.acts, new Date(now)), mon = mondayOf(now);
    const k = P.started ? P.k : 0, done = P.started ? weekRuns(o.acts, mon) : [];
    const W = week(k, done, P.started ? longCap(o.acts, now) : LADDER[0][2]);
    const T = window.Plan && window.Plan.TYPES, hard = t => !!(T && T[t] && !T[t].sport && (T[t].hard || t === "long" || t === "longplus"));
    const today = dayIdx(new Date(now), mon), from = new Date(now).getHours() >= 20 ? today + 1 : today;
    const S = P.started ? slots(o.items, from, done.map(r => r.d), W.left.length, k, hard) : [];
    const longest = Math.max(...W.left, 0), wkd = S.filter(s => s.d >= 5).pop();
    const slotTxt = !P.started || !W.left.length ? "" : S.length
      ? `<p class="note">Où les caser cette semaine : ${list(S.map(s => `${DAYN[s.d]} (${s.what})`))}${wkd && longest > 40 ? `. La plus longue plutôt ${DAYN[wkd.d]}` : ""}${S.length < W.left.length ? `. Pas d'autre jour libre sans coller deux courses ou tomber sur une séance clé : si une sortie saute, le palier sera simplement refait` : ""}. Ce ne sont que des idées : cours quand le vélo te laisse de la place, le matin pour aller au boulot ou le midi.</p>`
      : `<p class="note">Plus de jour libre cette semaine sans coller deux courses ou tomber sur une séance clé : ce n'est pas grave, le palier sera simplement refait.</p>`;
    const cells = LADDER.map((L, i) => `<span class="${P.started && i < k ? "ok" : i === k ? "cur" : ""}" title="${list(L.map(String))} min">${P.started && i < k ? "✓ " : ""}#${i + 1}<small>${km(sum(L))} km${LIGHT.has(i) ? " · allégée" : ""}</small></span>`).join("");
    const rows = W.rows.slice().sort((a, b) => a.min - b.min).map(r => `<li class="${r.done != null ? "ok" : ""}"><b>${r.min} min</b> footing facile${r.done != null ? ` · fait (${r.done} min)` : ""}</li>`).join("");
    return `<section class="card span12 pgram reprise" id="pRun"><h2>Ta reprise course <small>${LADDER.length} paliers d'une semaine</small></h2>
      <p class="tdmsg">${answer(P, W, now)}</p>
      <ul class="rpw">${rows}</ul>
      ${W.capped && P.started ? `<p class="note">La plus longue est ramenée à ${Math.max(...W.rows.map(r => r.min))} min : jamais plus de ${LONG.plus} min au-dessus de ta plus longue sortie des ${LONG.days} derniers jours.</p>` : ""}
      ${slotTxt}
      <details class="pgall"><summary>Voir tous les paliers</summary><div class="pgsteps">${cells}</div></details>
      <p class="note">Footing où tu parles, sous 150 bpm environ, pas de fractionné. Chemins et piste d'abord, foulée un peu plus courte. Mollets et releveurs 2 fois par semaine en muscu (3 × 15 montées sur pointes lentes, 3 × 30 s sur les talons). Tibia douloureux au-dessus de 2/10 : saute la sortie, le programme redescendra tout seul. Le palier suivant vient avec 90 % des minutes de la semaine ; moins de 50 %, un palier en arrière.</p></section>`;
  }

  window.Reprise = { html, _: { START, LADDER, LIGHT, RULE, LONG, SPLIT_FROM, weekRuns, progress, longCap, week, slots, answer, mondayOf } };
})();
