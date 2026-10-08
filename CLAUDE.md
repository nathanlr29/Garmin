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
- Les données propres à un appareil (réglages, graissage de chaîne, départ des boucles) sont dans le `localStorage` du navigateur. Pas de synchro entre appareils, sauf le lien de partage `#plan=<base64>` et le graissage de chaîne via `sync.js` (voir plus bas).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Coquille + onglet **Vélo** (stats, dernières sorties). Charge recup.js → bilan.js → plan.js → sync.js → chain.js → fitcourse.js → arrets.js → sortie.js |
| `recup.js/.css` | Onglet **Récup** (readiness, HRV, sommeil) |
| `plan.js/.css` | Onglet **Plan** : moteur de plan vélo + placement des 4 séances muscu, ajustements auto avec Annuler, export .zwo, carte Progression |
| `bilan.js` | Bilan de séance (modal) : NP/IF/TSS, zones, découplage, conformité au plan, coût du vent, profil Coggan, progression FTP |
| `sortie.js/.css` | Onglet **Sortie** : météo/vent, générateur de boucles face au vent (BRouter + profil perso) avec carte de comparaison, export GPX |
| `arrets.js` | Points d'arrêt le long d'une sortie (eau, ravito, toilettes, réparation) : Overpass, horaires, arrêts conseillés. Utilisé par sortie.js |
| `fitcourse.js` | Encodeur de parcours FIT (course + course_point typés) pour les alertes « À venir » des Garmin |
| `chain.js` | Suivi du graissage de chaîne (localStorage, synchronisé via `sync.js` si configuré) |
| `sync.js` | Synchro générique entre appareils (Google Sheet + Apps Script), voir plus bas |
| `apps-script/sync.gs` | Code Apps Script à coller dans la Sheet (non déployé sur Pages, sans secret) |
| `scripts/fetch_garmin.py` | Récupère activités, récup, traces, parcours (`data/routes.json`) ; extrait les flux FIT → `data/streams/<id>.json` + `index.json` |
| `scripts/mywhoosh.py` | Réécrit les FIT MyWhoosh pour qu'ils apparaissent enregistrés par l'Edge 540 (laps/session reconstruits depuis les records) |
| `scripts/recovery.py`, `scripts/garmin_setup.py` | Récup et configuration initiale Garmin |

### Traces et parcours
- `data/traces.json` : les 30 dernières activités dehors (tous sports), 160 points max, chargé avec la page (mini-tracés, chaîne).
- `data/routes.json` : parcours à refaire (onglet Sortie > « Refaire une sortie Garmin ») = sorties vélo dehors ≥ 20 km des 2 dernières années, hors home trainer / VirtualRide / MyWhoosh / Zwift, 400 points max, même coupure de 400 m. Récupérés **10 par passage** du workflow (`update_routes`) ; `null` = pas de GPS (mémorisé). Chargé seulement à l'ouverture du sélecteur. **Choix assumé : cet historique de parcours (tronqué) est public.**
- Sélecteur (`renderPick` dans sortie.js) : recherche nom/mois/date, liste des mois, « Masquer les trajets < 30 min » (coché par défaut), repli sur `traces.json` si une sortie n'a pas encore de parcours. Route chargée : `sortieRoute.src = "garmin"` + mention « début et fin tronqués ».

### Flux (data/streams)
- Sorties des 42 derniers jours, 6 au maximum par exécution, purge au-delà de 120 j, 1200 points au maximum.
- **Confidentialité** : le GPS est retiré à moins de 400 m du départ et de l'arrivée, et il n'y a pas de GPS pour les VirtualRide. Le point de départ des boucles (`soStart`) reste en localStorage, **jamais publié**.

## Générateur de boucles (sortie.js)
- Candidats = forme (triangle `tri` / losange `los`) × rotation par rapport au vent × sens, dans l'ordre de `genSpecs()` : 12 au départ, puis 6 par « Proposer d'autres boucles » (jamais deux fois la même combinaison : `tried`). On garde au plus 3 nouvelles boucles vraiment différentes (recouvrement < 55 %) ; **6 propositions max**, les plus anciennes non sélectionnées/non analysées partent.
- **BRouter (serveur public)** : `brRouteQ` = 2 requêtes au plus en parallèle, 600 ms minimum entre deux départs, cache en mémoire par points de passage. Changer de boucle, inverser le sens ou recharger la page ne rappelle **jamais** BRouter.
- Interface : carte Leaflet (`#gMap`, conservée entre les rendus) avec toutes les boucles (sélectionnée orange épaisse + chevrons de sens, autres grises cliquables), départ et flèche de vent ; fiches (km, D+, temps, mini-profil, % du retour vent dans le dos, phrase « pourquoi ») en grille, en carrousel `scroll-snap` sous 620 px.
- « Choisir cette boucle » → `setRoute` (analyse complète) ; le bandeau « Autres boucles (N) » (`altBar`) reste au-dessus de l'analyse pour changer de boucle en un clic. Route générée : `sortieRoute.gid` = id de la proposition.
- **Allers-retours (éperons)** : `dblScan` rééchantillonne le tracé tous les 10 m. Un point est « en double » s'il passe à moins de 25 m d'un point parcouru au moins 100 m plus tôt. C'est un éperon si le cap est opposé (±30°) sur plus de 150 m (`spurs`). Une paire est tolérée si son premier passage est dans les 2 premiers km et le second dans les 2 derniers (même route que l'aller près du départ).
  - Correction (`routeFix`), boucle par boucle :
    - a) le point de passage le plus proche du bout de l'éperon est déplacé sur l'entrée de l'éperon (un vrai carrefour), puis la boucle est recalculée (1 requête) ;
    - b) pour un losange, ce point de passage est supprimé (1 requête) ;
    - c) sinon l'éperon est coupé en local (`cutSpurs`), la distance et le D+ sont recalculés et la fiche affiche « Aller-retour de x m retiré ».
  - Les points de passage corrigés sont gardés (`wps`, `cut` dans `soGenRes`).
  - Score : `dblShare × 400`. Une boucle à plus de 3 % en double est rejetée, sauf s'il ne reste qu'elle.
  - Test : `node tests/eperons.mjs` (le dossier `tests/` n'est pas déployé).
- « Inverser le sens » : points inversés en local + score de vent recalculé (note : attention aux sens uniques, pas de recalcul d'itinéraire).
- Invalidation : distance, relief ou point de départ changés → propositions effacées ; date, heure ou vitesse changées → tracés gardés, vent et scores recalculés (`syncRes`, 1 appel météo si la date change).
- Clés localStorage : `soGenRes` (réglages de calcul, point de départ, météo au départ, propositions avec leurs points, combinaisons essayées), `soGenSel` (sélection), plus `soGenKm`, `soGenRel`, `soStart`, `soBrf`, `sortieRoute`, `sortieSet`. `soGenRes` contient le point de départ : **localStorage uniquement**, jamais dans le dépôt ni dans une URL.

## Points d'arrêt (arrets.js)
- Concerne toutes les traces : boucle générée, GPX importé, sortie Garmin refaite. `Arrets.update(ctx)` est appelé en fin de `compute()` dans sortie.js.
- **Overpass** : **une seule requête par trace**, en POST `text/x-www-form-urlencoded`, dans un couloir de 150 m autour du tracé simplifié (Douglas-Peucker, 350 points au plus).
  - Les **400 premiers et derniers mètres ne sont jamais envoyés** (point de départ).
  - Cache `soPoi` (7 jours, 4 traces), avec un 2e serveur en secours. Changer l'heure ou la vitesse ne relance rien.
  - En cas d'échec : message et bouton « Réessayer ». Le reste de la sortie s'affiche normalement.
- **Catégories** : eau (`drinking_water`, cimetière = « eau probable », souvent coupée l'hiver), ravito (boulangerie, épicerie / supérette, station-service, café / bar), toilettes, réparation (station, magasin de vélo).
- **Pour chaque point** : km, heure de passage (`r.T` de la simulation) et écart au tracé.
- **Horaires** : bibliothèque `opening_hours@3.8.0` + `suncalc@1.9.0` (jsDelivr), chargée seulement s'il y a des horaires à lire, avec un bouchon pour `i18next`. Si elle ne charge pas : `ohSimple` lit les cas courants, sinon « horaires à vérifier ».
- **Arrêts conseillés** (`advise`, 3 au plus), calés sur la carte Nutrition (`SO.nut` : ml/h, bidons de 1,2 L, g/h) :
  - eau vers le milieu au-delà de 2 h, plus tôt s'il fait chaud ou si les bidons sont vides avant ;
  - 2e remplissage si la sortie est longue ;
  - ravito ouvert au-delà de 3 h ;
  - un commerce qui sert aux deux devient « eau + ravito ».
  - La carte Nutrition indique où remplir les bidons.
- **Affichage** :
  - carte : marqueurs par catégorie, les conseillés en plus gros ;
  - filtres par catégorie (`soStopCat`) ;
  - liste compacte : 10 points, puis « Afficher tout » ;
  - icônes sur le profil ;
  - case « GPS » par point (`soGps`, par trace).
- Tests : `node tests/arrets.mjs`.
- **Pause découverte** (case dans la carte Arrêts, `soDecouv`, **désactivée par défaut**) : catégorie « À voir ».
  - Patrimoine : château, mégalithe, église ou chapelle, moulin, calvaire, monument. Nature : point de vue, site naturel.
  - Ces lieux viennent de la **même requête Overpass** (couloir de 300 m), seulement s'ils ont un tag `wikipedia` ou `wikidata`.
  - Fiche française : tag `fr:` ou sitelink `frwiki` (Wikidata `wbgetentities`, 50 lieux par requête, cache `soWd`).
  - Résumé : API REST de Wikipédia (`page/summary`, cache `soWiki` 30 jours). Lieu écarté si 404 ou page d'homonymie. Anecdote de 1 à 2 phrases tirées du résumé, **sans rien ajouter**. Si les coordonnées de la fiche sont à plus de 2 km du lieu : nom et lien seulement.
  - 3 à 5 lieux, un par cinquième du parcours (château, mégalithe et point de vue d'abord), 14 fiches lues au plus.
  - Case « GPS » décochée par défaut. Types FIT info / overlook.
- **Export (toutes les traces)** : boutons « Exporter en GPX » et « Exporter pour Garmin (.fit) ». Sont exportés les arrêts conseillés (sauf décochés) et les points cochés (`Arrets.gpsPoints`).
  - **Nom court** pour l'Edge, 15 caractères au plus : « Eau cimetière », « Boulang. 19h » (heure de fermeture si elle est connue).
  - **GPX** : `<wpt>` placés avant `<trk>` et **posés sur le tracé**, parce que Garmin Connect ne convertit en points de parcours que les waypoints à moins d'environ 35 m. `<type>` = nom du type FIT (water, food, store, toilet, gear…), `<sym>` = symbole Garmin.
  - **FIT** (le plus fiable pour les alertes) : messages file_id (course, fabricant 255, **sans numéro de série**), course, lap, event start, records tous les 25 m avec l'heure simulée, course_point dans l'ordre du trajet, puis event stop.
  - Types FIT : eau 3, nourriture 4, magasin 48, toilettes 39, matériel 41, point de vue 38, info 53.
  - Test : `node tests/fit.mjs`. Vérification complète avec le SDK officiel (`pip install garmin-fit-sdk`, `Decoder(Stream.from_file(f)).read()`).
  - Mode d'emploi en 3 étapes dans la carte Arrêts (« Avoir les alertes sur ton Edge »).

## Synchro entre appareils (sync.js + apps-script/sync.gs)
- Google Sheet **privée** + Apps Script déployé en application web (« Exécuter en tant que : moi », « Accès : tout le monde »). La clé est dans les propriétés du script (`SYNC_KEY`, 16 caractères minimum).
- **L'URL de l'application web et la clé ne vont JAMAIS dans le dépôt** : saisies une fois par appareil (carte Chaîne > réglages > Synchronisation), stockées en localStorage. Le lien `#sync=<base64 {url,key}>` configure un autre appareil ; il est effacé de l'URL dès sa lecture. URL acceptée : `https://script.google.com/…/exec` (et `http://localhost` ou `127.0.0.1` en local seulement).
- Transport : **tout en POST `text/plain`** (requête simple, sans preflight CORS qu'Apps Script ne gère pas), clé dans le corps. `doGet` répond seulement `{ok:true}`, sans données. Opérations : `ping` et `sync` (envoie les éléments en attente, reçoit toute la collection).
- Modèle générique : une **collection** = un onglet de la Sheet = des éléments `{id, ts, v}` ; pour un même id, le `ts` le plus grand gagne (serveur, sous `LockService`). Rien n'est jamais supprimé côté serveur.
- Côté site : `Sync.register(nom, { local(), apply(items) })`, puis `Sync.push(nom, items)` après chaque enregistrement local. Synchro au chargement, après chaque enregistrement, au retour du réseau (`online`) et quand la page redevient visible ; nouvel essai toutes les 60 s si réseau indisponible. Interface réutilisable : `Sync.dot()` (pastille ✓ / … / ! / ⟳), `Sync.settingsHtml()` + `Sync.bindSettings(el, rerender)`.
- Migration : au premier sync d'une collection sur un appareil (`syncInit:<nom>` absent), tout le local est envoyé ; le serveur fusionne sans écraser.
- Collection `chain` : un élément par graissage (`id: "lube:<ISO>"`) ; fusion = union, doublons à moins d'1 min supprimés, tri décroissant, 20 max. Seuil : `id: "km"`, horodaté par `chainKmAt`.
- Sans configuration, rien ne s'exécute et tout fonctionne comme avant.
- Test local : faux Apps Script (serveur Python qui exécute le vrai `sync.gs` via `osascript -l JavaScript`, redirection 302 comme Google), deux « appareils » = `localhost` et `127.0.0.1` (localStorage séparés).
- Clés localStorage : `syncCfg`, `syncQ` (file d'attente par collection), `syncAt`, `syncInit:<collection>`, `chainKmAt`.
- À réutiliser pour le journal muscu : nouvelle collection, rien à changer dans `sync.gs`.

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
- Synchro des réglages (plan) entre appareils : réutiliser `sync.js`. (Graissage : fait.)
- Arrêts : vérifier sur un vrai Edge 540 l'import FIT dans Garmin Connect (types et alertes « À venir »).
