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
//   icon     tracés SVG (24 × 24, trait) de l'icône, affichée dans la barre d'onglets du bas sur mobile
// Ajouter ou renommer un onglet = une ligne dans TABS. Chargé avant recup.js (qui lance le premier Nav.apply).
(() => {
const $ = id => document.getElementById(id);
const TABS = [
  { id: "synthese", label: "Synthèse", title: "Ma forme", open: () => window.Synthese?.open(),
    icon: '<path d="M3.8 17A9 9 0 1 1 20.2 17"/><path d="M12 13.3l4.3-4.6"/><circle cx="12" cy="13.3" r="1.3"/>' },
  { id: "activites", label: "Activités", aliases: ["velo"], title: "Mes activités", panel: "app", controls: true, open: () => { if (S.all.length) render(); },
    icon: '<path d="M5 19v-6M10 19V6M15 19v-9M20 19v-4"/>' },
  { id: "recup", label: "Récup", title: "Ma récupération", night: true, open: () => window.Recup?.open(),
    icon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>' },
  { id: "plan", label: "Plan", title: "Mon plan", open: () => window.Plan?.open(),
    icon: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
  { id: "sortie", label: "Sortie", title: "Planifier une sortie", open: () => window.Sortie?.open(),
    icon: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>' },
];
const COLOR = { day: "#ffffff", night: "#141416" };   // barre d'état (theme-color) = fond de la barre du haut : blanc le jour, gris nuit sur l'onglet Récup
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
  const nav = document.createElement("nav");
  nav.className = "tabs"; nav.id = "tabs"; nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Onglets");
  nav.innerHTML = TABS.map(t => `<button role="tab" data-tab="${t.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon || ""}</svg><span>${t.label}</span></button>`).join("");
  document.querySelector(".appbar-in").appendChild(nav);   // ordinateur : dans la barre du haut ; mobile : fixée en bas (theme.css)
  nav.onclick = e => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); };
  let prev = null;
  const first = TABS.map(panelOf).find(Boolean);   // un onglet sans élément (Synthèse) se place avant le premier panneau existant
  TABS.forEach(t => {
    let el = panelOf(t);
    if (!el) { el = document.createElement("main"); el.id = t.panel || t.id; el.hidden = true; if (prev) prev.after(el); else first.before(el); }
    prev = el;
  });
}

window.Nav = { TABS, curTab, setTab, apply };
mount();
addEventListener("hashchange", apply);
})();
