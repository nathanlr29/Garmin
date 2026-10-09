"use strict";
// Carte « Chaîne » (onglet Vélo) : km dehors depuis le dernier graissage (Squirt) et sorties sous la pluie.
(() => {
const K_LUBE = "chainLube", K_KM = "chainKm", K_KM_AT = "chainKmAt";
const MIN_RIDE = 1800;  // moins de 30 min = trajet avec le vélo du taff, pas le vélo de route
const ls = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const pad = n => String(n).padStart(2, "0");
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtD = d => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const WET_MM = 0.5;    // pluie cumulée pendant la sortie (et l'heure d'avant) pour la considérer « sous l'eau »
const rainCache = {};  // clé "lat,lon" -> Promise<{ "AAAA-MM-JJTHH:00": mm }>
const SY = window.Sync;

// Historique : union des dates, doublons à moins d'une minute supprimés, plus récent d'abord, 20 au maximum.
function mergeLube(...lists) {
  const out = [];
  for (const x of lists.flat().filter(x => !isNaN(new Date(x))).sort((a, b) => new Date(b) - new Date(a)))
    if (!out.some(y => Math.abs(new Date(y) - new Date(x)) < 6e4)) out.push(x);
  return out.slice(0, 20);
}
// Synchro (sync.js) : un élément par graissage (id "lube:<date ISO>") et un pour le seuil (id "km", le plus récent gagne).
SY?.register("chain", {
  local() {
    const items = ls.get(K_LUBE, []).map(d => ({ id: "lube:" + d, ts: Date.parse(d) || 0, v: d }));
    if (localStorage.getItem(K_KM) != null) items.push({ id: "km", ts: ls.get(K_KM_AT, 0), v: ls.get(K_KM, 200) });
    return items;
  },
  apply(items) {
    const hist = ls.get(K_LUBE, []);
    const merged = mergeLube(hist, items.filter(i => i.id.startsWith("lube:") && typeof i.v === "string").map(i => i.v));
    let changed = JSON.stringify(merged) !== JSON.stringify(hist);
    if (changed) ls.set(K_LUBE, merged);
    const km = items.find(i => i.id === "km");
    if (km && +km.v > 0 && km.ts >= ls.get(K_KM_AT, 0) && (km.v !== ls.get(K_KM, 200) || localStorage.getItem(K_KM) == null)) {
      ls.set(K_KM, +km.v); ls.set(K_KM_AT, km.ts); changed = true;
    }
    if (changed) render();
  }
});

function outdoorRides(since) {
  return (S.all || []).filter(a => RIDE_TYPES.has(a.t) && !isIndoor(a) && a.km > 0 && a.dt > since && a.mt >= MIN_RIDE)
    .sort((a, b) => a.dt - b.dt);
}
function where(a) {  // milieu de la trace si on l'a, sinon la ville du tableau de bord
  const t = S.traces && S.traces[a.id];
  const p = t && t.length ? t[Math.floor(t.length / 2)] : [S.cfg.latitude ?? 48.1173, S.cfg.longitude ?? -1.6778];
  return [Math.round(p[0] * 4) / 4, Math.round(p[1] * 4) / 4];
}
function rainAt(lat, lon) {
  const k = lat + "," + lon;
  if (!rainCache[k]) rainCache[k] = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&past_days=92&forecast_days=1&timezone=Europe%2FParis`)
    .then(r => r.ok ? r.json() : null).then(j => { const m = {}; if (j && j.hourly) j.hourly.time.forEach((t, i) => m[t] = j.hourly.precipitation[i] || 0); return m; })
    .catch(() => null);
  return rainCache[k];
}
async function wetness(a) {  // mm de pluie entre 1 h avant le départ et l'arrivée
  const m = await rainAt(...where(a)); if (!m) return null;
  const end = new Date(a.dt.getTime() + (a.et || a.mt) * 1000);
  let mm = 0, seen = 0;
  for (let t = new Date(a.dt.getTime() - 3600e3); t <= end; t = new Date(t.getTime() + 3600e3)) {
    const k = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:00`;
    if (k in m) { mm += m[k]; seen++; }
  }
  return seen ? Math.round(mm * 10) / 10 : null;
}

let seq = 0;
async function render() {
  const box = document.getElementById("chain"); if (!box) return;
  const my = ++seq;
  const hist = ls.get(K_LUBE, []), last = hist.length ? new Date(hist[0]) : null, lim = ls.get(K_KM, 200);
  const form = `<div class="chform"><label>Graissée le <input type="datetime-local" id="chDate" value="${isoLocal(last || new Date())}" max="${isoLocal(new Date())}"></label>
      <button class="btn" id="chSave">Enregistrer</button><button class="btn primary" id="chNow">Je viens de la graisser</button></div>`;
  if (!last) {
    const open = box.querySelector("details.chmore")?.open;
    box.innerHTML = `<h2>Chaîne <small>Squirt</small><span class="chright">${SY ? SY.dot() : ""}</span></h2><p class="chmsg">Indique quand tu as graissé ta chaîne : je compte ensuite les km dehors et je te préviens après une sortie sous la pluie.</p>${form}
      ${SY ? `<details class="chmore"><summary>Synchronisation entre appareils</summary>${SY.settingsHtml()}</details>` : ""}`;
    if (open) box.querySelector("details.chmore").open = true;
    bind(box); return;
  }
  const rides = outdoorRides(last), km = rides.reduce((s, a) => s + a.km, 0);
  const days = Math.floor((Date.now() - last) / 864e5);
  const draw = (wet, rainKnown) => {
    if (my !== seq) return;
    const open = box.querySelector("details.chmore")?.open;
    const pct = Math.min(100, km / lim * 100);
    let st, col, msg;
    if (wet.length) { st = "Graissage obligatoire"; col = "var(--bad)"; msg = `Sortie sous la pluie le ${fmtD(wet[0].a.dt)} (${String(wet[0].mm).replace(".", ",")} mm) : la Squirt est une cire, l'eau la lessive. Nettoie, sèche et regraisse avant la prochaine sortie.`; }
    else if (km >= lim) { st = "À graisser"; col = "var(--accent)"; msg = `${nf(km)} km dehors depuis le dernier graissage : c'est le moment.`; }
    else if (km >= lim * .8) { st = "Bientôt"; col = "var(--warn)"; msg = `Encore ${nf(lim - km)} km environ avant le prochain graissage.`; }
    else { st = "OK"; col = "var(--good)"; msg = `Encore ${nf(lim - km)} km environ avant le prochain graissage.`; }
    box.classList.toggle("chdue", st !== "OK" && st !== "Bientôt");
    box.innerHTML = `<h2>Chaîne <small>Squirt · graissée ${days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`}</small><span class="chright"><span class="chst" style="background:${col}">${st}</span>${SY ? SY.dot() : ""}</span></h2>
      <div class="chrow"><div class="chkm"><b>${nf(km)}</b> / ${lim} km dehors</div><div class="chbar"><div style="width:${pct}%;background:${col}"></div></div></div>
      <p class="chmsg">${msg}${rainKnown ? "" : " <small>(météo indisponible : je ne peux pas détecter la pluie pour l'instant)</small>"}</p>
      <details class="chmore"><summary>Graissage et réglages</summary>${form}
        <div class="chopts"><label>Rappel tous les <select id="chKm">${[150, 200, 250, 300, 400].map(v => `<option ${v === lim ? "selected" : ""}>${v}</option>`).join("")}</select> km</label><span class="chnote">trajets de moins de 30 min ignorés (vélo du taff)</span></div>
        ${rides.length ? `<div class="chlist">${rides.slice(-6).reverse().map(a => { const w = wet.find(x => x.a === a); return `<div>${fmtD(a.dt)} · ${nf(a.km)} km${w ? ` · <b style="color:var(--bad)">pluie ${String(w.mm).replace(".", ",")} mm</b>` : ""}</div>`; }).join("")}</div>` : ""}
        ${hist.length > 1 ? `<div class="chhist">Graissages précédents : ${hist.slice(1, 5).map(h => fmtD(new Date(h))).join(", ")}</div>` : ""}
        ${SY ? SY.settingsHtml() : ""}
      </details>`;
    if (open) box.querySelector("details.chmore").open = true;
    bind(box);
  };
  draw([], true);
  const res = await Promise.all(rides.map(a => wetness(a).then(mm => ({ a, mm }))));
  const wet = res.filter(r => r.mm != null && r.mm >= WET_MM);
  draw(wet, rides.length === 0 || res.some(r => r.mm != null));
}
function bind(box) {
  const save = d => { if (isNaN(d) || d > new Date()) return; const iso = d.toISOString(); ls.set(K_LUBE, mergeLube([iso], ls.get(K_LUBE, []))); render();
    SY?.push("chain", [{ id: "lube:" + iso, ts: Date.now(), v: iso }]); };
  box.querySelector("#chNow").onclick = () => save(new Date());
  box.querySelector("#chSave").onclick = () => { const v = box.querySelector("#chDate").value; if (v) save(parseLocal(v + ":00")); };
  const k = box.querySelector("#chKm"); if (k) k.onchange = () => { const ts = Date.now(); ls.set(K_KM, +k.value); ls.set(K_KM_AT, ts); render(); SY?.push("chain", [{ id: "km", ts, v: +k.value }]); };
  SY?.bindSettings(box, render);
}
const css = document.createElement("style");
css.textContent = `#chain h2{display:flex;align-items:center;gap:8px}
#chain .chright{margin-left:auto;display:flex;align-items:center;gap:6px}
#chain .chst{color:#fff;border-radius:var(--r-sm);padding:3px 8px;font-size:12px;font-weight:700}
#chain.chdue{border-color:var(--bad);box-shadow:inset 3px 0 0 var(--bad)}
#chain .chrow{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center}
#chain .chkm{font-size:14px;color:var(--muted);white-space:nowrap}#chain .chkm b{font:700 28px/1 var(--font-num);color:var(--ink)}
#chain .chbar{height:8px;border-radius:2px;background:var(--h0);overflow:hidden}#chain .chbar div{height:100%;border-radius:2px}
#chain .chmsg{font-size:14px;margin:10px 0 0;line-height:1.45}#chain .chmsg small{color:var(--muted)}
#chain .chmore summary{cursor:pointer;font-size:13.5px;font-weight:600;color:var(--accent-ink);margin-top:10px}
#chain .chform,#chain .chopts{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:10px;font-size:13.5px}
#chain input[type=datetime-local],#chain select{font:inherit;font-size:14px;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:var(--r-md);padding:6px 8px;margin-left:4px}
#chain .chlist{margin-top:10px;font-size:13px;color:var(--muted);display:grid;gap:3px}
#chain .chnote{color:var(--muted);font-size:12.5px}
#chain .chhist{margin-top:8px;font-size:12.5px;color:var(--muted)}`;
document.head.appendChild(css);
function status() {  // pour l'onglet Sortie : km depuis le dernier graissage
  const hist = ls.get(K_LUBE, []); if (!hist.length) return null;
  return { km: outdoorRides(new Date(hist[0])).reduce((s, a) => s + a.km, 0), lim: ls.get(K_KM, 200) };
}
window.Chain = { render, status };
})();
