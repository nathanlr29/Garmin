"use strict";
// Synchro du Plan entre appareils (collection « plan » de sync.js). Voir docs/superpowers/specs/2026-10-16-synchro-plan-design.md.
// Principe : on lit le localStorage du Plan comme une liste d'éléments { id, ts, v } (un par jour modifié, par annulation, par réglage…),
// on compare à l'instantané précédent pour savoir ce qui a changé, et on pousse seulement ces éléments. Le plus récent gagne.
(() => {
const SY = window.Sync;
const K_TS = "planSyncTs", K_SNAP = "planSyncSnap";   // horodatage de chaque élément ; dernier état connu (sert à voir ce qui a changé)
const WEEKS = 8, MAX_V = 40000;                       // seules les 8 dernières semaines sont envoyées ; limite d'une cellule de la Sheet
const SIMPLE = new Set(["planCfg", "planRc", "planFtp", "bwWeight", "bwAge", "planSince"]);
const DATE = "\\d{4}-\\d\\d-\\d\\d";
const RE = { ov: new RegExp(`^planOv:(${DATE}):([0-6])$`), undo: new RegExp(`^planUndo:(${DATE}):([\\w-]{1,60})$`), wk: new RegExp(`^planWk:(${DATE})$`), lbl: /^muscuLbl:([\w-]{1,60})$/ };
const ls = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const validId = id => SIMPLE.has(id) || RE.ov.test(id) || RE.undo.test(id) || RE.wk.test(id) || RE.lbl.test(id);
const weekOf = id => { const m = id.match(new RegExp(`^plan(?:Ov|Undo|Wk):(${DATE})`)); return m ? m[1] : null; };
const inWindow = (id, now = new Date()) => { const w = weekOf(id); return !w || w >= ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * WEEKS)); };
const ts0 = id => id === "planSince" ? 1 : 0;   // planSince : jamais écrasé par un autre appareil (le premier synchronisé fixe la date)

// Contenu du localStorage du Plan -> { id: valeur }.
function collect() {
  const out = {}, put = (id, v) => { if (v !== null && v !== undefined) out[id] = v; };
  for (const k of SIMPLE) put(k, ls.get(k, null));
  const lbl = ls.get("muscuLbl", null); if (lbl && typeof lbl === "object") for (const [n, v] of Object.entries(lbl)) put("muscuLbl:" + n, v);
  const keys = []; try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
  for (const k of keys) {
    let m;
    if ((m = k.match(new RegExp(`^planOv:(${DATE})$`)))) { const o = ls.get(k, null); if (o && typeof o === "object") for (const [d, v] of Object.entries(o)) put(`planOv:${m[1]}:${d}`, v); }
    else if ((m = k.match(new RegExp(`^planUndo:(${DATE})$`)))) { const a = ls.get(k, null); if (Array.isArray(a)) for (const u of a) put(`planUndo:${m[1]}:${u}`, true); }
    else if (RE.wk.test(k)) put(k, ls.get(k, null));
  }
  for (const id of Object.keys(out)) if (!validId(id)) delete out[id];
  return out;
}

// Écrit (v non nul) ou retire (v nul) un élément dans le localStorage, en reconstruisant la clé qui le contient.
function write(id, v) {
  let m;
  if ((m = id.match(RE.ov))) { const k = "planOv:" + m[1], o = ls.get(k, {}) || {}; if (v === null) delete o[m[2]]; else o[m[2]] = v; Object.keys(o).length ? ls.set(k, o) : ls.del(k); }
  else if ((m = id.match(RE.undo))) { const k = "planUndo:" + m[1], a = (ls.get(k, []) || []).filter(x => x !== m[2]); if (v !== null) a.push(m[2]); a.length ? ls.set(k, a) : ls.del(k); }
  else if ((m = id.match(RE.lbl))) { const o = ls.get("muscuLbl", {}) || {}; if (v === null) delete o[m[1]]; else o[m[1]] = v; Object.keys(o).length ? ls.set("muscuLbl", o) : ls.del("muscuLbl"); }
  else v === null ? ls.del(id) : ls.set(id, v);
}
// Valeur reçue d'un autre appareil : on refuse ce qui n'a pas la bonne forme plutôt que de casser l'onglet.
function okValue(id, v) {
  if (v === null) return true;
  const num = (a, b) => typeof v === "number" && v >= a && v <= b;
  if (id === "planFtp") return num(80, 600);
  if (id === "bwWeight") return num(35, 150);
  if (id === "bwAge") return typeof v === "string" && v.length < 12;
  if (id === "planSince") return typeof v === "string" && new RegExp(`^${DATE}$`).test(v);
  if (id === "planCfg") return !!v && typeof v === "object" && Array.isArray(v.days) && v.days.length === 7;
  if (id === "planRc") return Array.isArray(v);
  if (RE.wk.test(id)) return !!v && typeof v === "object" && v.v === 2 && Array.isArray(v.items);
  if (RE.ov.test(id)) return !!v && typeof v === "object";
  if (RE.undo.test(id)) return v === true;
  if (RE.lbl.test(id)) return typeof v === "string" && v.length < 40;
  return false;
}

// Compare l'état courant au dernier instantané : renvoie les éléments changés ou supprimés (supprimé = v nul), horodatés maintenant.
// Premier passage sur un appareil : l'existant devient la base (ts 0 / 1), pour qu'il ne batte pas ce qui est déjà dans la Sheet.
function scan(now = Date.now()) {
  const cur = collect(), snap = ls.get(K_SNAP, null), tsm = ls.get(K_TS, {}), changed = [];
  const next = {}; for (const [id, v] of Object.entries(cur)) if (inWindow(id)) next[id] = JSON.stringify(v);   // hors fenêtre : on ne suit plus (et ce n'est pas une suppression)
  for (const id of Object.keys(tsm)) if (!inWindow(id)) delete tsm[id];
  if (snap) {
    for (const id of new Set([...Object.keys(next), ...Object.keys(snap)])) {
      if (!inWindow(id)) continue;
      if (next[id] === snap[id]) continue;
      const v = id in cur ? cur[id] : null;
      tsm[id] = id === "planSince" ? 1 : Math.max(now, (tsm[id] || 0) + 1); changed.push({ id, ts: tsm[id], v });
    }
    ls.set(K_TS, tsm);
  }
  ls.set(K_SNAP, next);
  return changed;
}
const ready = it => inWindow(it.id) && JSON.stringify(it.v).length <= MAX_V;

function local() {
  const tsm = ls.get(K_TS, {}); scan();
  return Object.entries(collect()).map(([id, v]) => ({ id, ts: tsm[id] ?? ts0(id), v })).filter(ready);
}
function apply(items) {
  const tsm = ls.get(K_TS, {}), snap = ls.get(K_SNAP, {}) || {}, mine = collect();
  let changed = false;
  for (const it of items || []) {
    if (!it || !validId(it.id)) continue;
    // plus récent gagne ; égalité ou plus ancien : on garde le local. Exceptions : un élément jamais horodaté ici (existant avant la synchro) s'aligne sur la Sheet,
    // et planSince est toujours celui de la Sheet (premier appareil synchronisé).
    const fresh = it.ts > (tsm[it.id] ?? ts0(it.id)) || !(it.id in tsm) || it.id === "planSince";
    if (!fresh) continue;
    if (!okValue(it.id, it.v)) continue;
    const same = JSON.stringify(it.v ?? null) === JSON.stringify(mine[it.id] ?? null);
    tsm[it.id] = it.ts;
    if (same) continue;
    write(it.id, it.v ?? null);
    if (it.v === null || it.v === undefined) delete snap[it.id]; else snap[it.id] = JSON.stringify(it.v);   // pas de ré-envoi : ce n'est pas une modification locale
    changed = true;
  }
  ls.set(K_TS, tsm); ls.set(K_SNAP, snap);
  if (changed) refresh();
}
// Redessine l'onglet, mais pas pendant une saisie : on attend que le champ perde le focus (sinon le texte tapé disparaît).
function refresh() {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest?.("#plan")) { document.addEventListener("focusout", () => setTimeout(refresh, 0), { once: true }); return; }
  try { window.Plan?.refresh?.(); } catch (e) { console.error(e); }
}
// Appelé par plan.js après chaque écriture dans le localStorage.
function touch() { const items = scan().filter(ready); if (items.length) SY?.push("plan", items); }

scan();   // base posée au chargement, avant toute action : l'existant n'est jamais pris pour une modification
SY?.register("plan", { local, apply });
window.PlanSync = { touch, _: { collect, scan, write, local, apply, inWindow, okValue, validId, WEEKS } };
})();
