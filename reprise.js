"use strict";
/* Carte « Ta reprise course » de l'onglet Plan : programme de reprise progressive par paliers d'une semaine (demande du 23/10/2026,
   après une périostite tibiale), en complément du vélo. Footing facile ; à partir du palier 5, une séance clé par semaine au plus
   (demande du 23/11/2026, KEYS : lignes droites, côtes, seuil, VO2max en fin de programme ; contenu dans seances.js).
   La course est un bouche-trou : pas de jours fixes ni de questionnaire. La progression se lit dans les courses Garmin de chaque semaine
   (voir progress). Le Plan place les sorties du palier sur les jours de course cochés (plan.js, ladderFor) ; sans jour coché, la carte propose des jours libres.
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
  // séance clé de chaque palier (index), une au plus, jamais en semaine allégée : 4 semaines de footings sans douleur d'abord, puis
  // lignes droites (foulée, presque sans fatigue), sprints en côte (la pente limite le choc au sol), seuil, et la VO2max en dernier
  // (vitesse la plus haute, donc le plus de charge sur le tibia). Le Plan la met à la place d'un footing (plan.js, placeRuns).
  const KEYS = [null, null, null, null, "rstrides", "rhill", "rthr", null, "rthr", "rhill", "rthr", null, "rthr", "rvo2", "rthr", null, "rvo2"];
  const KEY_DUR = 40;                               // la séance clé prend la sortie du palier la plus proche de 40 min
  const nextKey = k => { for (let i = k + 1; i < KEYS.length; i++) if (KEYS[i]) return { k: i, t: KEYS[i] }; return null; };
  const PACE = 340;                                 // allure de footing pour estimer les km (5:40/km, tes footings d'octobre 2026)
  const DAYN = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

  const RUN = () => (window.Charge && window.Charge.RUN_TYPES) || new Set(["running", "trail_running", "treadmill_running", "track_running", "virtual_run"]);
  const parseYmd = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const mondayOf = t => window.Charge.mondayOf(t);
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
    // pas de jour fixe (demande du 24/11/2026) : on court quand ça arrange ; seule règle de calendrier, pas deux jours de suite en début de reprise
    const left = W.left.length, splitTxt = P.started && left && k < SPLIT_FROM ? ` Pas deux jours de suite jusqu'au palier ${SPLIT_FROM + 1}.` : "";
    const slotTxt = P.started && left ? `<p class="note">Cours quand ça t'arrange (trajet du matin, midi ou soir), il n'y a pas de jour fixe.${splitTxt}</p>` : "";
    const cells = LADDER.map((L, i) => `<span class="${P.started && i < k ? "ok" : i === k ? "cur" : ""}" title="${list(L.map(String))} min">${P.started && i < k ? "✓ " : ""}#${i + 1}<small>${km(sum(L))} km${LIGHT.has(i) ? " · allégée" : ""}</small></span>`).join("");
    // la séance clé de la semaine prend la sortie la plus proche de 40 min (KEY_DUR), comme dans la carte Séances clés course
    const kt = P.started && KEYS[k], gap = m => Math.abs(m - KEY_DUR), sorted = W.rows.slice().sort((a, b) => a.min - b.min);
    const ki = kt ? sorted.reduce((bi, r, i) => gap(r.min) < gap(sorted[bi].min) ? i : bi, 0) : -1;
    const rows = sorted.map((r, i) => `<li class="${r.done != null ? "ok" : ""}"><b>${r.min} min</b> ${i === ki ? `séance clé : ${{ rstrides: "footing + lignes droites", rhill: "côtes", rthr: "seuil", rvo2: "VO2max" }[kt]}` : "footing facile"}${r.done != null ? ` · fait (${r.done} min)` : ""}</li>`).join("");
    return `<section class="card span12 pgram reprise" id="pRun"><h2>Ta reprise course <small>${LADDER.length} paliers d'une semaine</small></h2>
      <p class="tdmsg">${answer(P, W, now)}</p>
      <ul class="rpw">${rows}</ul>
      ${W.capped && P.started ? `<p class="note">La plus longue est ramenée à ${Math.max(...W.rows.map(r => r.min))} min : jamais plus de ${LONG.plus} min au-dessus de ta plus longue sortie des ${LONG.days} derniers jours.</p>` : ""}
      ${slotTxt}
      <details class="pgall"><summary>Voir tous les paliers</summary><div class="pgsteps">${cells}</div></details>
      ${KEYS[k] && P.started ? `<p class="note">La séance clé remplace un footing, le jour que tu veux : détail, jours conseillés et envoi sur la montre dans la carte Séances clés course.</p>` : ""}
      <p class="note">Footings où tu parles, sous 150 bpm environ. Séance clé à partir du palier 5, une par semaine au plus, jamais en semaine allégée. Chemins et piste d'abord, foulée un peu plus courte. Mollets et releveurs 2 fois par semaine en muscu (3 × 15 montées sur pointes lentes, 3 × 30 s sur les talons). Tibia douloureux au-dessus de 2/10 : saute la sortie, le programme redescendra tout seul. Le palier suivant vient avec 90 % des minutes de la semaine ; moins de 50 %, un palier en arrière.</p></section>`;
  }

  window.Reprise = { html, _: { START, LADDER, LIGHT, RULE, LONG, SPLIT_FROM, KEYS, KEY_DUR, nextKey, weekRuns, progress, longCap, week, answer, mondayOf } };
})();
