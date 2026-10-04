# Breizh Watts — contexte pour Claude Code

Tableau de bord vélo perso de Nathan (cycliste route, Rennes), alimenté par Garmin Connect.
Site statique : https://nathanlr29.github.io/Garmin/ (GitHub Pages, dépôt public nathanlr29/Garmin).
Langue de l'interface et des échanges : **français**.

## Architecture

- Aucun serveur. Tout est HTML/CSS/JS statique, sans framework ni build.
- `.github/workflows/update.yml` (« Mise à jour Garmin ») tourne toutes les heures (minute 17), à la main et à chaque push :
  - il installe `garminconnect` et `fitdecode` puis lance `scripts/fetch_garmin.py` ;
  - il committe `data/` ;
  - il copie `index.html *.js *.css config.json manifest.webmanifest icon-*.png data` dans `_site/` puis déploie sur Pages.
  - **Tout nouveau fichier à la racine doit correspondre à ce `cp`** (sinon il n'est pas déployé).
- Les identifiants Garmin sont dans les **secrets GitHub**. Ne jamais les lire, les afficher ni les écrire.
- Les données propres à un appareil (réglages, graissage de chaîne, départ des boucles) sont dans le `localStorage` du navigateur. Aucune synchro entre appareils, sauf le lien de partage `#plan=<base64>`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Coquille + onglet **Vélo** (stats, dernières sorties). Charge recup.js → bilan.js → plan.js → sortie.js |
| `recup.js/.css` | Onglet **Récup** (readiness, HRV, sommeil) |
| `plan.js/.css` | Onglet **Plan** : moteur de plan vélo + placement des 4 séances muscu, ajustements auto avec Annuler, export .zwo, carte Progression |
| `bilan.js` | Bilan de séance (modal) : NP/IF/TSS, zones, découplage, conformité au plan, coût du vent, profil Coggan, progression FTP |
| `sortie.js/.css` | Onglet **Sortie** : météo/vent, générateur de boucle face au vent (BRouter + profil perso), export GPX |
| `chain.js` | Suivi du graissage de chaîne (localStorage) |
| `scripts/fetch_garmin.py` | Récupère activités, récup, traces ; extrait les flux FIT → `data/streams/<id>.json` + `index.json` |
| `scripts/mywhoosh.py` | Réécrit les FIT MyWhoosh pour qu'ils apparaissent enregistrés par l'Edge 540 (laps/session reconstruits depuis les records) |
| `scripts/recovery.py`, `scripts/garmin_setup.py` | Récup et configuration initiale Garmin |

### Flux (data/streams)
- Sorties des 42 derniers jours, 6 au maximum par exécution, purge au-delà de 120 j, 1200 points au maximum.
- **Confidentialité** : le GPS est retiré à moins de 400 m du départ et de l'arrivée, et il n'y a pas de GPS pour les VirtualRide. Le point de départ des boucles (`soStart`) reste en localStorage, **jamais publié**.

## Moteur du Plan (plan.js)
- Semaine générée par recherche exhaustive (combinaisons de jours clés × permutations muscu) avec un score.
- Muscu le **matin**, vélo le **soir**. Jambes jamais le matin d'une séance clé, ni la veille d'une clé ou de la sortie longue.
- 2 séances clés par semaine (3 seulement si ≥6 jours vélo, pas de sortie longue et ≤2 matins muscu).
- Blocs de 4 semaines, avec test en semaine de décharge (testc en bloc VO2, sinon test FTP).
- Pools par bloc : [vo2,thr,vo2r] [vo2r,ss,vo2] [thr,vo2r,ss] [ss,thr,tempo].
- Règles quotidiennes :
  - R1 : clé manquée → déplacée ;
  - R2 : readiness <45 → clé déplacée ou remplacée ;
  - R2bis : readiness <35 → séance facile remplacée par récup 45 min ;
  - R3 : assez de séances dures faites, ou sortie dure non prévue la veille ;
  - muscu manquée → replacée.
  - Chaque changement est annulable (`planUndo:<lundi>`).
- Le contenu des séances muscu n'est **pas** géré ici : on place seulement les 4 séances.
- Clés localStorage : `planCfg`, `planWk:<lundi>`, `planOv:<lundi>`, `planUndo:<lundi>`, `muscuLbl`, `planSince`, `planFtp`, `bwWeight`, `bwAge`.
- API de test : `window.Plan._gen/_eff/_cfg/_phase/_build/_zwo`.

## Règles impératives
- Ne jamais supprimer d'activité Garmin.
- Ne jamais afficher ni stocker les identifiants ni le numéro de série de l'appareil. Ne pas toucher à `.garmin/tokens.enc` (jetons chiffrés gérés par le workflow).
- Ne jamais publier l'adresse ou le point de départ de Nathan.
- Tester avant de pousser :
  - servir le dossier en local (`python3 -m http.server`) ;
  - vérifier en 1280 px et 390 px, en clair et en sombre ;
  - zéro erreur JS console et pas de scroll horizontal.
- Commits petits et clairs, en français. Faire `git pull --rebase` avant de pousser : le workflow committe `data/` toutes les heures.

## Idées en attente (proposées, non faites)
- Muscu : bouton « Faite » manuel et choix du jour.
- Journal muscu (exercices et charges) via Google Sheets + Apps Script.
- Synchro des réglages et du graissage entre appareils.
