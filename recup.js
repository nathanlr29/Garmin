"use strict";
// Onglet « Récup » : score du matin (sommeil, VFC, cœur au repos, charge des 4 jours, récupération Garmin), nuit, tendances et facteurs du sommeil.
(() => {
const RC = { env: null, data: null, days: [], nights: [], period: 30, night: -1, factSeed: 0, sig: null };
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const hm = mins => `${Math.floor(mins / 60)} h ${pad(Math.round(mins % 60))}`;
const hmin = mins => Math.round(mins) < 60 ? `${Math.round(mins)} min` : hm(mins);   // écarts : « 26 min » plutôt que « 0 h 26 »
const durS = s => hm(s / 60);
const clock = dt => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
const STAGES = { deep: ["Profond", "var(--deep)"], light: ["Léger", "var(--light)"], rem: ["Paradoxal", "var(--rem)"], awake: ["Éveil", "var(--awake)"] };
const LEVELS = { PRIME: "au top", HIGH: "élevée", MODERATE: "modérée", LOW: "faible", POOR: "très faible" };
const HRV_ST = { BALANCED: "équilibrée", UNBALANCED: "déséquilibrée", LOW: "basse", POOR: "très basse" };
const FEEDBACK = { WELL_RECOVERED: "bien récupéré", RECOVERED: "récupéré", RECOVERING: "en récupération", HIGH_RECOVERY_NEEDS: "gros besoin de récupération", POOR_SLEEP: "nuit difficile", GOOD_SLEEP: "bonne nuit" };

// ------------------------------------------------------------------ Lune
const SYN = 29.530588853, NEW0 = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
function moon(dt) {
  const age = (((dt.getTime() / 864e5 - NEW0) % SYN) + SYN) % SYN, p = age / SYN;
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const names = ["Nouvelle lune", "Premier croissant", "Premier quartier", "Gibbeuse croissante", "Pleine lune", "Gibbeuse décroissante", "Dernier quartier", "Dernier croissant"];
  const idx = Math.floor((p * 8 + 0.5)) % 8;
  return { age, p, illum, name: names[idx], full: Math.abs(age - SYN / 2) <= 2, nouv: age <= 2 || age >= SYN - 2 };
}
function moonSvg(m, size = 52) {
  const r = size / 2 - 2, c = size / 2, rx = Math.abs(Math.cos(2 * Math.PI * m.p)) * r;
  const wax = m.p < 0.5, cres = m.p < 0.25 || m.p > 0.75;
  const outer = wax ? 1 : 0, inner = wax ? (cres ? 0 : 1) : (cres ? 1 : 0);
  const lit = m.illum < 0.02 ? "" : m.illum > 0.98 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="#f4ecd2"/>` :
    `<path d="M${c},${c - r} A${r},${r} 0 0 ${outer} ${c},${c + r} A${rx.toFixed(2)},${r} 0 0 ${inner} ${c},${c - r}Z" fill="#f4ecd2"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-label="${m.name}"><circle cx="${c}" cy="${c}" r="${r}" fill="#2a2a30"/>${lit}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)"/></svg>`;
}
function dstNight(d) { // nuit du changement d'heure (dernier dimanche de mars / octobre)
  const m = d.getMonth(); if ((m !== 2 && m !== 9) || d.getDay() !== 0) return null;
  return d.getDate() > 24 ? (m === 2 ? "Passage à l'heure d'été (1 h de sommeil en moins)" : "Passage à l'heure d'hiver (1 h de plus)") : null;
}

// ------------------------------------------------------------------ Données
async function fetchEnv() {
  try { const r = await fetch("data/recovery.json?v=" + Date.now(), { cache: "no-store" }); if (r.ok) { const plain = await r.json(); return { plain, data: plain.updated_at || "" }; } } catch (e) {}
  return null;
}
async function openRecup(refresh) {
  const box = $("recup");
  if (!RC.env || refresh) {
    const env = await fetchEnv();
    if (!env) { if (!RC.env) box.innerHTML = `<div class="card empty"><b>Pas encore de données de récupération</b>Lance « Mise à jour Garmin » dans l'onglet Actions de GitHub. Le premier remplissage prend quelques heures.</div>`; return; }
    if (RC.env && env.data === RC.env.data) return;
    RC.env = env; RC.data = null;
  }
  if (!RC.data) { RC.data = RC.env.plain; prep(); }
  renderRecup();
}
function prep() {
  const days = Object.values(RC.data.days || {}).filter(d => d.f).sort((a, b) => a.d < b.d ? -1 : 1);
  days.forEach(d => { d.dt = parseLocal(d.d); d.bedDt = d.bed ? parseLocal(d.bed) : null; d.wakeDt = d.wake ? parseLocal(d.wake) : null; d.m = moon(new Date(d.dt.getTime() - 3 * 36e5)); });
  RC.days = days; RC.nights = days.filter(d => d.sl);
  RC.pick = days.filter(d => d.sl || d.tr != null);   // jours consultables dans le bilan
  if (RC.sel == null || RC.sel < 0 || RC.sel >= RC.pick.length) RC.sel = RC.pick.length - 1;
}

// ------------------------------------------------------------------ Mise en page
function inPeriod() {
  if (RC.period === "year") return RC.days;
  const cut = new Date(); cut.setHours(0, 0, 0, 0); cut.setDate(cut.getDate() - RC.period + 1);
  return RC.days.filter(d => d.dt >= cut);
}
function renderRecup() {
  const box = $("recup"), D = RC.data;
  $("title").textContent = "Ma récupération"; document.title = "Ma récupération";
  const u = D.updated_at ? new Date(D.updated_at) : null;
  const per = [[30, "30 jours"], [90, "90 jours"], ["year", String(new Date().getFullYear())]];
  box.innerHTML = `
  <div class="headrow" style="margin-bottom:14px">
    <div class="chips" id="rPeriod">${per.map(([v, l]) => `<button class="chip" data-p="${v}" aria-pressed="${String(RC.period) === String(v)}">${l}</button>`).join("")}</div>
    <div class="pending">${D.pending ? `<i></i>Historique en cours de récupération : encore ${D.pending} jours ·` : ""}${u ? ` Données du ${u.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${clock(u)}` : ""}</div>
  </div>
  <div class="grid">
    <section class="card span12"><div class="mnav"><span class="navn"><button id="rMPrev" aria-label="Jour précédent">‹</button><input type="date" id="rDate" aria-label="Choisir un jour"><button id="rMNext" aria-label="Jour suivant">›</button></span><button class="linkbtn" id="rToday">Dernier jour</button></div><div class="morning" id="rMorning"></div></section>
    <section class="card span12"><h2>Moniteur santé <small>ta nuit comparée à ta normale</small></h2><p class="rans" id="rHmAns"></p><div class="cmp hmon" id="rHm"></div></section>
    <section class="card span8"><h2>La nuit <span class="navn"><button id="rPrev" aria-label="Nuit précédente">‹</button><span id="rNightLbl"></span><button id="rNext" aria-label="Nuit suivante">›</button></span></h2><p class="rans" id="rNightAns"></p><div id="rHyp"></div><div id="rStages"></div></section>
    <section class="card span4"><h2>Contexte de la nuit</h2><p class="rans" id="rCtxAns"></p><div class="ctx" id="rCtx"></div></section>
    <section class="card span6"><h2>Cœur pendant la nuit <small id="rHrInfo"></small></h2><p class="rans" id="rHrAns"></p><div id="rHr"></div><div class="note" id="rHrNote"></div></section>
    <section class="card span6"><h2>VFC pendant la nuit <small id="rHrvInfo"></small></h2><p class="rans" id="rHrvAns"></p><div id="rHrv"></div><div class="note" id="rHrvNote"></div></section>
    <section class="card span6"><h2>Durée et phases <span class="legend">${Object.values(STAGES).map(([l, c]) => `<span><i style="background:${c};height:8px;width:8px;border-radius:2px"></i>${l}</span>`).join("")}</span></h2><p class="rans" id="rSleepAns"></p><div id="rSleep"></div></section>
    <section class="card span6"><h2>Régularité du sommeil <small id="rRegInfo"></small></h2><p class="rans" id="rRegAns"></p><div id="rReg"></div><div id="rSri"></div>
      <p class="note">Barres : de ton coucher à ton lever ; pointillés et bandes : heures cibles de coucher (orange) et de lever (ambre), à ${SRI.tol} min près. Courbe : ta régularité sur 7 jours, la part de la journée où tu dors ou es éveillé aux mêmes heures d'un jour à l'autre, sur 100 (bande verte : ${SRI.good} et plus, régulier).</p></section>
    <section class="card span12"><h2>Fréquence cardiaque au repos <small id="rRhrInfo"></small></h2><p class="rans" id="rRhrAns"></p><div id="rRhr"></div></section>
    <section class="card span12"><h2>Tendance de la VFC <small id="rHrvTInfo"></small></h2><p class="rans" id="rHrvTAns"></p><div id="rHrvT"></div>
      <p class="note">Trait orange : moyenne de tes 7 dernières nuits ; points gris : chaque nuit ; bande verte : ta zone normale, calculée par Garmin sur tes dernières semaines. Une mauvaise nuit compte peu : c'est quand la moyenne sort de la zone qu'il faut lever le pied.</p></section>
    <section class="card span12"><h2>Respiration pendant le sommeil <small id="rRespInfo"></small></h2><p class="rans" id="rRespAns"></p><div id="rResp"></div><p class="note" id="rRespNote"></p></section>
    <section class="card span12"><h2>Ce qui joue sur ton sommeil <small>toutes tes nuits depuis janvier</small></h2><p class="rans" id="rCmpAns"></p><div class="cmp" id="rCmp"></div>
      <p class="note">Tes nuits comparées entre elles (score de sommeil, durée, VFC). Seuls les facteurs dont l'écart est net, pas dû au hasard, sont gardés (5 au plus, 6 nuits concernées au moins) : ce sont des tendances observées, pas des causes prouvées.</p></section>
    <section class="card span12"><h2>Le saviez-tu ? <button class="btn" id="rShuffle">Autres anecdotes</button></h2><div class="facts" id="rFacts"></div></section>
  </div>`;
  $("rPeriod").onclick = e => { const b = e.target.closest("[data-p]"); if (!b) return; RC.period = b.dataset.p === "year" ? "year" : +b.dataset.p; renderRecup(); };
  const step = k => selectDay(RC.sel + k);
  $("rPrev").onclick = $("rMPrev").onclick = () => step(-1);
  $("rNext").onclick = $("rMNext").onclick = () => step(1);
  $("rToday").onclick = () => selectDay(RC.pick.length - 1);
  $("rDate").onchange = e => { const v = e.target.value; if (!v) return; let i = RC.pick.findIndex(d => d.d >= v); if (i < 0) i = RC.pick.length - 1; selectDay(i); };
  $("rShuffle").onclick = () => { RC.factSeed++; renderFacts(); };
  const P = inPeriod();
  selectDay(RC.sel);
  renderSleep(P); renderReg(P); renderRhr(P); renderHrvTrend(P); renderResp(P); renderCmp(); renderFacts();
}
function selectDay(i) {
  if (!RC.pick.length) return;
  RC.sel = Math.max(0, Math.min(RC.pick.length - 1, i));
  const d = RC.pick[RC.sel], last = RC.sel === RC.pick.length - 1;
  $("rMPrev").disabled = $("rPrev").disabled = RC.sel <= 0;
  $("rMNext").disabled = $("rNext").disabled = last;
  const inp = $("rDate"); inp.min = RC.pick[0].d; inp.max = RC.pick[RC.pick.length - 1].d; inp.value = d.d;
  $("rToday").hidden = last;
  renderMorning(); renderHealth(); renderNight(); renderNightHr(); renderNightHrv();
}
const isLatest = d => d === RC.pick[RC.pick.length - 1];

// ------------------------------------------------------------------ Bilan du matin
function scoreColor(s) { return s >= 75 ? "var(--teal)" : s >= 50 ? "var(--accent-2)" : s >= 25 ? "var(--amber)" : "var(--rose)"; }
// Le score est calculé au réveil : on signale les grosses séances faites depuis, qui compteront le lendemain
function afterNote(n) {
  if (!n.dt) return "";
  const wake = n.wakeDt || new Date(n.dt.getFullYear(), n.dt.getMonth(), n.dt.getDate(), 7);
  const acts = (S.all || []).filter(a => a.d.slice(0, 10) === Charge.ymd(n.dt) && a.dt >= wake), tss = acts.reduce((s, a) => s + Charge.tssOf(a), 0);
  if (tss < 60) return "";
  const km = acts.reduce((s, a) => s + a.km, 0), nx = new Date(n.dt); nx.setDate(nx.getDate() + 1);
  const lp = Charge.loadPart(nx), today = n.dt.toDateString() === new Date().toDateString();
  return `<div class="mafter">Score calculé au réveil (${clock(wake)}). ${today ? "Depuis" : "Dans la journée"} : ${km >= 1 ? `${nf(km)} km` : `${acts.length} séance${acts.length > 1 ? "s" : ""}`} pour ≈ ${nf(tss)} TSS${lp ? `, soit ${nf(lp.ratio, 1)}× ta charge habituelle` : ""}. ${today ? "Ça pèsera sur ton score de demain matin" : "Ça a pesé sur le score du lendemain"}${lp ? ` (charge récente : ${lp.score}/100)` : ""}.</div>`;
}
function renderMorning() {
  const n = RC.pick[RC.sel] || {}, latest = isLatest(n);
  const R = recoScore(n), s = R.score, rem = recovLeft(n), rb = n.dt ? respBase(RC.days, RC.days.indexOf(n)) : null;
  const r = 70, C = 2 * Math.PI * r;
  const ring = s != null ? `<div class="ring"><svg viewBox="0 0 168 168"><circle cx="84" cy="84" r="${r}" fill="none" stroke="var(--h0)" stroke-width="14"/>
      <circle cx="84" cy="84" r="${r}" fill="none" stroke="${scoreColor(s)}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 84 84)" id="rRingArc"/></svg>
      <div class="c"><div><div class="n">${s}</div><div class="l">récupération</div></div></div></div>`
    : `<div class="ring"><div class="c"><div><div class="n" style="font-size:40px">–</div><div class="l">pas assez de données</div></div></div></div>`;
  const when = n.dt ? n.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const today = n.dt && n.dt.toDateString() === new Date().toDateString();
  const k = (l, v, u, sub) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}<small>${u || ""}</small></div><div class="s">${sub || "&nbsp;"}</div></div>`;
  const kpis = [
    k("Sommeil", n.sl ? hm(n.sl / 60) : "–", "", n.score != null ? `score Garmin ${n.score}/100` : ""),
    k("Coucher → lever", n.bedDt ? `${clock(n.bedDt)}` : "–", n.wakeDt ? ` → ${clock(n.wakeDt)}` : "", ""),
    k("VFC", n.hrv ?? "–", n.hrv ? "ms" : "", n.hrvSt ? (HRV_ST[n.hrvSt] || n.hrvSt.toLowerCase()) + (n.hrvLo ? ` · zone ${n.hrvLo}–${n.hrvUp}` : "") : ""),
    k("FC au repos", n.rhr ?? n.srhr ?? "–", "bpm", n.hrMin ? `min. ${n.hrMin} bpm sur 24 h` : ""),
    k("Récup restante", rem != null ? (rem > 0 ? `~${nf(rem)}` : "0") : "–", rem != null ? " h" : "", rem != null ? `à ${REC.at} h, selon Garmin` : ""),
    k("Respiration", respOf(n) != null ? nf(respOf(n), n.rx != null ? 1 : 0) : "–", respOf(n) != null ? "/min" : "", [rb ? `normale ${nf(rb.m, 1)}` : "", n.sstress != null ? `stress nocturne ${n.sstress}` : ""].filter(Boolean).join(" · ")),
  ].join("");
  const factors = R.parts.map(p => `<div class="f"><span>${p.label}</span><div class="tr"><div style="width:${p.score}%;background:${scoreColor(p.score)}"></div></div><span class="num">${p.score}</span><small>${p.detail}</small></div>`).join("");
  $("rMorning").innerHTML = `${ring}
    <div><div class="mtitle">${s != null ? R.label : latest ? "Ta dernière nuit" : "La nuit"}</div>
      <div class="msub">${when ? (today ? `Ce matin, ${when}` : `Le matin du ${when}`) : ""}${n.tr != null ? ` · disponibilité Garmin ${n.tr}` : ""}</div>
      ${R.text ? `<div class="mtext">${R.text}</div>` : ""}
      ${afterNote(n)}
      <div class="kpis">${kpis}</div></div>
    <div class="factors">${factors ? `<div class="msub" style="margin:0 0 6px">Ce qui compose le score</div>${factors}` : ""}</div>`;
  const arc = $("rRingArc");
  if (arc) requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"; arc.setAttribute("stroke-dashoffset", C * (1 - s / 100)); }));
}

// ------------------------------------------------------------------ Score de récupération maison
// 5 composantes notées sur 100, pondérées ; chacune est comparée à TES 30 jours précédents.
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
function baseline(d, key, floor) {
  const i = RC.days.indexOf(d), prev = RC.days.slice(Math.max(0, i - 30), i).map(x => key(x)).filter(v => v != null && v > 0);
  if (prev.length < 7) return null;
  const m = prev.reduce((a, b) => a + b, 0) / prev.length, sd = Math.sqrt(prev.reduce((a, b) => a + (b - m) ** 2, 0) / prev.length);
  return { m, sd: Math.max(sd, floor) };
}
// Temps de récupération Garmin (minutes, mesuré au réveil) qu'il restera à REC.at heures, l'heure des séances du soir.
// 0 h → 100, REC.full h ou plus → 0 ; plafonds du score : ≥ 6 h restantes → 64 au plus, ≥ 18 h → 44 au plus (sous le seuil de 45 du Plan).
const REC = { at: 18, full: 24, caps: [[18, 44], [6, 64]] };
function recovLeft(d) {
  if (d.recov == null || !d.dt) return null;
  const wake = d.wakeDt && Charge.ymd(d.wakeDt) === d.d ? d.wakeDt.getHours() + d.wakeDt.getMinutes() / 60 : 7;
  return Math.max(0, d.recov / 60 - Math.max(0, REC.at - wake));
}
function recoScore(d) {
  const parts = [];
  const add = (key, label, w, score, detail, good, bad) => { if (score != null && !isNaN(score)) parts.push({ key, label, w, score: Math.round(clamp(score)), detail, good, bad }); };
  if (d.sl) {
    add("dur", "Durée", 25, (d.sl / 3600 - 5) / 3 * 100, `${hm(d.sl / 60)} dormies, objectif 8 h`, "nuit longue", "nuit courte");
    const tot = (d.deep || 0) + (d.light || 0) + (d.rem || 0);
    if (tot) { const share = ((d.deep || 0) + (d.rem || 0)) / tot, aw = (d.awake || 0) / 60;
      add("qual", "Qualité", 15, (share - .25) / .2 * 100 - Math.min(30, aw * .5), `profond + paradoxal ${Math.round(share * 100)} %, éveillé ${Math.round(aw)} min`, "sommeil profond et paradoxal bien présents", "sommeil morcelé ou léger"); }
  }
  const bh = baseline(d, x => x.hrv, 4);
  if (d.hrv && bh) { const z = (d.hrv - bh.m) / bh.sd, dv = d.hrv - bh.m;
    add("hrv", "VFC", 25, 55 + 22 * z, `${d.hrv} ms, ${dv >= 0 ? "+" : "−"}${nf(Math.abs(dv))} vs ta moyenne 30 j (${nf(bh.m)})`, "VFC au-dessus de ta moyenne", "VFC sous ta moyenne"); }
  const rh = v => v.rhr ?? v.srhr, br = baseline(d, rh, 1.5);
  if (rh(d) && br) { const z = (rh(d) - br.m) / br.sd, dv = rh(d) - br.m;
    add("rhr", "Cœur au repos", 15, 55 - 22 * z, `${rh(d)} bpm, ${dv >= 0 ? "+" : "−"}${nf(Math.abs(dv), 1)} vs ta moyenne 30 j (${nf(br.m, 1)})`, "cœur au repos plus bas que d'habitude", "cœur au repos plus haut que d'habitude"); }
  if (S.all && S.all.length && d.dt) {
    const fp = Charge.fatiguePart(d.dt);
    if (fp) add("load", "Charge des 4 jours", 20, fp.score, `${fp.total ? `${nf(fp.total)} de charge sur 4 jours (${fp.days[0] ? `${nf(fp.days[0])} la veille` : "repos la veille"})` : "repos ces 4 jours"} · ${nf(fp.ratio, 1)}× ta charge habituelle`, "charge des derniers jours légère", "grosse charge ces derniers jours");
  }
  const rem = recovLeft(d);
  if (rem != null) add("recov", "Récup Garmin", 20, 100 - rem / REC.full * 100, rem > 0 ? `encore ~${nf(rem)} h de récupération à ${REC.at} h selon Garmin` : `récupéré avant ${REC.at} h selon Garmin`, "récupération terminée", "récupération pas finie");
  if (parts.length < 2) return { score: null, parts };
  const W = parts.reduce((a, p) => a + p.w, 0), raw = Math.round(parts.reduce((a, p) => a + p.score * p.w, 0) / W);
  // Plafond : tant que Garmin compte de la récupération à l'heure de ta séance, le sommeil ne suffit pas à afficher « en forme »
  const cap = rem == null ? null : REC.caps.find(([h]) => rem >= h), score = cap ? Math.min(raw, cap[1]) : raw;
  const label = score >= 80 ? "Bien récupéré" : score >= 65 ? "Plutôt en forme" : score >= 50 ? "Récupération moyenne" : score >= 35 ? "Fatigue probable" : "Grosse fatigue";
  const pos = parts.filter(p => p.score >= 70).sort((a, b) => b.score * b.w - a.score * a.w).slice(0, 2).map(p => p.good);
  const neg = parts.filter(p => p.score < 45).sort((a, b) => a.score * b.w - b.score * a.w).slice(0, 2).map(p => p.bad);
  const up1 = t => t.charAt(0).toUpperCase() + t.slice(1);
  const capTxt = cap && raw > score ? `Garmin compte encore ~${nf(rem)} h de récupération à ${REC.at} h : score ramené de ${raw} à ${score}, ${score < 45 ? "pas de séance dure aujourd'hui" : "garde la séance dure pour un jour plus frais si tu peux"}.` : "";
  const text = [pos.length ? `${up1(pos.join(" et "))}.` : "", neg.length ? `À surveiller : ${neg.join(", ")}.` : "", capTxt].filter(Boolean).join(" ");
  return { score, raw, label, parts, text, rem };
}

// ------------------------------------------------------------------ La nuit (hypnogramme + contexte)
function renderNight() {
  const n = RC.pick[RC.sel];
  if (!n) { $("rHyp").innerHTML = `<div class="empty">Aucune nuit enregistrée</div>`; $("rNightAns").textContent = ""; return; }
  $("rNightLbl").textContent = n.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  $("rNightAns").innerHTML = nightAnswer(n);
  if (!n.sl) { $("rHyp").innerHTML = `<div class="note">Pas de sommeil enregistré cette nuit-là.</div>`; $("rStages").innerHTML = ""; renderCtx(n); return; }
  const box = $("rHyp");
  if (n.hyp && n.hyp.length) {
    const W = Math.max(300, box.clientWidth), rowH = 30, rows = ["awake", "rem", "light", "deep"], H = rows.length * rowH + 26, L = 64;
    const t0 = parseLocal(n.hyp[0][0]).getTime(), last = n.hyp[n.hyp.length - 1], t1 = parseLocal(last[0]).getTime() + last[1] * 6e4, span = Math.max(1, t1 - t0);
    const x = t => L + (t - t0) / span * (W - L - 6);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Phases de la nuit"><g class="axis">`;
    rows.forEach((k, i) => s += `<text x="0" y="${i * rowH + 19}">${STAGES[k][0]}</text><line class="gridline" x1="${L}" x2="${W - 6}" y1="${i * rowH + rowH}" y2="${i * rowH + rowH}" opacity=".4"/>`);
    const h0 = new Date(t0); h0.setMinutes(0, 0, 0);
    for (let t = h0.getTime() + 36e5; t < t1; t += 36e5) { const d = new Date(t); if (W < 480 && d.getHours() % 2) continue; s += `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${pad(d.getHours())} h</text>`; }
    s += "</g>";
    n.hyp.forEach(([st, mins, k], i) => {
      const a = parseLocal(st).getTime(), xa = x(a), xb = x(a + mins * 6e4), ri = rows.indexOf(k);
      s += `<rect x="${xa}" y="${ri * rowH + 5}" width="${Math.max(1.5, xb - xa)}" height="${rowH - 10}" rx="4" fill="${STAGES[k][1]}" data-i="${i}"/>`;
    });
    box.innerHTML = s + "</svg>";
    box.querySelector("svg").addEventListener("pointermove", e => {
      const r = e.target.closest("rect[data-i]"); if (!r) return hideTip();
      const [st, mins, k] = n.hyp[+r.dataset.i], a = parseLocal(st);
      showTip(e, `<b>${STAGES[k][0]}</b><br>${clock(a)} → ${clock(new Date(a.getTime() + mins * 6e4))} · ${mins} min`);
    });
    box.querySelector("svg").addEventListener("pointerleave", hideTip);
  } else box.innerHTML = `<div class="note" style="margin:6px 0 4px">Le détail des phases est conservé pour les 21 dernières nuits.</div>`;
  const tot = (n.deep || 0) + (n.light || 0) + (n.rem || 0) + (n.awake || 0) || 1;
  $("rStages").innerHTML = `<div class="stages">${["deep", "light", "rem", "awake"].map(k => `<div style="width:${(n[k] || 0) / tot * 100}%;background:${STAGES[k][1]}"></div>`).join("")}</div>
    <div class="slegend">${["deep", "light", "rem", "awake"].map(k => `<div><i style="background:${STAGES[k][1]}"></i>${STAGES[k][0]}<b>${hm((n[k] || 0) / 60)}</b>${Math.round((n[k] || 0) / tot * 100)} %</div>`).join("")}</div>`;
  renderCtx(n);
}
// Phrase-réponse de la nuit : durée et score, comparés à tes 30 nuits d'avant ; part de profond + paradoxal, éveils
function nightAnswer(n) {
  if (!n.sl) return "";
  const i = RC.days.indexOf(n), prev = RC.days.slice(Math.max(0, i - 30), i).filter(x => x.sl), avg = prev.length >= 7 ? prev.reduce((a, x) => a + x.sl, 0) / prev.length : null;
  const dm = avg != null ? Math.round((n.sl - avg) / 60) : null, tot = (n.deep || 0) + (n.light || 0) + (n.rem || 0), aw = Math.round((n.awake || 0) / 60);
  const cmp = dm == null ? "" : Math.abs(dm) < 10 ? `, comme d'habitude (${hm(avg / 60)} en moyenne sur tes 30 nuits d'avant)` : `, ${hmin(Math.abs(dm))} de ${dm > 0 ? "plus" : "moins"} que d'habitude (${hm(avg / 60)})`;
  const ph = tot ? ` Profond + paradoxal : ${Math.round(((n.deep || 0) + (n.rem || 0)) / tot * 100)} % du sommeil (bon au-dessus de 40 %), ${aw >= 10 ? `${aw} min éveillé` : "presque aucun réveil"}.` : "";
  return `<b>${hm(n.sl / 60)}</b> de sommeil${n.score != null ? `, score Garmin <b>${n.score}</b>` : ""}${cmp}.${ph}`;
}
function dayActivities(day) { // sorties du jour qui précède la nuit
  const prev = new Date(day.dt); prev.setDate(prev.getDate() - 1);
  const key = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
  return (S.all || []).filter(a => a.d.slice(0, 10) === key);
}
function nightFacts(n) {
  const acts = dayActivities(n), km = acts.reduce((s, a) => s + a.km, 0);
  const lastEnd = acts.reduce((m, a) => Math.max(m, a.dt.getTime() + (a.et || a.mt) * 1000), 0);
  const gapH = n.bedDt && lastEnd ? (n.bedDt.getTime() - lastEnd) / 36e5 : null;
  return { acts, km, late: gapH != null && gapH < 3 && gapH > -2, gapH };
}
function renderCtx(n) {
  const w = n.wx || {}, m = n.m, nf1 = (v, d = 0) => v == null ? "–" : nf(v, d);
  const it = (l, v, u) => `<div class="it"><div class="l">${l}</div><div class="v">${v}${u ? `<small> ${u}</small>` : ""}</div></div>`;
  const nfo = nightFacts(n), dst = dstNight(n.dt);
  const sport = nfo.acts.length ? `${nf(nfo.km, 0)} km${nfo.gapH != null ? ` <small>fini ${nfo.gapH < 0 ? "après" : `${nf(nfo.gapH, 1)} h avant`} le coucher</small>` : ""}` : "repos";
  const why = [nfo.acts.length ? `${nfo.km >= 1 ? `${nf(nfo.km)} km` : "une séance"} la veille${nfo.late ? ", fini moins de 3 h avant le coucher (ça peut retarder l'endormissement)" : ""}` : "repos la veille",
    w.tMin != null && w.tMin >= 18 ? `nuit chaude (${nf(w.tMin)} °C au plus frais)` : "", dst ? "changement d'heure" : ""].filter(Boolean);
  $("rCtxAns").textContent = `Ce qui a pu jouer : ${why.join(", ")}.`;
  $("rCtx").innerHTML = `<div class="moonrow">${moonSvg(m, 22)}<span>Lune : <b>${m.name.toLowerCase()}</b> · ${Math.round(m.illum * 100)} %</span></div>
    ${it("Température la nuit", w.tMin != null ? `${nf1(w.tMin, 1)} → ${nf1(w.tAvg, 1)}` : "–", "°C min → moy.")}
    ${it("Humidité", nf1(w.hum), "%")}
    ${it("Pression (24 h)", w.dP != null ? `${w.dP > 0 ? "+" : ""}${nf(w.dP, 1)}` : "–", "hPa")}
    ${it("Pluie la nuit", nf1(w.rain, 1), "mm")}
    ${it("Vent max.", nf1(w.wind), "km/h")}
    ${it("Couverture nuageuse", nf1(w.cloud), "%")}
    ${it("Qualité de l'air", w.aqi != null ? `${w.aqi} <small>${w.aqi < 20 ? "bonne" : w.aqi < 40 ? "correcte" : w.aqi < 60 ? "moyenne" : "mauvaise"}</small>` : "–")}
    ${it("Pollen (max.)", nf1(w.pollen), "grains/m³")}
    ${it("Coucher du soleil", w.sunset || "–", w.daylight ? `· ${hm(w.daylight * 60)} de jour` : "")}
    ${it("Sport la veille", sport)}
    ${dst ? `<div class="flag">${dst}</div>` : ""}${nfo.late ? `<div class="flag">Effort terminé moins de 3 h avant le coucher</div>` : ""}`;
}

// ------------------------------------------------------------------ Cœur et VFC de la nuit sélectionnée
function nightChart(el, d, key, opt) {
  const box = $(el), pts = d[key] || [];
  if (pts.length < 3 || !d.bedDt) { box.innerHTML = ""; return false; }
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(260, Math.max(190, W * .5))), m = { l: 34, r: 10, t: 14, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const end = Math.max(pts[pts.length - 1][0], d.wakeDt ? (d.wakeDt - d.bedDt) / 6e4 : 0), start = Math.min(0, pts[0][0]);
  const vals = pts.map(p => p[1]).concat(opt.band ? opt.band.filter(v => v != null) : []);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pv = (hi - lo) * .15 || 5; lo = Math.max(0, lo - pv); hi += pv;
  const x = t => m.l + (t - start) / (end - start || 1) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.title}">`;
  (d.hyp || []).forEach(([st, mins, k]) => { const a = (parseLocal(st) - d.bedDt) / 6e4; s += `<rect x="${x(a)}" y="${m.t}" width="${Math.max(0, x(a + mins) - x(a))}" height="${ih}" fill="${STAGES[k][1]}" opacity=".10"/>`; });
  const stp = niceTicks(hi - lo, 4)[1] || 1; s += `<g class="axis">`;
  for (let t = Math.ceil(lo / stp) * stp; t <= hi; t += stp) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)}</text>`;
  const h0 = new Date(d.bedDt); h0.setMinutes(0, 0, 0);
  for (let t = h0.getTime() + 36e5; t < d.bedDt.getTime() + end * 6e4; t += 36e5) { const hh = new Date(t); if (W < 480 && hh.getHours() % 2) continue; s += `<text x="${x((t - d.bedDt) / 6e4)}" y="${H - 5}" text-anchor="middle">${pad(hh.getHours())} h</text>`; }
  s += "</g>";
  if (opt.band && opt.band[0] != null) s += `<rect x="${m.l}" y="${y(opt.band[1])}" width="${iw}" height="${Math.max(0, y(opt.band[0]) - y(opt.band[1]))}" fill="var(--teal)" opacity=".12"/>`;
  const avg = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  const dd = pts.map((p, i) => (i && p[0] - pts[i - 1][0] > 20 ? "M" : i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join("");
  s += `<path d="${dd}" fill="none" stroke="${opt.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const mn = pts.reduce((a, p) => p[1] < a[1] ? p : a), mx = pts.reduce((a, p) => p[1] > a[1] ? p : a);
  const lab = (p, c, t, above) => { const tx = x(p[0]), anchor = tx > W - 60 ? "end" : tx < m.l + 40 ? "start" : "middle";
    return `<circle cx="${tx}" cy="${y(p[1])}" r="4" fill="${c}" stroke="var(--card)" stroke-width="2"/><text x="${tx}" y="${y(p[1]) + (above ? -9 : 17)}" text-anchor="${anchor}" font-size="11.5" font-weight="700" fill="var(--ink)">${t} ${p[1]}</text>`; };
  s += lab(mx, "var(--amber)", "max.", true) + lab(mn, "var(--accent)", "min.", false);
  s += `<line id="${el}Cur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="${el}Hit"/></svg>`;
  box.innerHTML = s;
  const svg = box.querySelector("svg"), cur = $(el + "Cur"), hit = $(el + "Hit");
  const stageAt = t => { const at = d.bedDt.getTime() + t * 6e4; const seg = (d.hyp || []).find(([st, mins]) => { const a = parseLocal(st).getTime(); return at >= a && at < a + mins * 6e4; }); return seg ? STAGES[seg[2]][0] : ""; };
  const mv = e => { const r = svg.getBoundingClientRect(), t = start + ((e.clientX - r.left) * W / r.width - m.l) / iw * (end - start);
    const p = pts.reduce((a, q) => Math.abs(q[0] - t) < Math.abs(a[0] - t) ? q : a);
    cur.setAttribute("x1", x(p[0])); cur.setAttribute("x2", x(p[0])); cur.setAttribute("opacity", .5);
    const st = stageAt(p[0]); showTip(e, `<b>${clock(new Date(d.bedDt.getTime() + p[0] * 6e4))}</b><br>${p[1]} ${opt.unit}${st ? ` · ${st}` : ""}`); };
  hit.addEventListener("pointermove", mv); hit.addEventListener("pointerdown", mv); hit.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
  return { avg, mn, mx };
}
function prevNights(d, key, n = 20) { const i = RC.days.indexOf(d); return RC.days.slice(Math.max(0, i - n), i).filter(x => x[key] && x[key].length > 2); }
const avgPts = p => p.reduce((a, q) => a + q[1], 0) / p.length;
function renderNightHr() {
  const d = RC.pick[RC.sel]; if (!d) return;
  const st = nightChart("rHr", d, "nhr", { title: "Fréquence cardiaque pendant la nuit", color: "var(--rose)", unit: "bpm" });
  if (st) {
    $("rHrInfo").textContent = `moy. ${nf(st.avg)} · min. ${st.mn[1]} · max. ${st.mx[1]} bpm`;
    const prev = prevNights(d, "nhr"), ref = prev.length >= 3 ? prev.reduce((a, x) => a + avgPts(x.nhr), 0) / prev.length : null;
    const minAt = clock(new Date(d.bedDt.getTime() + st.mn[0] * 6e4)), dv = ref != null ? st.avg - ref : null;
    $("rHrAns").innerHTML = `Cœur à <b>${nf(st.avg)} bpm</b> en moyenne cette nuit${dv == null ? "." : Math.abs(dv) < 1 ? `, comme tes ${prev.length} nuits précédentes : rien d'anormal.` : `, ${nf(Math.abs(dv), 1)} bpm ${dv < 0 ? "sous" : "au-dessus de"} tes ${prev.length} nuits précédentes (${nf(ref)}) : ${dv < 0 ? "le corps récupère bien." : dv >= 3 ? "signe de fatigue, de chaleur ou d'un effort tardif." : "léger écart, rien d'inquiétant."}`}`;
    $("rHrNote").innerHTML = `Point le plus bas : ${st.mn[1]} bpm à ${minAt}. Les bandes colorées suivent les phases de sommeil.`;
  } else {
    $("rHrInfo").textContent = ""; $("rHrAns").textContent = "";
    $("rHrNote").innerHTML = `${d.hrMin ? `Sur la journée : min. <b>${d.hrMin}</b> · moy. <b>${d.hrAvg ?? "–"}</b> · max. <b>${d.hrMax ?? "–"}</b> bpm. ` : ""}La courbe de nuit détaillée est disponible pour les 21 dernières nuits.`;
  }
}
function hrvNightAnswer(d) {
  if (!d.hrv) return "";
  const bh = baseline(d, x => x.hrv, 4), dv = bh ? d.hrv - bh.m : null;
  const zone = d.hrvLo ? (d.hrv < d.hrvLo ? `, sous ta zone habituelle (${d.hrvLo}–${d.hrvUp})` : d.hrv > d.hrvUp ? `, au-dessus de ta zone habituelle (${d.hrvLo}–${d.hrvUp})` : `, dans ta zone habituelle (${d.hrvLo}–${d.hrvUp})`) : "";
  return `VFC de <b>${d.hrv} ms</b> cette nuit${dv == null ? "" : Math.abs(dv) < 2 ? `, comme ta moyenne des 30 jours (${nf(bh.m)})` : `, ${nf(Math.abs(dv))} ms ${dv > 0 ? "au-dessus" : "en dessous"} de ta moyenne des 30 jours (${nf(bh.m)})`}${zone}.`;
}
function renderNightHrv() {
  const d = RC.pick[RC.sel]; if (!d) return;
  const st = nightChart("rHrv", d, "nhrv", { title: "VFC pendant la nuit", color: "var(--accent)", unit: "ms", band: [d.hrvLo, d.hrvUp] });
  if (st) {
    $("rHrvInfo").textContent = `moy. ${nf(st.avg)} · pic ${st.mx[1]} ms`;
    $("rHrvAns").innerHTML = hrvNightAnswer(d);
    $("rHrvNote").innerHTML = `${d.hrvLo ? `Zone verte : ta plage habituelle ${d.hrvLo}–${d.hrvUp} ms. ` : ""}Pointillé : moyenne de la courbe.`;
  } else {
    $("rHrvInfo").textContent = ""; $("rHrvAns").innerHTML = d.hrv ? hrvNightAnswer(d) : "";
    $("rHrvNote").innerHTML = `${d.hrv ? `VFC moyenne de la nuit : <b>${d.hrv} ms</b>${d.hrvLo ? ` (zone habituelle ${d.hrvLo}–${d.hrvUp})` : ""}. ` : "Pas de VFC pour cette nuit. "}La courbe détaillée est disponible pour les 21 dernières nuits.`;
  }
}

// ------------------------------------------------------------------ Courbes temporelles génériques
function tsChart(el, days, series, opt = {}) {
  const box = $(el);
  if (!days.length || !series.some(s => days.some(d => d[s.k] != null))) { box.innerHTML = `<div class="empty">Pas de données sur la période</div>`; return; }
  const W = Math.max(300, box.clientWidth), H = opt.h || Math.round(Math.min(300, Math.max(190, W * .42))), m = { l: 34, r: 10, t: 12, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = []; days.forEach(d => { series.forEach(s => d[s.k] != null && vals.push(d[s.k])); if (opt.band) [opt.band[0], opt.band[1]].forEach(k => d[k] != null && vals.push(d[k])); });
  let lo = Math.min(...vals), hi = Math.max(...vals); const padv = (hi - lo) * .12 || 5; lo = Math.max(0, lo - padv); hi += padv;
  const n = days.length, x = i => m.l + (n === 1 ? iw / 2 : i / (n - 1) * iw), y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  const stp = niceTicks(hi - lo, 4)[1] || 1, ticks = []; for (let t = Math.ceil(lo / stp) * stp; t <= hi; t += stp) ticks.push(t);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="axis">${ticks.map(t => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${nf(t)}</text>`).join("")}`;
  const step = Math.max(1, Math.ceil(n / (W < 480 ? 5 : 8)));
  days.forEach((d, i) => { if (i % step === 0) s += `<text x="${x(i)}" y="${H - 5}" text-anchor="middle">${d.dt.getDate()} ${MONTHS[d.dt.getMonth()]}</text>`; });
  s += "</g>";
  if (opt.band) { // zone (ex. min–max ou zone habituelle VFC)
    let top = "", bot = "";
    const segs = []; let cur = [];
    days.forEach((d, i) => { if (d[opt.band[0]] != null && d[opt.band[1]] != null) cur.push(i); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    segs.forEach(sg => { top = sg.map((i, j) => (j ? "L" : "M") + x(i).toFixed(1) + "," + y(days[i][opt.band[1]]).toFixed(1)).join(""); bot = sg.slice().reverse().map(i => "L" + x(i).toFixed(1) + "," + y(days[i][opt.band[0]]).toFixed(1)).join("");
      s += `<path d="${top}${bot}Z" fill="${opt.band[2]}" opacity="${opt.band[3] || .14}"/>`; });
  }
  series.forEach(se => {
    let d = "", pen = false;
    days.forEach((dd, i) => { const v = dd[se.k]; if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; });
    if (se.pts) { days.forEach((dd, i) => { if (dd[se.k] != null) s += `<circle cx="${x(i)}" cy="${y(dd[se.k])}" r="3.4" fill="${se.c}"/>`; }); return; }   // points seuls (nuits à signaler)
    s += `<path d="${d}" fill="none" stroke="${se.c}" stroke-width="${se.w || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (n <= 35 && !se.dash) days.forEach((dd, i) => { if (dd[se.k] != null) s += `<circle cx="${x(i)}" cy="${y(dd[se.k])}" r="2.4" fill="${se.c}"/>`; });
  });
  s += `<line id="${el}Cur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="${el}Hit"/></svg>`;
  box.innerHTML = s;
  const svg = box.querySelector("svg"), cur = $(el + "Cur"), hit = $(el + "Hit");
  const mv = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / iw * (n - 1)))), d = days[i];
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", .5);
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b>` + series.map(se => d[se.k] != null && !se.noTip ? `<br>${se.l} : ${nf(d[se.k], se.nd || 0)} ${se.u || ""}` : "").join("") + (opt.tipExtra ? opt.tipExtra(d) : "")); };
  hit.addEventListener("pointermove", mv); hit.addEventListener("pointerdown", mv); hit.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
}
const legend = items => items.map(([l, c, dash]) => `<span><i style="background:${dash ? `repeating-linear-gradient(90deg,${c} 0 3px,transparent 3px 6px)` : c}"></i>${l}</span>`).join("");
const avgOf = (arr, k) => { const v = arr.map(d => d[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function renderSleep(P) {
  const box = $("rSleep"), N = P.filter(d => d.sl);
  if (!N.length) { box.innerHTML = `<div class="empty">Pas de nuit sur la période</div>`; $("rSleepAns").textContent = ""; return; }
  const avgS = N.reduce((a, d) => a + d.sl, 0) / N.length / 60, short = N.filter(d => d.sl < 7 * 3600).length, gap = Math.round(480 - avgS);
  $("rSleepAns").innerHTML = `Tu dors <b>${hm(avgS)}</b> en moyenne sur la période, ${Math.abs(gap) < 10 ? "pile l'objectif de 8 h" : `${hmin(Math.abs(gap))} ${gap > 0 ? "sous" : "au-dessus de"} l'objectif de 8 h`} ; ${short ? `${short} nuit${short > 1 ? "s" : ""} sur ${N.length} sous 7 h.` : "aucune nuit sous 7 h."}`;
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(280, Math.max(190, W * .48))), m = { l: 30, r: 6, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const tot = d => ((d.deep || 0) + (d.light || 0) + (d.rem || 0) + (d.awake || 0)) / 3600;
  const max = Math.max(9, ...N.map(tot)), gw = iw / N.length, bw = Math.max(1.5, Math.min(18, gw * .7)), y = h => m.t + ih - h / max * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Durée et phases du sommeil"><g class="axis">`;
  for (let h = 0; h <= max; h += 2) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(h)}" y2="${y(h)}"/><text x="${m.l - 6}" y="${y(h) + 4}" text-anchor="end">${h} h</text>`;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(8)}" y2="${y(8)}" stroke="var(--teal)" stroke-dasharray="3 4" opacity=".6"/>`;
  const step = Math.max(1, Math.ceil(N.length / (W < 480 ? 5 : 8)));
  N.forEach((d, i) => { if (i % step === 0) s += `<text x="${m.l + gw * i + gw / 2}" y="${H - 5}" text-anchor="middle">${d.dt.getDate()} ${MONTHS[d.dt.getMonth()]}</text>`; });
  s += "</g>";
  N.forEach((d, i) => { let acc = 0; const cx = m.l + gw * i + gw / 2;
    ["deep", "light", "rem", "awake"].forEach(k => { const h = (d[k] || 0) / 3600; if (!h) return; s += `<rect x="${cx - bw / 2}" y="${y(acc + h)}" width="${bw}" height="${Math.max(0, y(acc) - y(acc + h))}" fill="${STAGES[k][1]}" data-i="${i}"/>`; acc += h; }); });
  box.innerHTML = s + "</svg>";
  box.querySelector("svg").addEventListener("pointermove", e => { const r = e.target.closest("rect[data-i]"); if (!r) return hideTip(); const d = N[+r.dataset.i];
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b><br>${hm(d.sl / 60)} de sommeil${d.score != null ? ` · score ${d.score}` : ""}<br>` + ["deep", "light", "rem", "awake"].map(k => `${STAGES[k][0]} ${hm((d[k] || 0) / 60)}`).join(" · ")); });
  box.querySelector("svg").addEventListener("pointerleave", hideTip);
}
function minsFrom18(dt) { let v = dt.getHours() * 60 + dt.getMinutes() - 18 * 60; if (v < 0) v += 1440; return v; }
function renderReg(P) {
  const box = $("rReg"), N = P.filter(d => d.bedDt && d.wakeDt);
  if (!N.length) { box.innerHTML = `<div class="empty">Pas de nuit sur la période</div>`; $("rRegAns").textContent = ""; return; }
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(280, Math.max(190, W * .48))), m = { l: 40, r: 6, t: 8, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const bs = N.map(d => minsFrom18(d.bedDt)), ws = N.map(d => minsFrom18(d.wakeDt));
  const tg0 = sleepTarget(RC.days), lo = Math.floor((Math.min(...bs, tg0 ? tg0.bed - SRI.tol : Infinity) - 30) / 60) * 60, hi = Math.ceil((Math.max(...ws, tg0 ? tg0.wake + SRI.tol : -Infinity) + 30) / 60) * 60, y = v => m.t + (v - lo) / (hi - lo) * ih;
  const gw = iw / N.length, bw = Math.max(2, Math.min(10, gw * .55));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures de coucher et de lever"><g class="axis">`;
  for (let v = lo; v <= hi; v += 120) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${pad((18 + v / 60) % 24)} h</text>`;
  const step = Math.max(1, Math.ceil(N.length / (W < 480 ? 5 : 8)));
  N.forEach((d, i) => { if (i % step === 0) s += `<text x="${m.l + gw * i + gw / 2}" y="${H - 5}" text-anchor="middle">${d.dt.getDate()} ${MONTHS[d.dt.getMonth()]}</text>`; });
  s += "</g>";
  const ab = bs.reduce((a, b) => a + b, 0) / bs.length, aw = ws.reduce((a, b) => a + b, 0) / ws.length, tg = sleepTarget(RC.days);
  // heures cibles (médiane de tes 30 dernières nuits) : bande de ± SRI.tol et pointillé ; sinon moyennes de la période
  if (tg) [[tg.bed, "var(--accent)"], [tg.wake, "var(--amber)"]].forEach(([v, c]) => { s += `<rect x="${m.l}" width="${iw}" y="${y(v - SRI.tol)}" height="${y(v + SRI.tol) - y(v - SRI.tol)}" fill="${c}" opacity=".12"/><line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="3 4" opacity=".8"/>`; });
  else s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(ab)}" y2="${y(ab)}" stroke="var(--accent)" stroke-dasharray="3 4" opacity=".7"/><line x1="${m.l}" x2="${W - m.r}" y1="${y(aw)}" y2="${y(aw)}" stroke="var(--amber)" stroke-dasharray="3 4" opacity=".7"/>`;
  N.forEach((d, i) => { const cx = m.l + gw * i + gw / 2; s += `<rect x="${cx - bw / 2}" y="${y(bs[i])}" width="${bw}" height="${Math.max(2, y(ws[i]) - y(bs[i]))}" rx="${bw / 2}" fill="url(#rg)" data-i="${i}"/>`; });
  s = s.replace("<g class=\"axis\">", `<defs><linearGradient id="rg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--deep)"/><stop offset="1" stop-color="var(--light)"/></linearGradient></defs><g class="axis">`);
  box.innerHTML = s + "</svg>";
  const fmt = v => `${pad(Math.floor((18 * 60 + v) / 60) % 24)}:${pad(Math.round(v % 60))}`;
  const sd = arr => { const a = arr.reduce((x, y) => x + y, 0) / arr.length; return Math.sqrt(arr.reduce((x, y) => x + (y - a) ** 2, 0) / arr.length); };
  const sdb = Math.round(sd(bs));
  $("rRegInfo").textContent = `coucher moyen ${fmt(ab)} · lever ${fmt(aw)} · ± ${sdb} min`;
  const all = RC.days.map((d, i) => sriAt(RC.days, i)), last = all.filter(Boolean).pop() || null, hist = last ? all.filter(t => t && (last.d.dt - t.d.dt) / 864e5 < 365).map(t => t.score) : [];
  if (tg) $("rRegInfo").textContent = `cible ${fmt(tg.bed)} → ${fmt(tg.wake)} · ± ${sdb} min`;
  $("rRegAns").innerHTML = sriAnswer(last, hist, tg) + (tg ? `<br>${targetLine(tg)}` : "");
  P.forEach(d => { const t = all[RC.days.indexOf(d)]; d._sri = t ? t.score : null; d._sLo = t ? SRI.good : null; d._sHi = t ? 100 : null; });
  tsChart("rSri", P, [{ k: "_sri", l: "régularité", c: "var(--accent)", w: 2, u: "/100" }], { band: ["_sLo", "_sHi", "var(--teal)", .14], h: 140 });
  box.querySelector("svg").addEventListener("pointermove", e => { const r = e.target.closest("rect[data-i]"); if (!r) return hideTip(); const d = N[+r.dataset.i];
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b><br>${clock(d.bedDt)} → ${clock(d.wakeDt)}`); });
  box.querySelector("svg").addEventListener("pointerleave", hideTip);
}
// FC au repos jour par jour (Garmin, sinon celle du sommeil), comparée à ta moyenne glissante des 30 jours d'avant :
// 3 bpm ou plus au-dessus = signe de fatigue, de maladie qui couve, de chaleur ou d'alcool ; en dessous = bonne récupération.
const RHR_HI = 3, RHR_BASE = 30;
const rhrOf = d => d.rhr ?? d.srhr ?? null;
function rhrBase(d, days = RC.days) { const i = days.indexOf(d), v = days.slice(Math.max(0, i - RHR_BASE), i).map(rhrOf).filter(x => x != null); return v.length >= 7 ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function renderRhr(P) {
  const box = $("rRhr"), N = P.filter(d => rhrOf(d) != null);
  if (!N.length) { box.innerHTML = `<div class="empty">Pas de mesure sur la période</div>`; $("rRhrAns").textContent = ""; $("rRhrInfo").textContent = ""; return; }
  const last = N[N.length - 1], v = rhrOf(last), bl = rhrBase(last), dv = bl != null ? v - bl : null, avg = avgOf(N.map(d => ({ x: rhrOf(d) })), "x");
  const when = last === RC.days[RC.days.length - 1] ? "ce matin" : `le ${last.dt.getDate()} ${MONTHS[last.dt.getMonth()]}`;
  $("rRhrAns").innerHTML = dv == null ? `Ton cœur au repos était à <b>${v} bpm</b> ${when}.`
    : `Ton cœur au repos était à <b>${v} bpm</b> ${when}, ${Math.abs(dv) < 1 ? "comme ta moyenne des 30 jours d'avant" : `${nf(Math.abs(dv))} bpm ${dv > 0 ? "au-dessus" : "en dessous"} de ta moyenne des 30 jours d'avant (${nf(bl)})`} : ${dv >= RHR_HI ? "signe de fatigue, de chaleur ou d'un virus qui couve, lève le pied si ça dure." : dv <= -1 ? "bonne récupération." : "rien d'anormal."}`;
  $("rRhrInfo").textContent = `moyenne ${nf(avg, 1)} bpm · min. ${Math.min(...N.map(rhrOf))} · max. ${Math.max(...N.map(rhrOf))}`;
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(260, Math.max(180, W * .36))), m = { l: 30, r: 6, t: 14, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = N.map(rhrOf), lo = Math.floor(Math.min(...vals) - 3), hi = Math.ceil(Math.max(...vals) + 2), y = x => m.t + ih - (x - lo) / (hi - lo) * ih;
  const gw = iw / N.length, bw = Math.max(1.5, Math.min(18, gw * .7));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fréquence cardiaque au repos"><g class="axis">`;
  const stp = Math.max(1, niceTicks(hi - lo, 4)[1] || 2); for (let t = Math.ceil(lo / stp) * stp; t <= hi; t += stp) svg += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  const step = Math.max(1, Math.ceil(N.length / (W < 480 ? 5 : 8)));
  N.forEach((d, i) => { if (i % step === 0) svg += `<text x="${m.l + gw * i + gw / 2}" y="${H - 5}" text-anchor="middle">${d.dt.getDate()} ${MONTHS[d.dt.getMonth()]}</text>`; });
  svg += "</g>";
  // barres : au-dessus de ta moyenne glissante de 3 bpm ou plus en ambre, sinon en vert ; ligne pointillée = moyenne glissante des 30 jours d'avant
  N.forEach((d, i) => { const r = rhrOf(d), b = rhrBase(d), cx = m.l + gw * i + gw / 2, c = b != null && r - b >= RHR_HI ? "var(--amber)" : "var(--teal)";
    svg += `<rect x="${cx - bw / 2}" y="${y(r)}" width="${bw}" height="${Math.max(1, y(lo) - y(r))}" rx="${Math.min(3, bw / 2)}" fill="${c}" opacity=".85" data-i="${i}"/>`; });
  let path = "", pen = false;
  N.forEach((d, i) => { const b = rhrBase(d); if (b == null) { pen = false; return; } path += (pen ? "L" : "M") + (m.l + gw * i + gw / 2).toFixed(1) + "," + y(b).toFixed(1); pen = true; });
  if (path) svg += `<path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 4" opacity=".55"/>`;
  box.innerHTML = svg + `</svg><div class="legend">${legend([["au repos", "var(--teal)"], ["3 bpm ou plus au-dessus de ta moyenne", "var(--amber)"], ["ta moyenne des 30 jours d'avant", "var(--ink)", 1]])}</div>`;
  box.querySelector("svg").addEventListener("pointermove", e => { const r = e.target.closest("rect[data-i]"); if (!r) return hideTip(); const d = N[+r.dataset.i], b = rhrBase(d);
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b><br>${rhrOf(d)} bpm au repos${b != null ? `<br>moyenne des 30 jours d'avant : ${nf(b, 1)}` : ""}`); });
  box.querySelector("svg").addEventListener("pointerleave", hideTip);
}

// Tendance de la VFC : moyenne sur 7 nuits (hrv7) comparée à la zone normale Garmin (hrvLo–hrvUp) et à il y a 4 semaines
const HRV_T = { back: 28, stablePct: 3 };
function hrvTrend(days) {
  const ok = d => d.hrv7 != null && d.hrvLo != null && d.hrvUp != null, i = days.map(ok).lastIndexOf(true);
  if (i < 0) return null;
  const last = days[i], v = last.hrv7, cut = new Date(last.dt); cut.setDate(cut.getDate() - HRV_T.back);
  const past = days.slice(0, i).filter(d => d.hrv7 != null && d.dt <= cut).pop() || null;
  let below = 0; for (let k = i; k >= 0 && ok(days[k]) && days[k].hrv7 < days[k].hrvLo; k--) below++;
  const zone = v < last.hrvLo ? "below" : v > last.hrvUp ? "above" : "in", pct = past ? (v - past.hrv7) / past.hrv7 * 100 : null;
  return { last, v, lo: last.hrvLo, up: last.hrvUp, zone, below, past, pct, trend: pct == null ? null : Math.abs(pct) < HRV_T.stablePct ? "stable" : pct > 0 ? "up" : "down" };
}
function hrvTrendAnswer(t) {
  if (!t) return "Pas encore de moyenne de VFC sur 7 nuits.";
  const tr = t.trend == null ? "" : t.trend === "stable" ? `, stable sur 4 semaines (${t.past.hrv7} → ${t.v})` : `, en ${t.trend === "up" ? "hausse" : "baisse"} de ${Math.abs(t.v - t.past.hrv7)} ms sur 4 semaines (${t.past.hrv7} → ${t.v})`;
  const z = `${t.lo}–${t.up} ms`;
  const zone = t.zone === "below" ? `, sous ta zone normale (${z}) depuis ${t.below} jour${t.below > 1 ? "s" : ""} : une fatigue s'installe, allège tant qu'elle n'y est pas revenue.`
    : t.zone === "above" ? `, au-dessus de ta zone normale (${z}) : souvent bon signe, mais si tu te sens vidé, c'est aussi un signe de fatigue.`
    : `, dans ta zone normale (${z}) : pas de fatigue qui dure.`;
  return `Ta VFC moyenne sur 7 nuits est de <b>${t.v} ms</b>${tr}${zone}`;
}
function renderHrvTrend(P) {
  const t = hrvTrend(RC.days);
  $("rHrvTAns").innerHTML = hrvTrendAnswer(t);
  const N = P.filter(d => d.hrv != null || d.hrv7 != null);
  $("rHrvTInfo").textContent = t ? `zone normale ${t.lo}–${t.up} ms` : "";
  tsChart("rHrvT", N, [{ k: "hrv", l: "nuit", c: "var(--muted)", w: 1, u: "ms" }, { k: "hrv7", l: "moyenne 7 nuits", c: "var(--accent)", w: 2.6, u: "ms" }],
    { band: ["hrvLo", "hrvUp", "var(--teal)", .16], tipExtra: d => d.hrvLo != null ? `<br>zone normale : ${d.hrvLo}–${d.hrvUp}` : "" });
}

// Respiration de la nuit (à la Whoop) : moyenne de la nuit (rx au dixième, sinon resp de Garmin, arrondie à l'unité),
// comparée à ta normale = moyenne des 30 jours d'avant (14 nuits au moins). +1 /min ou plus = au-dessus ;
// alerte si c'est 2 nuits de suite, ou une nuit avec le cœur au repos (+3 bpm, RHR_HI) ou la VFC sous sa zone normale.
const RESP = { base: 30, min: 14, hi: 1, lo: -1, streak: 2 };
const respOf = d => d.rx ?? d.resp ?? null;
const RESP_WHY = "ton corps est sous stress (soirée arrosée, grosse fatigue ou virus qui couve). C'est ce signal que Whoop surveille pour repérer une infection avant les premiers symptômes.";
function respBase(days, i) {
  const v = days.slice(Math.max(0, i - RESP.base), i).map(respOf).filter(x => x != null);
  if (v.length < RESP.min) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), n: v.length };
}
function respAt(days, i) {
  const d = days[i], v = d ? respOf(d) : null;
  if (v == null) return null;
  const b = respBase(days, i), dv = b ? v - b.m : null, up = dv != null && dv >= RESP.hi;
  let streak = 0;
  for (let k = i; k >= 0; k--) { const x = respOf(days[k]), bk = respBase(days, k); if (x == null || !bk || x - bk.m < RESP.hi) break; streak++; }
  const signals = [], rb = rhrBase(d, days), r = rhrOf(d);
  if (up && rb != null && r != null && r - rb >= RHR_HI) signals.push(`le cœur au repos ${nf(r - rb)} bpm plus haut`);
  if (up && d.hrv != null && d.hrvLo != null && d.hrv < d.hrvLo) signals.push("la VFC sous sa zone normale");
  const level = dv == null ? "nobase" : up ? (streak >= RESP.streak || signals.length ? "alert" : "watch") : dv <= RESP.lo ? "low" : "ok";
  return { d, v, fine: d.rx != null, base: b, dv, streak, signals, level };
}
function respTrend(days) {
  let i = days.length - 1; while (i >= 0 && respOf(days[i]) == null) i--;
  return i < 0 ? null : respAt(days, i);
}
function respAnswer(t, latest) {
  if (!t) return "Pas encore de mesure de la respiration pendant le sommeil.";
  const f = x => nf(x, t.fine ? 1 : 0), dm = x => `${x.getDate()} ${MONTHS[x.getMonth()]}`, eve = new Date(t.d.dt.getTime() - 864e5),
    when = latest ? "cette nuit" : `la nuit du ${eve.getMonth() === t.d.dt.getMonth() ? eve.getDate() : dm(eve)} au ${dm(t.d.dt)}`;
  const head = `Tu as respiré à <b>${f(t.v)} /min</b> ${when}`;
  if (t.level === "nobase") return `${head}. Il faut ${RESP.min} nuits mesurées pour connaître ta normale.`;
  const nm = nf(t.base.m, 1), gap = nf(Math.abs(t.dv), 1);
  if (t.level === "alert") return `Ta respiration est au-dessus de ta normale ${t.streak >= RESP.streak ? `depuis ${t.streak} nuits` : when} (<b>${f(t.v)} /min</b> contre ${nm})${t.signals.length ? `, avec ${t.signals.join(" et ")}` : ""} : ${RESP_WHY} Allège l'entraînement aujourd'hui ; si ça continue ou si tu te sens patraque, repos complet.`;
  if (t.level === "watch") return `${head}, ${gap} au-dessus de ta normale (${nm}) : à surveiller. Une grosse séance, l'alcool, un repas tardif ou la chaleur la font monter, mais c'est aussi un des premiers signes d'un virus : si ça se répète la nuit prochaine, lève le pied.`;
  if (t.level === "low") return `${head}, ${gap} en dessous de ta normale (${nm}) : rien d'inquiétant, souvent une nuit très calme.`;
  return `${head}, dans ta normale (${nm} /min, moyenne de tes ${RESP.base} jours d'avant) : rien à signaler.`;
}
function renderResp(P) {
  const t = respTrend(RC.days);
  $("rRespAns").innerHTML = respAnswer(t, t && t.d === RC.days[RC.days.length - 1]);
  const N = P.filter(d => respOf(d) != null);
  N.forEach(d => { const i = RC.days.indexOf(d), a = respAt(RC.days, i), b = a && a.base; d._rv = respOf(d); d._rb = b ? +b.m.toFixed(1) : null;
    d._rlo = b ? b.m - RESP.hi : null; d._rhi = b ? b.m + RESP.hi : null; d._ru = a && (a.level === "watch" || a.level === "alert") ? d._rv : null; });
  const fine = N.filter(d => d.rx != null).length;
  $("rRespInfo").textContent = t && t.base ? `normale ${nf(t.base.m, 1)} /min` : "";
  tsChart("rResp", N, [{ k: "_rv", l: "nuit", c: "var(--accent)", w: 2, u: "/min", nd: 1 }, { k: "_rb", l: "ta normale", c: "var(--ink)", w: 1.2, dash: "3 4", u: "/min", nd: 1 }, { k: "_ru", c: "var(--amber)", pts: 1, noTip: 1 }],
    { band: ["_rlo", "_rhi", "var(--teal)", .16], h: Math.round(Math.min(240, Math.max(170, ($("rResp").clientWidth || 300) * .34))) });
  $("rRespNote").innerHTML = `Trait orange : respiration moyenne de chaque nuit ; pointillé : ta normale (moyenne des ${RESP.base} jours d'avant) ; bande verte : ta normale à ±${RESP.hi} /min ; points ambre : nuits au-dessus. Elle bouge très peu d'une nuit à l'autre : une hausse nette qui dure, surtout avec le cœur au repos plus haut, annonce souvent un virus.${!N.length || fine === N.length ? "" : fine ? " Les nuits les plus anciennes sont arrondies à l'unité par Garmin." : " Garmin arrondit ces valeurs à l'unité : le dixième arrive au fil des prochaines mises à jour."}`;
}

// Régularité du sommeil (à la Whoop) : indice de régularité du sommeil (SRI). Pour deux nuits qui se suivent, part des minutes
// de la journée où tu es dans le même état (endormi ou éveillé) à 24 h d'écart, d'après le coucher et le lever Garmin ;
// moyenne des paires des 7 derniers jours (4 au moins), ramenée de −100 à 100 (100 = mêmes heures chaque soir, 0 = au hasard).
// Repères (UK Biobank) : les dormeurs les plus réguliers sont au-dessus de 87, les plus irréguliers sous 72.
const SRI = { days: 7, min: 4, good: 85, mid: 72, tgt: 30, tgtMin: 7, tol: 30 };
function pairMismatch(a, b) { // minutes de la journée où l'état diffère entre deux nuits, en minutes depuis 18 h la veille
  const ab = minsFrom18(a.bedDt), aw = ab + (a.wakeDt - a.bedDt) / 6e4, bb = minsFrom18(b.bedDt), bw = bb + (b.wakeDt - b.bedDt) / 6e4;
  return Math.min(1440, (aw - ab) + (bw - bb) - 2 * Math.max(0, Math.min(aw, bw) - Math.max(ab, bb)));
}
function sriAt(days, i) {
  const d = days[i]; if (!d || !d.bedDt || !d.wakeDt) return null;
  const pairs = [];
  for (let k = i; k > 0; k--) {
    const b = days[k], a = days[k - 1];
    if ((d.dt - b.dt) / 864e5 >= SRI.days) break;
    if (!a.bedDt || !a.wakeDt || !b.bedDt || !b.wakeDt || Math.round((b.dt - a.dt) / 864e5) !== 1) continue;
    pairs.push({ a, b, mis: pairMismatch(a, b) });
  }
  if (pairs.length < SRI.min) return null;
  const mis = pairs.reduce((s, p) => s + p.mis, 0) / pairs.length;
  // nuit la plus éloignée de tes heures médianes de la semaine
  const nights = [...new Set(pairs.flatMap(p => [p.a, p.b]))], mb = median(nights.map(x => minsFrom18(x.bedDt))), mw = median(nights.map(x => minsFrom18(x.wakeDt)));
  const off = x => Math.abs(minsFrom18(x.bedDt) - mb) + Math.abs(minsFrom18(x.wakeDt) - mw), worst = nights.reduce((w, x) => off(x) > off(w) ? x : w);
  return { d, score: Math.round(200 * (1 - mis / 1440) - 100), mis, pairs, mb, mw, worst, off: off(worst) };
}
// Heures cibles pour être plus régulier : médiane de tes 30 dernières nuits (une soirée ne la déplace pas), arrondie à 5 min,
// à tenir à ± SRI.tol près, week-end compris ; et combien des 7 dernières nuits y étaient.
function sleepTarget(days) {
  const N = days.filter(d => d.bedDt && d.wakeDt), last = N[N.length - 1];
  if (!last) return null;
  const R = N.filter(d => (last.dt - d.dt) / 864e5 < SRI.tgt);
  if (R.length < SRI.tgtMin) return null;
  const r5 = v => Math.round(v / 5) * 5, bed = r5(median(R.map(d => minsFrom18(d.bedDt)))), wake = r5(median(R.map(d => minsFrom18(d.wakeDt))));
  const wk = R.filter(d => (last.dt - d.dt) / 864e5 < SRI.days), ok = wk.filter(d => Math.abs(minsFrom18(d.bedDt) - bed) <= SRI.tol && Math.abs(minsFrom18(d.wakeDt) - wake) <= SRI.tol);
  return { bed, wake, n: R.length, week: wk.length, ok: ok.length };
}
function targetLine(t) {
  const at = v => `${pad(Math.floor((18 * 60 + v) / 60) % 24)}:${pad(Math.round(v % 60))}`;
  return `Pour plus de régularité : couche-toi vers <b>${at(t.bed)}</b> et lève-toi vers <b>${at(t.wake)}</b>, à ${SRI.tol} min près, week-end compris (tes heures habituelles des ${SRI.tgt} derniers jours, ${hm(t.wake - t.bed)} au lit). ${t.ok === t.week ? `Les ${t.week} dernières nuits y étaient toutes.` : !t.ok ? `Aucune des ${t.week} dernières nuits n'y était (coucher et lever à ${SRI.tol} min près).` : `${t.ok} des ${t.week} dernières nuits y étaient (coucher et lever à ${SRI.tol} min près).`}`;
}
function sriAnswer(t, hist, tg) {
  if (!t) return `Il faut ${SRI.min} paires de nuits qui se suivent sur ${SRI.days} jours pour mesurer ta régularité.`;
  const lvl = t.score >= SRI.good ? "régulier" : t.score >= SRI.mid ? "assez régulier" : "irrégulier";
  const med = hist.length >= 30 ? median(hist) : null, gap = med != null ? t.score - med : null;
  const rep = med == null ? "" : Math.abs(gap) < 3 ? `, comme d'habitude (médiane de l'année ${nf(med)})` : `, ${nf(Math.abs(gap))} points ${gap > 0 ? "au-dessus" : "en dessous"} de ta médiane de l'année (${nf(med)})`;
  const w = t.worst, at = v => `${pad(Math.floor((18 * 60 + v) / 60) % 24)}:${pad(Math.round(v % 60))}`, dm = x => `${x.getDate()} ${MONTHS[x.getMonth()]}`, eve = new Date(w.dt.getTime() - 864e5);
  const why = t.off >= 45 ? ` Le plus gros écart : la nuit du ${eve.getMonth() === w.dt.getMonth() ? eve.getDate() : dm(eve)} au ${dm(w.dt)}, de ${clock(w.bedDt)} à ${clock(w.wakeDt)} (d'habitude ${at(tg ? tg.bed : t.mb)} → ${at(tg ? tg.wake : t.mw)}).` : "";
  return `Ta régularité est de <b>${t.score}/100</b> sur ${SRI.days} jours, ${lvl} (${SRI.good} et plus : régulier)${rep}.${t.score < SRI.good ? why : ""}${t.score < SRI.mid ? " Des heures fixes, même le week-end, aident autant la récupération que la durée." : ""}`;
}

// Moniteur santé (à la Whoop) : chaque mesure de la nuit comparée à ta normale. Le sens qui compte : VFC basse, cœur au repos,
// respiration ou stress du sommeil hauts, oxygène bas. Un signal seul arrive souvent ; deux à la fois = le corps encaisse quelque chose.
const HM = { base: 30, min: 14, spo2: 2, stressMin: 8, stressSd: 1.5 };
function baseOf(days, i, f) {
  const v = days.slice(Math.max(0, i - HM.base), i).map(f).filter(x => x != null);
  if (v.length < HM.min) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) };
}
function healthAt(days, i) {
  const d = days[i]; if (!d) return null;
  const rows = [], add = (k, l, u, v, lo, hi, bad, nd = 0) => rows.push({ k, l, u, v, lo, hi, nd, st: v == null ? "none" : lo == null && hi == null ? "nobase" : bad ? "bad" : (lo != null && v < lo) || (hi != null && v > hi) ? "off" : "ok" });
  add("hrv", "VFC", "ms", d.hrv ?? null, d.hrvLo ?? null, d.hrvUp ?? null, d.hrv != null && d.hrvLo != null && d.hrv < d.hrvLo);
  const rb = rhrBase(d, days), r = rhrOf(d);
  add("rhr", "Cœur au repos", "bpm", r, rb != null ? rb - RHR_HI : null, rb != null ? rb + RHR_HI : null, r != null && rb != null && r - rb >= RHR_HI);
  const ra = respOf(d) != null ? respAt(days, i) : null, b = ra && ra.base;
  add("resp", "Respiration", "/min", respOf(d), b ? b.m - RESP.hi : null, b ? b.m + RESP.hi : null, !!ra && (ra.level === "watch" || ra.level === "alert"), d.rx != null ? 1 : 0);
  const sb = baseOf(days, i, x => x.spo2 ?? null);
  add("spo2", "Oxygène du sang", "%", d.spo2 ?? null, sb ? sb.m - HM.spo2 : null, null, d.spo2 != null && sb != null && sb.m - d.spo2 >= HM.spo2);
  const tb = baseOf(days, i, x => x.sstress ?? null), thi = tb ? tb.m + Math.max(HM.stressMin, HM.stressSd * tb.sd) : null;
  add("sstress", "Stress du sommeil", "", d.sstress ?? null, null, thi, d.sstress != null && thi != null && d.sstress > thi);
  return { d, rows, bad: rows.filter(x => x.st === "bad"), n: rows.filter(x => x.st !== "none").length };
}
const HM_BAD = { hrv: "VFC sous ta zone normale", rhr: "cœur au repos plus haut", resp: "respiration plus rapide", spo2: "oxygène plus bas", sstress: "stress du sommeil plus haut" };
function healthAnswer(h, latest) {
  if (!h || !h.n) return "Pas de mesure de santé pour cette nuit.";
  const when = latest ? "cette nuit" : "cette nuit-là", all = h.rows.filter(x => x.st !== "none").length;
  if (!h.bad.length) return `<b>${h.rows.filter(x => x.st === "ok" || x.st === "off").length} mesures sur ${all}</b> dans ta normale ${when}${h.rows.some(x => x.st === "nobase") ? " (les autres n'ont pas encore assez d'historique)" : ""} : rien à signaler.`;
  const l = h.bad.map(x => HM_BAD[x.k]), list = l.length > 1 ? `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}` : l[0];
  return h.bad.length === 1 ? `<b>1 signal</b> hors de ta normale ${when} : ${list}. Seul, ça arrive (grosse séance, repas tardif, alcool, chaleur) : à surveiller s'il revient demain.`
    : `<b>${h.bad.length} signaux</b> hors de ta normale ${when} : ${list}. Ton corps encaisse quelque chose (fatigue, alcool ou virus qui couve) : allège l'entraînement aujourd'hui ; si tu te sens patraque, repos.`;
}
function renderHealth() {
  const n = RC.pick[RC.sel], h = n ? healthAt(RC.days, RC.days.indexOf(n)) : null;
  $("rHmAns").innerHTML = healthAnswer(h, n && isLatest(n));
  if (!h || !h.n) { $("rHm").innerHTML = ""; return; }
  const f = (v, nd) => nf(v, nd), u = x => x.u ? " " + x.u : "", range = x => x.lo != null && x.hi != null ? `${f(x.lo, x.nd)}–${f(x.hi, x.nd)}${u(x)}` : x.lo != null ? `${f(x.lo, x.nd)}${u(x)} et plus` : `${f(x.hi, x.nd)}${u(x)} au plus`;
  const word = { ok: "dans ta normale", off: "hors de ta normale, dans le bon sens", bad: "hors de ta normale", nobase: "pas encore de normale" };
  $("rHm").innerHTML = h.rows.filter(x => x.st !== "none").map(x => {
    // piste : normale en vert, ta valeur en point (ambre si signal) ; sans borne basse, la piste part de 0, sans borne haute elle va à 100
    const vs = [x.lo, x.hi, x.v].filter(v => v != null), a = x.lo == null ? 0 : Math.min(...vs), z = x.hi == null ? 100 : Math.max(...vs), pd = (z - a) * .2 || 1, p = v => ((v - (a - pd)) / (z - a + 2 * pd) * 100).toFixed(1);
    const band = x.st === "nobase" ? "" : `<div class="nb" style="left:${x.lo != null ? p(x.lo) : 0}%;right:${x.hi != null ? 100 - p(x.hi) : 0}%"></div>`;
    return `<div class="row"><div>${x.l}<small>${x.st === "nobase" ? word.nobase : `normale ${range(x)}`}</small></div>
      <div class="trk">${band}<i style="left:${p(x.v)}%;background:${x.st === "bad" ? "var(--amber)" : "var(--ink)"}"></i></div>
      <div class="d" style="color:${x.st === "bad" ? "var(--amber)" : "var(--ink)"}">${f(x.v, x.nd)}<small>${x.u ? " " + x.u : ""}</small><small class="w">${word[x.st]}</small></div></div>`;
  }).join("");
}

// ------------------------------------------------------------------ Comparaisons
const CMP = { min: 6, t: 2, pts: 2, mins: 15, max: 5, loadTss: 100, lateBedMin: 45, shortNightH: 6.5, stress: 35 };
const median = a => { const v = a.slice().sort((x, y) => x - y), k = v.length >> 1; return v.length ? (v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2) : null; };
function prevDay(d) { const i = RC.days.indexOf(d), p = i > 0 ? RC.days[i - 1] : null, t = new Date(d.dt); t.setDate(t.getDate() - 1); return p && p.d === `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` ? p : null; }
// écart moyen entre deux groupes de nuits et sa netteté (t de Welch) ; null si trop peu de valeurs
function welch(yes, no, f) {
  const a = yes.map(f).filter(x => x != null), b = no.map(f).filter(x => x != null); if (a.length < 3 || b.length < 3) return null;
  const m = v => v.reduce((x, y) => x + y, 0) / v.length, va = v => { const mm = m(v); return v.reduce((x, y) => x + (y - mm) ** 2, 0) / (v.length - 1); };
  const d = m(a) - m(b), se = Math.sqrt(va(a) / a.length + va(b) / b.length);
  return { d, t: se ? d / se : 0 };
}
function renderCmp() {
  const N = RC.nights.filter(d => d.score != null || d.sl), isHard = a => window.Plan && Plan.hardRide ? Plan.hardRide(a) : (a.te || 0) >= 3.5;
  const load = d => dayActivities(d).reduce((s, a) => s + (window.Charge ? Charge.tssOf(a) : 0), 0);
  // coucher habituel : médiane des 30 nuits d'avant (en minutes depuis 18 h)
  const bedBase = d => { const i = RC.nights.indexOf(d), v = RC.nights.slice(Math.max(0, i - 30), i).filter(x => x.bedDt).map(x => minsFrom18(x.bedDt)); return v.length >= 10 ? median(v) : null; };
  const F = [
    ["Grosse journée la veille", `charge ≥ ${CMP.loadTss}`, d => load(d) >= CMP.loadTss],
    ["Séance intense la veille", "intervalles, course rapide", d => dayActivities(d).some(isHard)],
    ["Effort tardif", "fini moins de 3 h avant le coucher", d => d.bedDt ? nightFacts(d).late : null],
    ["Journée de repos la veille", "aucune activité", d => nightFacts(d).acts.length === 0],
    ["Muscu la veille", "", d => dayActivities(d).some(a => /strength/.test(a.t))],
    ["Coucher tardif pour toi", `${CMP.lateBedMin} min ou plus après ton heure habituelle`, d => { const b = d.bedDt && bedBase(d); return b == null ? null : minsFrom18(d.bedDt) - b >= CMP.lateBedMin; }],
    ["Nuit courte la veille", `moins de ${nf(CMP.shortNightH, 1)} h`, d => { const p = prevDay(d); return p && p.sl ? p.sl / 3600 < CMP.shortNightH : null; }],
    ["Journée stressante", `stress moyen Garmin ≥ ${CMP.stress}`, d => { const p = prevDay(d); return p && p.stress != null && p.stress > 0 ? p.stress >= CMP.stress : null; }],
    ["Nuit chaude", "min. ≥ 15 °C", d => d.wx?.tMin != null ? d.wx.tMin >= 15 : null],
    ["Nuit de week-end", "vendredi et samedi soir", d => { const w = (d.dt.getDay() + 6) % 7; return w === 5 || w === 6; }],
  ];
  const rows = [];
  F.forEach(([label, sub, f]) => {
    const yes = [], no = [];
    N.forEach(d => { const v = f(d); if (v === true) yes.push(d); else if (v === false) no.push(d); });
    if (yes.length < CMP.min || no.length < CMP.min) return;
    const S_ = welch(yes, no, d => d.score), M = welch(yes, no, d => d.sl ? d.sl / 60 : null), Hv = welch(yes, no, d => d.hrv);
    const net = (S_ && Math.abs(S_.t) >= CMP.t && Math.abs(S_.d) >= CMP.pts) || (M && Math.abs(M.t) >= CMP.t && Math.abs(M.d) >= CMP.mins);
    if (!net) return;
    rows.push({ label, sub, n: yes.length, ds: S_ ? S_.d : 0, dm: M ? M.d : 0, dh: Hv ? Hv.d : null, w: Math.max(S_ ? Math.abs(S_.d) / 5 : 0, M ? Math.abs(M.d) / 20 : 0) });
  });
  rows.sort((a, b) => b.w - a.w); rows.splice(CMP.max);
  if (!rows.length) { $("rCmpAns").textContent = N.length < 30 ? "Pas encore assez de nuits pour voir ce qui joue sur ton sommeil." : "Rien ne ressort nettement : tes nuits varient sans lien clair avec ce qui est mesuré ici."; $("rCmp").innerHTML = ""; return; }
  const top = rows[0], eff = r => Math.abs(r.ds) >= CMP.pts ? `${r.ds >= 0 ? "+" : "−"}${nf(Math.abs(r.ds), 1)} pts de score` : `${r.dm >= 0 ? "+" : "−"}${nf(Math.abs(r.dm))} min de sommeil`;
  $("rCmpAns").innerHTML = `Ce qui joue le plus sur tes nuits : <b>${top.label.toLowerCase()}</b> (${eff(top)} en moyenne).`;
  const sc = 12;
  $("rCmp").innerHTML = rows.map(r => { const w = Math.min(50, Math.abs(r.ds) / sc * 50), pos = r.ds >= 0;
    return `<div class="row"><div>${r.label}<small>${r.sub ? r.sub + " · " : ""}${r.n} nuits</small></div>
      <div class="bar"><div style="${pos ? `left:50%;width:${w}%` : `right:50%;width:${w}%`};background:${pos ? "var(--teal)" : "var(--rose)"}"></div><span class="mid"></span></div>
      <div class="d">${r.ds >= 0 ? "+" : "−"}${nf(Math.abs(r.ds), 1)} pts<small><br>${r.dm >= 0 ? "+" : "−"}${nf(Math.abs(r.dm))} min${r.dh != null ? ` · VFC ${r.dh >= 0 ? "+" : "−"}${nf(Math.abs(r.dh))}` : ""}</small></div></div>`; }).join("");
}

// ------------------------------------------------------------------ Anecdotes
function renderFacts() {
  const N = RC.nights, F = [], add = (n, t, sub, w = 1, day) => F.push({ n, t, sub, w, day: day && day.d });
  if (!N.length) { $("rFacts").innerHTML = ""; return; }
  const tot = N.reduce((s, d) => s + d.sl, 0);
  add(`${nf(tot / 86400, 1)} j`, "dormis depuis janvier", `${nf(tot / 3600)} heures au total`, 3);
  add(hm(avgOf(N, "sl") / 60), "de sommeil par nuit en moyenne", `sur ${N.length} nuits`, 2);
  const best = maxBy(N.filter(d => d.score != null), d => d.score);
  if (best) add(best.score, "ta meilleure note de sommeil", best.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), 3, best);
  const longest = maxBy(N, d => d.sl); add(hm(longest.sl / 60), "ta plus longue nuit", longest.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), 2, longest);
  const bsW = N.filter(d => d.bedDt && [0, 1, 2, 3, 6].includes(d.bedDt.getDay())).map(d => minsFrom18(d.bedDt)), bsE = N.filter(d => d.bedDt && [5, 6].includes(new Date(d.bedDt.getTime() - 6 * 36e5).getDay())).map(d => minsFrom18(d.bedDt));
  if (bsW.length > 3 && bsE.length > 3) { const diff = bsE.reduce((a, b) => a + b, 0) / bsE.length - bsW.reduce((a, b) => a + b, 0) / bsW.length; add(`${diff >= 0 ? "+" : "−"}${nf(Math.abs(diff))} min`, diff >= 0 ? "plus tard au lit le week-end" : "plus tôt au lit le week-end", "vendredi et samedi soir vs semaine", 2); }
  const hv = maxBy(N.filter(d => d.hrv), d => d.hrv); if (hv) add(`${hv.hrv} ms`, "ta VFC nocturne record", hv.dt.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }), 2, hv);
  const lo = RC.days.filter(d => d.hrMin).reduce((a, d) => !a || d.hrMin < a.hrMin ? d : a, null); if (lo) add(`${lo.hrMin} bpm`, "ton cœur le plus lent de l'année", lo.dt.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }), 3, lo);
  const beats = N.reduce((s, d) => s + (d.srhr || d.rhr || 0) * d.sl / 60, 0); if (beats) add(`${nf(beats / 1e6, 1)} M`, "battements de cœur pendant ton sommeil", "à peu près, au rythme du repos", 1);
  let run = 0, br = 0; N.forEach(d => { run = d.sl >= 7 * 3600 ? run + 1 : 0; br = Math.max(br, run); }); if (br > 1) add(br, "nuits de 7 h ou plus d'affilée", "ta meilleure série", 2);
  const early = minBy(N.filter(d => d.wakeDt), d => minsFrom18(d.wakeDt)); if (early) add(clock(early.wakeDt), "ton réveil le plus matinal", early.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), 2, early);
  const awake = N.reduce((s, d) => s + (d.awake || 0), 0); add(hm(awake / 60), "passées éveillé au lit", "réveils nocturnes cumulés", 1);
  const big = N.filter(d => nightFacts(d).km >= 200); if (big.length) add(hm(avgOf(big, "sl") / 60), "de sommeil après tes sorties de 200 km et plus", `${big.length} nuits${avgOf(big, "score") != null ? ` · score moyen ${nf(avgOf(big, "score"))}` : ""}`, 3);
  let seed = RC.factSeed * 9301 + 777; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const pool = F.map(f => ({ f, k: Math.pow(rnd(), 1 / f.w) })).sort((a, b) => b.k - a.k).slice(0, 6).map(x => x.f);
  $("rFacts").innerHTML = pool.map(f => { const i = f.day ? RC.pick.findIndex(p => p.d === f.day) : -1;
    return i >= 0 ? `<button class="fact factlink" data-i="${i}"><div class="n">${esc(String(f.n))}</div><div class="t">${esc(f.t)}<small>${esc(f.sub || "")} · voir la nuit →</small></div></button>`
      : `<div class="fact"><div class="n">${esc(String(f.n))}</div><div class="t">${esc(f.t)}<small>${esc(f.sub || "")}</small></div></div>`; }).join("");
  $("rFacts").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { selectDay(+b.dataset.i); $("rMorning").scrollIntoView({ behavior: "smooth", block: "start" }); });
}
function minBy(arr, f) { let b = null, bv = Infinity; for (const a of arr) { const v = f(a); if (v < bv) { bv = v; b = a; } } return b; }

// ------------------------------------------------------------------ Accès pour l'onglet Plan
async function ensure(target, after) {
  if (!RC.env) RC.env = await fetchEnv();
  if (!RC.env) { $(target).innerHTML = `<div class="card empty"><b>Pas encore de données</b>Le plan a besoin des données de l'onglet Récup : lance « Mise à jour Garmin » dans l'onglet Actions de GitHub.</div>`; return false; }
  if (!RC.data) { RC.data = RC.env.plain; prep(); }
  return true;
}
window.Recup = { ensure, recoScore, scoreColor, _: { REC, RESP, RESP_WHY, SRI, HM, sriAt, sriAnswer, sleepTarget, targetLine, healthAt, healthAnswer, recovLeft, hrvTrend, hrvTrendAnswer, nightAnswer, respAt, respTrend, respAnswer }, get data() { return RC.data; }, get days() { return RC.days; }, open: openRecup, hm, clock };

// ------------------------------------------------------------------ Démarrage
document.addEventListener("velo:loaded", () => { if (Nav.curTab() !== "recup") return; $("title").textContent = "Ma récupération"; if (RC.data) renderRecup(); });
let rT2, lastW2 = innerWidth;
addEventListener("resize", () => { if (innerWidth === lastW2) return; lastW2 = innerWidth; clearTimeout(rT2); rT2 = setTimeout(() => { if (Nav.curTab() === "recup" && RC.data) renderRecup(); }, 150); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Nav.curTab() === "recup") openRecup(true); });
setInterval(() => { if (document.visibilityState === "visible" && Nav.curTab() === "recup") openRecup(true); }, 5 * 60 * 1000);
Nav.apply();
})();
