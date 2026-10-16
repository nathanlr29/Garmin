// Test des phrases et de la sélection de la carte « Progression » de l'onglet Plan (bilan.js) : node tests/progression.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = f => new URL(f, import.meta.url);
const read = f => readFileSync(here(f), "utf8");
const RIDE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const acts = JSON.parse(read("../data/activities.json")).map(a => ({ ...a, km: a.m / 1000, dt: new Date(a.d) }));
const prof = JSON.parse(read("../data/recovery.json")).profile;
const win = { Recup: { data: { profile: prof } } };
const ctx = { window: win, S: { all: acts }, RIDE_TYPES: RIDE, localStorage: { getItem: () => null }, document: { addEventListener() {}, getElementById: () => null },
  nf: (n, d = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n), esc: s => String(s), isIndoor: a => a.t === "VirtualRide" || a.tr === 1 };
vm.createContext(ctx); vm.runInContext(read("../charge.js"), ctx); ctx.Charge = win.Charge;
vm.runInContext(read("../bilan.js"), ctx);
const G = win.Bilan._prog, D = 864e5, now = Date.parse("2026-10-16T12:00:00Z");
const txt = s => s.replace(/<[^>]+>/g, "").replace(/ /g, " ");
const has = (s, w, m) => assert.ok(txt(s).includes(w), `${m || ""} « ${w} » absent de : ${txt(s)}`);
const SIGLES = /\b(CTL|ATL|TSB|TSS|NP|EF)\b/;

// ---- meilleur sur 6 semaines et courbe en marches
const P = [{ t: now - 80 * D, v: 230 }, { t: now - 30 * D, v: 210 }, { t: now - 10 * D, v: 220 }];
assert.equal(G.bestAt(P, now).v, 220, "meilleur des 42 derniers jours (le 230 a 80 jours)");
assert.equal(G.bestAt(P, now - 50 * D).v, 230);
assert.equal(G.bestAt([{ t: now - 50 * D, v: 200 }], now), null, "plus rien depuis 6 semaines");
const st = G.bestSteps(P, now);
assert.ok(st.every(([t], i) => !i || t > st[i - 1][0]), "marches triées");
assert.equal(st[st.length - 1][0], now); assert.equal(st[st.length - 1][1], 220, "fin de courbe = meilleur actuel");
assert.ok(st.some(([t, v]) => t === now - 38 * D && v === null), "trou quand le 230 sort de la fenêtre avant le 210");
assert.deepEqual(JSON.parse(JSON.stringify(G.bestSteps([{ t: now - 50 * D, v: 200 }], now))).map(x => x[1]), [200, null, null], "la marche s'arrête à la sortie de fenêtre");

// ---- phrase FTP
let s = G.ftpAnswer({ best: { v: 215 }, ftp: 250, garmin: 290, goal: 300 });
has(s, "Ton meilleur effort de 20 min des 6 dernières semaines vaut 215 W"); has(s, "35 W sous ta FTP de travail (250 W)"); has(s, "226 W × 95 %");
has(s, "plancher"); has(s, "Garmin l'estime à 290 W"); has(s, "objectif 300 W : encore 50 W à gagner");
assert.ok(!/\d [W%]/.test(s.replace(/<[^>]+>/g, "")), "espaces insécables entre nombre et unité");
s = G.ftpAnswer({ best: { v: 262 }, ftp: 250, garmin: 250, goal: 300 }); has(s, "12 W au-dessus"); has(s, "sous-estimée"); assert.ok(!txt(s).includes("Garmin"), "Garmin identique : pas répété");
s = G.ftpAnswer({ best: { v: 252 }, ftp: 250, goal: 300 }); has(s, "au niveau de ta FTP de travail");
s = G.ftpAnswer({ best: null, ftp: 250, goal: 300 }); has(s, "Aucun effort de 20 min soutenu"); has(s, "250 W");
s = G.ftpAnswer({ best: { v: 300 }, ftp: 305, goal: 300 }); has(s, "Objectif 300 W atteint");

// ---- efficacité aérobie
const E = [...[40, 35, 30].map(d => ({ t: now - d * D, v: 1.30 })), ...[20, 10, 2].map(d => ({ t: now - d * D, v: 1.36 }))];
const tr = G.efTrend(E, now); assert.ok(Math.abs(tr.pct - (1.36 / 1.30 - 1)) < 1e-9 && tr.n1 === 3 && tr.n0 === 3);
s = G.efAnswer(tr, E); has(s, "4,6 % de watts en plus"); has(s, "1,36 contre 1,30 W par battement"); has(s, "progresse");
s = G.efAnswer({ m1: 1.27, m0: 1.30, pct: 1.27 / 1.30 - 1 }, E); has(s, "en moins"); has(s, "fatigue");
s = G.efAnswer({ m1: 1.31, m0: 1.30, pct: 1.31 / 1.30 - 1 }, E); has(s, "autant de watts"); has(s, "stable");
assert.equal(G.efTrend(E.slice(3), now), null, "pas de période d'avant : pas de tendance");
s = G.efAnswer(null, E.slice(3)); has(s, "Ta dernière séance régulière : 1,36 W par battement"); has(s, "moyenne de tes séances : 1,36");

// ---- endurance de base
const R5 = d => d.map(dec => ({ dec }));
s = G.decAnswer(R5([3, 1, -0.4, 3.1, 6])); has(s, "4 séances sur 5 sous 5 % de dérive cardiaque : ta base aérobie tient.");
s = G.decAnswer(R5([3, 1, 2])); has(s, "Tes 3 dernières séances régulières sont toutes sous 5 %");
s = G.decAnswer(R5([3])); has(s, "Ta dernière séance régulière est sous 5 %");
s = G.decAnswer(R5([3, 6, 7, 2, 9])); has(s, "2 séances sur 5"); has(s, "pas encore toutes");
s = G.decAnswer(R5([6, 9, 7])); has(s, "0 séance sur 3"); has(s, "zone 2");
assert.equal(G.decAnswer([]), "");

// ---- profil de coureur : phrase d'abord, nouvelle carte du poids
const pt = G.profileType({ "5": .1, "60": .1, "300": .4, "1200": .35 }); assert.equal(pt.type, "plutôt rouleur / diesel"); assert.equal(pt.strong, "300"); assert.equal(pt.weak, "5");
assert.equal(G.profileType({ "5": .6, "60": .5, "300": .3, "1200": .3 }).type, "plutôt puncheur / sprinteur");
assert.equal(G.profileType({ "5": .3, "60": .3, "300": .3 }), null);
const best = { "5": { v: 640 }, "60": { v: 323 }, "300": { v: 278 }, "1200": { v: 226 } };
let h = G.profileHtml(best, 76.7); assert.ok(h.indexOf("Profil <b>") < h.indexOf("pf-row"), "phrase de type avant les barres");
h = G.profileHtml(best, null); has(h, "Indique ton poids (carte « Tes performances »)"); assert.ok(!h.includes("Ton niveau"));
assert.ok(h.indexOf("Indique") < h.indexOf("pf-row"));

// ---- étiquettes de bout de ligne : jamais superposées, dans le cadre
const L = G.spreadLabels([{ y: 50 }, { y: 52 }, { y: 55 }, { y: 140 }], 20, 150);
L.forEach((l, i) => { assert.ok(l.ly >= 20 && l.ly <= 150); if (i) assert.ok(l.ly - L[i - 1].ly >= 13 - 1e-9, "écart " + i); });
const L2 = G.spreadLabels([{ y: 148 }, { y: 149 }, { y: 150 }], 20, 150); assert.ok(L2[2].ly <= 150 && L2[1].ly <= L2[2].ly - 13 && L2[0].ly <= L2[1].ly - 13);

// ---- pas de sigle dans les phrases
for (const x of [G.ftpAnswer({ best: { v: 215 }, ftp: 250, garmin: 290, goal: 300 }), G.efAnswer(tr, E), G.decAnswer(R5([3, 6]))]) assert.ok(!SIGLES.test(txt(x)), "sigle dans : " + txt(x));

// ---- vraies données (activities.json + recovery.json) : mêmes sélections que l'ancien code
const R = acts.filter(a => RIDE.has(a.t)), ftp = 250, T = now;
const cut = T - 120 * D;
const oldPts = R.filter(a => a.dt.getTime() >= cut && a.pc && a.pc["1200"] && a.pc["1200"] * .95 >= .8 * ftp).map(a => a.id);
const oldEf = R.filter(a => a.dt.getTime() >= cut && ctx.isIndoor(a) && a.np > 0 && a.w > 0 && a.hr > 0 && a.mt >= 1800 && a.np / a.w <= 1.07 && a.np / ftp >= .5 && a.np / ftp <= .85).map(a => a.id);
const pts = G.ftpPts(R, ftp, T), ef = G.efPts(R, ftp, T);
assert.deepEqual(pts.map(p => p.a.id), oldPts, "FTP estimée : mêmes séances"); assert.deepEqual(ef.map(p => p.a.id), oldEf, "efficacité : mêmes séances");
pts.forEach(p => assert.equal(p.v, p.a.pc["1200"] * .95)); ef.forEach(p => assert.equal(p.v, p.a.np / p.a.hr));
const bNow = G.bestAt(pts, T), garmin = prof.ftpHist[prof.ftpHist.length - 1][1];
const fa = G.ftpAnswer({ best: bNow, ftp, garmin, goal: 300 }); has(fa, "FTP de travail (250 W)");
if (bNow) has(fa, `vaut ${ctx.nf(bNow.v)} W`);
const tReal = G.efTrend(ef, T), ea = G.efAnswer(tReal, ef); assert.ok(ea.length > 30);
console.log("FTP :", txt(fa)); console.log("Efficacité :", txt(ea));
console.log("ok : progression");
