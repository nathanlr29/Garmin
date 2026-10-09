"use strict";
// Navigation par onglets. Les onglets sont décrits par une liste de données (TABS) :
//   id       identifiant (hash #id, clé "tab" du localStorage, data-tab du bouton)
//   label    texte du bouton
//   title    titre de la page (texte ou fonction)
//   open     appelée à chaque affichage de l'onglet (les modules sont chargés plus tard : accès paresseux)
//   panel    id de l'élément de l'onglet (par défaut = id ; il est créé s'il n'existe pas)
//   night    thème sombre de la page (et theme-color) tant que l'onglet est ouvert
//   controls true = affiche la barre de choix de l'année / du sport et « mis à jour »
//   aliases  anciens hash qui mènent à cet onglet
// Ajouter ou renommer un onglet = une ligne dans TABS. Chargé avant recup.js (qui lance le premier Nav.apply).
(() => {
const $ = id => document.getElementById(id);
const TABS = [
  { id: "activites", label: "Activités", aliases: ["velo"], title: () => S.cfg.titre || "Mes kilomètres", panel: "app", controls: true, open: () => { if (S.all.length) render(); } },
  { id: "recup", label: "Récup", title: "Ma récupération", night: true, open: () => window.Recup?.open() },
  { id: "plan", label: "Plan", title: "Mon plan", open: () => window.Plan?.open() },
  { id: "sortie", label: "Sortie", title: "Planifier une sortie", open: () => window.Sortie?.open() },
];
const COLOR = { day: "#f6f3ee", night: "#0c0f1d" };
const find = h => TABS.find(t => t.id === h || (t.aliases || []).includes(h));
const panelOf = t => $(t.panel || t.id);

function current() { return find(location.hash.slice(1)) || find(store.get("tab")) || TABS[0]; }  // #plan= ou #sync= : pas un onglet, on garde le dernier
const curTab = () => current().id;
function setTab(id) { store.set("tab", id); history.replaceState(null, "", "#" + id); apply(); }
function apply() {
  const t = current();
  document.documentElement.classList.toggle("night", !!t.night);
  TABS.forEach(x => { panelOf(x).hidden = x !== t; });
  document.querySelector(".controls").hidden = !t.controls;
  $("updated").hidden = !t.controls;
  $("title").textContent = typeof t.title === "function" ? t.title() : t.title;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t.id)));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.night ? COLOR.night : COLOR.day);
  t.open();
}
function mount() {
  const header = document.querySelector("header");
  const nav = document.createElement("nav");
  nav.className = "tabs"; nav.id = "tabs"; nav.setAttribute("role", "tablist");
  nav.innerHTML = TABS.map(t => `<button role="tab" data-tab="${t.id}">${t.label}</button>`).join("");
  header.insertBefore(nav, header.querySelector(".controls"));
  nav.onclick = e => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); };
  let prev = null;
  TABS.forEach(t => {
    let el = panelOf(t);
    if (!el) { el = document.createElement("main"); el.id = t.panel || t.id; el.hidden = true; prev.after(el); }
    prev = el;
  });
}

window.Nav = { TABS, curTab, setTab, apply };
mount();
addEventListener("hashchange", apply);
})();
