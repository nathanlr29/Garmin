"use strict";
// Onglet « Récup » : sommeil, VFC, fréquence cardiaque, Body Battery, lune et facteurs externes.
// Les données (data/recovery.enc) sont chiffrées ; le code est demandé une fois par appareil.
(() => {
const RC = { env: null, data: null, days: [], nights: [], period: 30, night: -1, factSeed: 0, sig: null };
const CODE_KEY = "recupCode";
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const hm = mins => `${Math.floor(mins / 60)} h ${pad(Math.round(mins % 60))}`;
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
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-label="${m.name}"><circle cx="${c}" cy="${c}" r="${r}" fill="#2a3158"/>${lit}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)"/></svg>`;
}
function dstNight(d) { // nuit du changement d'heure (dernier dimanche de mars / octobre)
  const m = d.getMonth(); if ((m !== 2 && m !== 9) || d.getDay() !== 0) return null;
  return d.getDate() > 24 ? (m === 2 ? "Passage à l'heure d'été (1 h de sommeil en moins)" : "Passage à l'heure d'hiver (1 h de plus)") : null;
}

// ------------------------------------------------------------------ Données chiffrées
async function decryptEnv(env, code) {
  if (env.plain) return env.plain;
  const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b(env.salt), iterations: env.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b(env.iv) }, key, b(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function fetchEnv() {  // accès libre : recovery.json ; ancien format chiffré en secours
  try { const r = await fetch("data/recovery.json?v=" + Date.now(), { cache: "no-store" }); if (r.ok) { const plain = await r.json(); return { plain, data: plain.updated_at || "" }; } } catch (e) {}
  try { const r = await fetch("data/recovery.enc?v=" + Date.now(), { cache: "no-store" }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
}
async function openRecup(refresh) {
  const box = $("recup");
  if (!RC.env || refresh) {
    const env = await fetchEnv();
    if (!env) { if (!RC.env) box.innerHTML = `<div class="card empty"><b>Pas encore de données de récupération</b>Ajoute le secret <code>RECUP_CODE</code> dans GitHub, puis lance « Mise à jour Garmin ». Le premier remplissage prend quelques heures.</div>`; return; }
    if (RC.env && env.data === RC.env.data) return;
    RC.env = env; RC.data = null;
  }
  if (!RC.data) {
    const code = store.get(CODE_KEY);
    if (!code && !RC.env.plain) return showLock();
    try { RC.data = await decryptEnv(RC.env, code); } catch (e) { try { localStorage.removeItem(CODE_KEY); } catch (_) {} return showLock("Le code a changé, saisis-le à nouveau."); }
    prep();
  }
  renderRecup();
}
function showLock(msg, target = "recup", after = renderRecup) {
  const m = moon(new Date());
  $(target).innerHTML = `<div class="card lock"><div class="moon">${moonSvg(m, 64)}</div><h2>Récupération</h2>
    <p>Tes données de sommeil sont chiffrées. Saisis ton code une fois : cet appareil s'en souviendra.</p>
    <form id="lockForm" autocomplete="off"><input id="lockCode" type="password" inputmode="text" placeholder="Code d'accès" aria-label="Code d'accès" autofocus><button type="submit">Ouvrir</button></form>
    <div class="err" id="lockErr">${esc(msg || "")}</div></div>`;
  $("lockForm").onsubmit = async e => {
    e.preventDefault(); const code = $("lockCode").value.trim(); if (!code) return;
    $("lockErr").textContent = "Déchiffrement…";
    try { RC.data = await decryptEnv(RC.env, code); store.set(CODE_KEY, code); prep(); after(); }
    catch (err) { $("lockErr").textContent = "Code incorrect."; }
  };
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
    <section class="card span8"><h2>La nuit <span class="navn"><button id="rPrev" aria-label="Nuit précédente">‹</button><span id="rNightLbl"></span><button id="rNext" aria-label="Nuit suivante">›</button></span></h2><div id="rHyp"></div><div id="rStages"></div></section>
    <section class="card span4"><h2>Contexte de la nuit</h2><div class="ctx" id="rCtx"></div></section>
    <section class="card span6"><h2>Cœur pendant la nuit <small id="rHrInfo"></small></h2><div id="rHr"></div><div class="note" id="rHrNote"></div></section>
    <section class="card span6"><h2>VFC pendant la nuit <small id="rHrvInfo"></small></h2><div id="rHrv"></div><div class="note" id="rHrvNote"></div></section>
    <section class="card span6"><h2>Durée et phases <span class="legend">${Object.values(STAGES).map(([l, c]) => `<span><i style="background:${c};height:8px;width:8px;border-radius:2px"></i>${l}</span>`).join("")}</span></h2><div id="rSleep"></div></section>
    <section class="card span6"><h2>Heures de coucher et de lever <small id="rRegInfo"></small></h2><div id="rReg"></div></section>
    <section class="card span12"><h2>Body Battery <small id="rBBInfo"></small></h2><div id="rBB"></div></section>
    <section class="card span12"><h2>Ce qui semble jouer sur ton sommeil <small>toutes tes nuits depuis janvier</small></h2><div class="cmp" id="rCmp"></div>
      <p class="note">Comparaison de tes nuits entre elles (score de sommeil et durée) : ce sont des tendances observées, pas des causes prouvées. Un facteur n'apparaît qu'avec au moins 4 nuits concernées.</p></section>
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
  renderSleep(P); renderReg(P); renderBB(P); renderCmp(); renderFacts();
}
function selectDay(i) {
  if (!RC.pick.length) return;
  RC.sel = Math.max(0, Math.min(RC.pick.length - 1, i));
  const d = RC.pick[RC.sel], last = RC.sel === RC.pick.length - 1;
  $("rMPrev").disabled = $("rPrev").disabled = RC.sel <= 0;
  $("rMNext").disabled = $("rNext").disabled = last;
  const inp = $("rDate"); inp.min = RC.pick[0].d; inp.max = RC.pick[RC.pick.length - 1].d; inp.value = d.d;
  $("rToday").hidden = last;
  renderMorning(); renderNight(); renderNightHr(); renderNightHrv();
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
  const R = recoScore(n), s = R.score;
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
    k("Body Battery", n.bbch != null ? `+${n.bbch}` : "–", "", n.bbHi ? `max. ${n.bbHi} ${today ? "aujourd'hui" : "ce jour-là"}` : "cette nuit"),
    k("Respiration", n.resp ?? "–", n.resp ? "/min" : "", n.sstress != null ? `stress nocturne ${n.sstress}` : ""),
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
  if (S.all && S.all.length) {
    const lp = Charge.loadPart(d.dt);
    if (lp) add("load", "Charge récente", 20, lp.score, `${lp.km ? `${nf(lp.km)} km la veille · ` : "repos la veille · "}${nf(lp.ratio, 1)}× ta charge habituelle`, "charge des derniers jours légère", "grosse charge ces deux derniers jours");
  }
  if (parts.length < 2) return { score: null, parts };
  const W = parts.reduce((a, p) => a + p.w, 0), score = Math.round(parts.reduce((a, p) => a + p.score * p.w, 0) / W);
  const label = score >= 80 ? "Bien récupéré" : score >= 65 ? "Plutôt en forme" : score >= 50 ? "Récupération moyenne" : score >= 35 ? "Fatigue probable" : "Grosse fatigue";
  const pos = parts.filter(p => p.score >= 70).sort((a, b) => b.score * b.w - a.score * a.w).slice(0, 2).map(p => p.good);
  const neg = parts.filter(p => p.score < 45).sort((a, b) => a.score * b.w - b.score * a.w).slice(0, 2).map(p => p.bad);
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const text = [pos.length ? `${cap(pos.join(" et "))}.` : "", neg.length ? `À surveiller : ${neg.join(", ")}.` : ""].filter(Boolean).join(" ");
  return { score, label, parts, text };
}

// ------------------------------------------------------------------ La nuit (hypnogramme + contexte)
function renderNight() {
  const n = RC.pick[RC.sel];
  if (!n) { $("rHyp").innerHTML = `<div class="empty">Aucune nuit enregistrée</div>`; return; }
  $("rNightLbl").textContent = n.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
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
    const minAt = clock(new Date(d.bedDt.getTime() + st.mn[0] * 6e4));
    $("rHrNote").innerHTML = `Point le plus bas à ${minAt}${ref != null ? ` · moyenne de la nuit <b>${Math.abs(st.avg - ref) < .5 ? "identique à" : `${nf(Math.abs(st.avg - ref), 1)} bpm ${st.avg < ref ? "sous" : "au-dessus de"}`}</b> tes ${prev.length} nuits précédentes` : ""}. Les bandes colorées suivent les phases de sommeil.`;
  } else {
    $("rHrInfo").textContent = "";
    $("rHrNote").innerHTML = `${d.hrMin ? `Sur la journée : min. <b>${d.hrMin}</b> · moy. <b>${d.hrAvg ?? "–"}</b> · max. <b>${d.hrMax ?? "–"}</b> bpm. ` : ""}La courbe de nuit détaillée est disponible pour les 21 dernières nuits.`;
  }
}
function renderNightHrv() {
  const d = RC.pick[RC.sel]; if (!d) return;
  const st = nightChart("rHrv", d, "nhrv", { title: "VFC pendant la nuit", color: "var(--accent)", unit: "ms", band: [d.hrvLo, d.hrvUp] });
  if (st) {
    $("rHrvInfo").textContent = `moy. ${nf(st.avg)} · pic ${st.mx[1]} ms`;
    const bh = baseline(d, x => x.hrv, 4);
    $("rHrvNote").innerHTML = `${d.hrv ? `Garmin retient <b>${d.hrv} ms</b> pour la nuit` : ""}${bh ? ` (ta moyenne 30 j : ${nf(bh.m)} ms)` : ""}. ${d.hrvLo ? `Zone verte : ta plage habituelle ${d.hrvLo}–${d.hrvUp} ms.` : ""}`;
  } else {
    $("rHrvInfo").textContent = "";
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
    s += `<path d="${d}" fill="none" stroke="${se.c}" stroke-width="${se.w || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (n <= 35 && !se.dash) days.forEach((dd, i) => { if (dd[se.k] != null) s += `<circle cx="${x(i)}" cy="${y(dd[se.k])}" r="2.4" fill="${se.c}"/>`; });
  });
  s += `<line id="${el}Cur" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" opacity="0"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="${el}Hit"/></svg>`;
  box.innerHTML = s;
  const svg = box.querySelector("svg"), cur = $(el + "Cur"), hit = $(el + "Hit");
  const mv = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / iw * (n - 1)))), d = days[i];
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", .5);
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b>` + series.map(se => d[se.k] != null ? `<br>${se.l} : ${nf(d[se.k])} ${se.u || ""}` : "").join("") + (opt.tipExtra ? opt.tipExtra(d) : "")); };
  hit.addEventListener("pointermove", mv); hit.addEventListener("pointerdown", mv); hit.addEventListener("pointerleave", () => { hideTip(); cur.setAttribute("opacity", 0); });
}
const legend = items => items.map(([l, c, dash]) => `<span><i style="background:${dash ? `repeating-linear-gradient(90deg,${c} 0 3px,transparent 3px 6px)` : c}"></i>${l}</span>`).join("");
const avgOf = (arr, k) => { const v = arr.map(d => d[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function renderSleep(P) {
  const box = $("rSleep"), N = P.filter(d => d.sl);
  if (!N.length) { box.innerHTML = `<div class="empty">Pas de nuit sur la période</div>`; return; }
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
  if (!N.length) { box.innerHTML = `<div class="empty">Pas de nuit sur la période</div>`; return; }
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(280, Math.max(190, W * .48))), m = { l: 40, r: 6, t: 8, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const bs = N.map(d => minsFrom18(d.bedDt)), ws = N.map(d => minsFrom18(d.wakeDt));
  const lo = Math.floor((Math.min(...bs) - 30) / 60) * 60, hi = Math.ceil((Math.max(...ws) + 30) / 60) * 60, y = v => m.t + (v - lo) / (hi - lo) * ih;
  const gw = iw / N.length, bw = Math.max(2, Math.min(10, gw * .55));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures de coucher et de lever"><g class="axis">`;
  for (let v = lo; v <= hi; v += 120) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${pad((18 + v / 60) % 24)} h</text>`;
  const step = Math.max(1, Math.ceil(N.length / (W < 480 ? 5 : 8)));
  N.forEach((d, i) => { if (i % step === 0) s += `<text x="${m.l + gw * i + gw / 2}" y="${H - 5}" text-anchor="middle">${d.dt.getDate()} ${MONTHS[d.dt.getMonth()]}</text>`; });
  s += "</g>";
  const ab = bs.reduce((a, b) => a + b, 0) / bs.length, aw = ws.reduce((a, b) => a + b, 0) / ws.length;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(ab)}" y2="${y(ab)}" stroke="var(--accent)" stroke-dasharray="3 4" opacity=".7"/><line x1="${m.l}" x2="${W - m.r}" y1="${y(aw)}" y2="${y(aw)}" stroke="var(--amber)" stroke-dasharray="3 4" opacity=".7"/>`;
  N.forEach((d, i) => { const cx = m.l + gw * i + gw / 2; s += `<rect x="${cx - bw / 2}" y="${y(bs[i])}" width="${bw}" height="${Math.max(2, y(ws[i]) - y(bs[i]))}" rx="${bw / 2}" fill="url(#rg)" data-i="${i}"/>`; });
  s = s.replace("<g class=\"axis\">", `<defs><linearGradient id="rg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--amber)"/></linearGradient></defs><g class="axis">`);
  box.innerHTML = s + "</svg>";
  const fmt = v => `${pad(Math.floor((18 * 60 + v) / 60) % 24)}:${pad(Math.round(v % 60))}`;
  const sd = arr => { const a = arr.reduce((x, y) => x + y, 0) / arr.length; return Math.sqrt(arr.reduce((x, y) => x + (y - a) ** 2, 0) / arr.length); };
  $("rRegInfo").textContent = `coucher moyen ${fmt(ab)} · lever ${fmt(aw)} · écart type ${Math.round(sd(bs))} min`;
  box.querySelector("svg").addEventListener("pointermove", e => { const r = e.target.closest("rect[data-i]"); if (!r) return hideTip(); const d = N[+r.dataset.i];
    showTip(e, `<b>${d.dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })}</b><br>${clock(d.bedDt)} → ${clock(d.wakeDt)}`); });
  box.querySelector("svg").addEventListener("pointerleave", hideTip);
}
function renderBB(P) {
  const box = $("rBB"), bb = RC.data.bb || [];
  const today = RC.days[RC.days.length - 1] || {};
  $("rBBInfo").textContent = today.bbHi != null ? `aujourd'hui : max. ${today.bbHi} · min. ${today.bbLo}` : "";
  if (bb.length < 2) { tsChart("rBB", P, [{ k: "bbHi", l: "Max.", c: "var(--teal)" }, { k: "bbLo", l: "Min.", c: "var(--amber)" }], { band: ["bbLo", "bbHi", "var(--teal)", .12] }); return; }
  const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(260, Math.max(180, W * .44))), m = { l: 30, r: 8, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const mm = t => { const [h, mi] = t.split(":").map(Number); return h * 60 + mi; };
  const x = v => m.l + v / 1440 * iw, y = v => m.t + ih - v / 100 * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Body Battery aujourd'hui"><defs><linearGradient id="bbg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--teal)" stop-opacity=".45"/><stop offset="1" stop-color="var(--teal)" stop-opacity="0"/></linearGradient></defs><g class="axis">`;
  [0, 25, 50, 75, 100].forEach(v => s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  for (let h = 0; h <= 24; h += W < 480 ? 6 : 3) s += `<text x="${x(h * 60)}" y="${H - 5}" text-anchor="middle">${h} h</text>`;
  s += "</g>";
  const pts = bb.map(([t, v]) => [x(mm(t)), y(v)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
  s += `<path d="${d}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z" fill="url(#bbg)"/><path d="${d}" fill="none" stroke="var(--teal)" stroke-width="2.4" stroke-linejoin="round"/>`;
  const lp = pts[pts.length - 1]; s += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4.5" fill="var(--teal)" stroke="var(--card)" stroke-width="2"/><text x="${lp[0] + 8}" y="${lp[1] - 8}" font-weight="700" font-size="13" fill="var(--ink)">${bb[bb.length - 1][1]}</text>`;
  box.innerHTML = s + "</svg>";
}

// ------------------------------------------------------------------ Comparaisons
function renderCmp() {
  const N = RC.nights.filter(d => d.score != null || d.sl);
  const F = [
    ["Autour de la pleine lune", "± 2 jours", d => d.m.full],
    ["Nuit chaude", "min. ≥ 15 °C", d => d.wx?.tMin != null ? d.wx.tMin >= 15 : null],
    ["Nuit froide", "min. ≤ 3 °C", d => d.wx?.tMin != null ? d.wx.tMin <= 3 : null],
    ["Air très humide", "≥ 90 %", d => d.wx?.hum != null ? d.wx.hum >= 90 : null],
    ["Pression en baisse", "−6 hPa ou plus en 24 h", d => d.wx?.dP != null ? d.wx.dP <= -6 : null],
    ["Pluie pendant la nuit", "≥ 1 mm", d => d.wx?.rain != null ? d.wx.rain >= 1 : null],
    ["Vent fort", "rafales ≥ 35 km/h", d => d.wx?.wind != null ? d.wx.wind >= 35 : null],
    ["Pollen élevé", "≥ 30 grains/m³", d => d.wx?.pollen != null ? d.wx.pollen >= 30 : null],
    ["Air moyen à mauvais", "indice ≥ 50", d => d.wx?.aqi != null ? d.wx.aqi >= 50 : null],
    ["Grosse sortie la veille", "≥ 150 km", d => nightFacts(d).km >= 150],
    ["Effort tardif", "fini < 3 h avant le coucher", d => d.bedDt ? nightFacts(d).late : null],
    ["Journée de repos la veille", "aucune activité", d => nightFacts(d).acts.length === 0],
    ["Coucher après minuit", "", d => d.bedDt ? d.bedDt.getHours() < 12 : null],
    ["Nuit de week-end", "vendredi et samedi soir", d => { const w = (d.dt.getDay() + 6) % 7; return w === 5 || w === 6; }],
  ];
  const rows = [];
  F.forEach(([label, sub, f]) => {
    const yes = [], no = [];
    N.forEach(d => { const v = f(d); if (v === true) yes.push(d); else if (v === false) no.push(d); });
    if (yes.length < 4 || no.length < 4) return;
    const ds = (avgOf(yes, "score") ?? 0) - (avgOf(no, "score") ?? 0), dm = ((avgOf(yes, "sl") ?? 0) - (avgOf(no, "sl") ?? 0)) / 60;
    const dh = avgOf(yes, "hrv") != null && avgOf(no, "hrv") != null ? avgOf(yes, "hrv") - avgOf(no, "hrv") : null;
    rows.push({ label, sub, n: yes.length, ds, dm, dh });
  });
  rows.sort((a, b) => Math.abs(b.ds) - Math.abs(a.ds));
  if (!rows.length) { $("rCmp").innerHTML = `<div class="empty">Pas encore assez de nuits pour comparer.</div>`; return; }
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
  if (!RC.env) { $(target).innerHTML = `<div class="card empty"><b>Pas encore de données</b>Le plan a besoin des données de l'onglet Récup (secret <code>RECUP_CODE</code>).</div>`; return false; }
  if (!RC.data) {
    const code = store.get(CODE_KEY);
    if (code || RC.env.plain) { try { RC.data = await decryptEnv(RC.env, code); prep(); } catch (e) { try { localStorage.removeItem(CODE_KEY); } catch (_) {} } }
    if (!RC.data) { showLock("", target, after); return false; }
  }
  return true;
}
window.Recup = { ensure, recoScore, scoreColor, get data() { return RC.data; }, get days() { return RC.days; }, open: openRecup, hm, clock };

// ------------------------------------------------------------------ Démarrage
document.addEventListener("velo:loaded", () => { if (Nav.curTab() !== "recup") return; $("title").textContent = "Ma récupération"; if (RC.data) renderRecup(); });
let rT2, lastW2 = innerWidth;
addEventListener("resize", () => { if (innerWidth === lastW2) return; lastW2 = innerWidth; clearTimeout(rT2); rT2 = setTimeout(() => { if (Nav.curTab() === "recup" && RC.data) renderRecup(); }, 150); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Nav.curTab() === "recup") openRecup(true); });
setInterval(() => { if (document.visibilityState === "visible" && Nav.curTab() === "recup") openRecup(true); }, 5 * 60 * 1000);
Nav.apply();
})();
