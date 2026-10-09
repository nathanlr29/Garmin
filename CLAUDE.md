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
| `index.html` | Coquille + onglet **Activités** (stats, dernières sorties ; filtres Vélo / Extérieur / Home trainer / Course / Tout ; `load()` part au `DOMContentLoaded`, une fois tous les scripts chargés). Charge **charge.js → nav.js → recup.js** → bilan.js → plan.js → sync.js → chain.js → **course.js → synthese.js** → fitcourse.js → arrets.js → sortie.js (l'ordre compte : recup.js appelle `Nav.apply()` à la fin, plan.js et sortie.js lisent `Nav` et `Charge`, course.js déclare sa collection de synchro dans `Sync`, donc après sync.js). `loadProfile()` (index.html) charge `profile` via Recup à la demande |
| `synthese.js/.css` | Onglet **Synthèse** (premier onglet, par défaut sur un appareil sans clé `tab`) : « Ta forme », répartition de la charge par sport, indicateurs, « Ta semaine », projection vers les objectifs, détecteurs (« frais cachés ») et relevé du lundi. Fonctions pures dans `Synthese._`, testées par `node tests/synthese.mjs` |
| `course.js/.css` | Carte **Progression course** (filtre Course de l'onglet Activités) : chronos prédits, efficacité à cardio égal, allure seuil + réglage `runThrPace`, jauge de reprise, indicateurs Garmin. Fonctions pures dans `Course._`, testées par `node tests/course.mjs` |
| `charge.js` | `window.Charge` : classement des sports (vélo = `RIDE_TYPES`, course, muscu, autre), `tssOf`, charge par jour et par sport, série fond/fatigue/forme (CTL 42 j / ATL 7 j / TSB), `loadPart` (charge récente de la récup). Seuils lus au moment du calcul (`params()`) : FTP = `planFtp` (localStorage), sinon `profile.ftp`, sinon 250 ; LTHR vélo = `profile.hrZones.lthr`, sinon 165 ; course : `profile.run.lt` ou `runThrPace` (voir « Charge de course »). Test : `node tests/charge.mjs` |
| `nav.js` | `window.Nav` : onglets décrits par une liste de données `TABS` (id, libellé, titre, `open`, alias de hash, thème sombre…). Onglets : `synthese` (premier), `activites` (alias `velo` : les anciens liens `#velo` et la clé `tab` = `velo` y mènent), `recup`, `plan`, `sortie`. `Nav.curTab()`, `Nav.setTab()`, `Nav.apply()`. Ajouter ou renommer un onglet = une ligne dans `TABS` |
| `recup.js/.css` | Onglet **Récup** (readiness, HRV, sommeil). Expose `Recup.open` à `Nav` ; lance le premier `Nav.apply()` |
| `plan.js/.css` | Onglet **Plan** : moteur de plan vélo + placement des 4 séances muscu, ajustements auto avec Annuler, export .zwo, carte Progression |
| `bilan.js` | Bilan de séance (modal), **vélo** : NP/IF/TSS, zones, découplage, conformité au plan, coût du vent, profil Coggan, progression FTP ; **course** : voir « Onglet Activités et bilan de course ». Tests : `node tests/bilan-course.mjs` |
| `sortie.js/.css` | Onglet **Sortie** : météo/vent, générateur de boucles face au vent (BRouter + profil perso) avec carte de comparaison, export GPX |
| `arrets.js` | Points d'arrêt le long d'une sortie (eau, ravito, toilettes, réparation) : Overpass, horaires, arrêts conseillés. Utilisé par sortie.js |
| `fitcourse.js` | Encodeur de parcours FIT (course + course_point typés) pour les alertes « À venir » des Garmin |
| `chain.js` | Suivi du graissage de chaîne (localStorage, synchronisé via `sync.js` si configuré) |
| `sync.js` | Synchro générique entre appareils (Google Sheet + Apps Script), voir plus bas |
| `apps-script/sync.gs` | Code Apps Script à coller dans la Sheet (non déployé sur Pages, sans secret) |
| `scripts/fetch_garmin.py` | Récupère activités, récup, traces, parcours (`data/routes.json`) ; extrait les flux FIT (vélo et course) → `data/streams/<id>.json` + `index.json` |
| `scripts/mywhoosh.py` | Réécrit les FIT MyWhoosh pour qu'ils apparaissent enregistrés par l'Edge 540 (laps/session reconstruits depuis les records) |
| `scripts/recovery.py`, `scripts/garmin_setup.py` | Récup (+ profil : FTP, VO2max, zones, bloc course `profile.run`) et configuration initiale Garmin |
| `tests/test_garmin.py` | Tests Python des scripts (lecture des réponses Garmin, flux de course, vrai FIT factice) : `python3 tests/test_garmin.py` (`fitdecode` pour le test FIT, sinon sauté) |

### Traces et parcours
- `data/traces.json` : les 30 dernières activités dehors (tous sports), 160 points max, chargé avec la page (mini-tracés, chaîne).
- `data/routes.json` : parcours à refaire (onglet Sortie > « Refaire une sortie Garmin ») = sorties vélo dehors ≥ 20 km des 2 dernières années, hors home trainer / VirtualRide / MyWhoosh / Zwift, 400 points max, même coupure de 400 m. Récupérés **10 par passage** du workflow (`update_routes`) ; `null` = pas de GPS (mémorisé). Chargé seulement à l'ouverture du sélecteur. **Choix assumé : cet historique de parcours (tronqué) est public.**
- Sélecteur (`renderPick` dans sortie.js) : recherche nom/mois/date, liste des mois, « Masquer les trajets < 30 min » (coché par défaut), repli sur `traces.json` si une sortie n'a pas encore de parcours. Route chargée : `sortieRoute.src = "garmin"` + mention « début et fin tronqués ».

### Flux (data/streams)
- Sorties **vélo et course** (running, trail_running, treadmill_running, track_running, virtual_run) des 42 derniers jours, **6 au maximum par exécution pour l'ensemble** (les plus récentes d'abord), purge au-delà de 120 j, 1200 points au maximum.
- `index.json` : `{"<id>": {"d", "ok", "s"}}`, `s` = `"bike"` ou `"run"`. **Les entrées sans `s` (anciennes) sont du vélo.** Rien côté vélo ne lit les flux course : `Bilan.open` est limité aux `RIDE_TYPES` (clic sur une sortie, bilan du Plan) et `Bilan.progress` filtre sur `RIDE_TYPES`.
- Champs communs : `p` (puissance, aussi la puissance de course), `h` (FC), `c` (cadence), `v` (km/h × 10), `a` (altitude), `g` (GPS). **Course seulement**, s'ils sont dans le FIT : `c` en **pas/min** ((cadence + fractional_cadence) × 2), `sl` longueur de pas (cm, entier), `gct` temps de contact au sol (ms), `vo` oscillation verticale (cm, 1 décimale). Valeurs hors plage écartées. Contrôlé sur 2 vraies séances : longueur de pas = vitesse ÷ cadence à 0,5 cm près, donc cadence × 2 et unités corrects.
- **Confidentialité** : le GPS est retiré à moins de 400 m du départ et de l'arrivée, et il n'y a pas de GPS pour les VirtualRide, les tapis (treadmill_running) et virtual_run. Le point de départ des boucles (`soStart`) reste en localStorage, **jamais publié**.

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
- Collection `reglages` (course.js) : élément `id: "runThrPace"`, `v` = allure seuil en s/km, **`null` horodaté = suppression** (« Revenir à Garmin »). Le plus récent gagne (`ts` = clé locale `runThrPaceAt`) ; une valeur hors 180-480 est ignorée. Sans synchro, tout reste local.
- À réutiliser pour le journal muscu : nouvelle collection, rien à changer dans `sync.gs`.

## Profil course (scripts/recovery.py, `profile.run`)
- Bloc `profile.run` de `data/recovery.json`, rafraîchi **une seule fois par jour** : si `run.d` est la date du jour, `fetch_profile` reprend le bloc tel quel (aucun appel Garmin en plus à l'heure). Sur un 429, les appels course s'arrêtent et l'ancien bloc est gardé (réessai au passage suivant). Chaque appel est indépendant : en échec ou sans donnée de la montre, le champ est simplement absent.
- Extraits bruts dans `profile.raw` : `runLt`, `runRaces`, `runRacesHist`, `runTol`, `runEndu`, `runHill`, `runPr` (pour `runPr`, une ligne `[typeId, activityType, value, status]` par record), à lire quand un champ est vide.
- Format (listes `[date, valeur]` comme `ftpHist` / `vo2`) :
  - `d` : date du rafraîchissement ; `v` : version du format (`RUN_V` dans recovery.py, à incrémenter quand la lecture change : le bloc du jour est alors relu).
  - `lt` : `{pace, hr, d}` = seuil lactique, allure en **s/km**, FC en bpm. `get_lactate_threshold` rend la vitesse à une échelle variable : `pace_from_speed` essaie m/s, m/s ÷ 10 et km/h et ne garde que l'échelle qui donne 3:00–6:00/km, la plus proche de 4:13/km (allure semi de février 2026) ; sinon le champ est absent. Observé : `speed` brute 0,4306 (échelle ÷ 10) → **232 s/km (3:52/km)**, FC 175, au 05/10/2026 — Garmin donne un seuil plus rapide que l'allure semi (4:13) et presque à l'allure 5 km prédite : à garder en tête pour le rTSS de l'étape 2.
  - `races` : `{d, "5k", "10k", "hm", "m"}` en secondes (`get_race_predictions`) et `hist` = `[[date, 5k, 10k, semi, marathon], …]` quotidien depuis le 1er mars 2025, sans répéter les jours identiques (demandes d'un an au plus).
  - `tol` : tolérance à la course, hebdo, `[[date, {champ: valeur}]]` (champs « charge / ratio » rendus par Garmin). **Vide sur cette montre** (Garmin répond `[]`) : le champ est alors absent, ne pas en dépendre.
  - `endu`, `hill` : score d'endurance (`groupAverage` hebdo) et hill score (`overallScore` quotidien, ramené à un point par semaine), `[[date, score]]`, depuis `START` (1er janvier 2026, comme `ftpHist`).
  - `pr` : records de course `{"1k","1mi","5k","10k","hm","m": [secondes, date AAAA-MM-JJ, activityId]}` (records vélo ignorés ; la date vient de `prStartTimeGmtFormatted`). `long` (plus longue sortie, en mètres) n'est pas rendu par Garmin pour l'instant.
  - `vo2` : VO2max course (partie `generic` de `get_max_metrics_range`). **`profile.vo2` n'est pas modifié** (il sert à l'onglet Plan).

## Charge de course (charge.js, étape 2)
- `Charge.tssOf(a)` pour `sportOf(a) === "run"` : **rTSS à l'allure**. `v_seuil = 1000 / pace` (m/s, `pace` = `profile.run.lt.pace` en s/km) ; `v = (m + RUN_CLIMB × el) / mt` ; `IF = clamp(v / v_seuil, .4, 1.2)` ; `rTSS = mt/3600 × IF² × 100`. La puissance de course (`w`, `np`) n'est **pas** utilisée.
- `RUN_CLIMB = 8` : 1 m de D+ compte pour 8 m de plat (approximation simple de la montée, sans crédit en descente ; sur tapis `el` vaut 0).
- **Repli**, dans cet ordre, si `lt.pace` est absent ou si `m` vaut 0 : 1) FC rapportée à `profile.run.lt.hr` ; 2) l'ancienne formule (FC / LTHR vélo, .65 sans FC). `mt` = 0 donne 0.
- **Réglage de secours** : `runThrPace` (localStorage, secondes par km, 180 à 480) remplace `lt.pace` ; hors plage ou illisible, il est ignoré. Se règle depuis la carte Progression course (voir « Progression course »), lu dans `params()`. `Charge` expose aussi `RUN_CLIMB` et `RUN_PACE_RANGE` (constantes seulement, la formule n'a pas changé).
- **Limite : seuil unique.** `lt` est la valeur actuelle (pas d'historique) : toute la charge passée est calculée avec ce seuil. Si le seuil Garmin est trop rapide ou trop lent, c'est tout l'historique course qui est décalé (voir la remarque sur le seuil 3:52/km dans « Profil course »).
- Vélo, muscu et autres sports : formule inchangée depuis l'étape 0.
- Effet mesuré le 09/10/2026 (seuil 232 s/km) : TSS course total 16 060 → 11 272 ; IF médian 0,88 (FC / 165) → 0,76 (allure, 0,71 sans le D+) ; CTL/ATL/TSB 67,4 / 53,6 / 13,8 → 67,0 / 52,6 / 14,4 ; `loadPart` du jour 0,447 → 0,449 (score 100 inchangé).
- Tests : `tests/charge.ref0.json` (référence de l'étape 0, ancien code : sans profil course, `Charge` la retrouve au bit près ; avec profil course, le non-course et les jours sans course restent identiques), `tests/charge.ref.json` (instantané de l'étape 2, à régénérer **en connaissance de cause** avec `node tests/charge.mjs --regen`) et des cas factices de formule.

## Onglet Activités et bilan de course (étape 3a)
- **Onglet Activités** (ex-Vélo, id `activites`, alias `velo`). Filtres, dans l'ordre : Vélo · Extérieur · Home trainer · **Course** · Tout. Course = `Charge.RUN_TYPES` (lu au moment du filtre) ; la puce n'apparaît que s'il y a des courses. La clé localStorage `sport` garde ses valeurs (`bike`, `out`, `in`, `all`) et accepte `run`. Le rendu des filtres Vélo / Extérieur / Home trainer / Tout est **identique** à l'ancien (comparé avant/après, 1280 et 390 px, clair et sombre) ; seule la puce Course s'ajoute.
- **Course « en intérieur »** = `treadmill_running` ou `virtual_run` (`isRunIndoor`) : badge TAPIS, pas de tracé. `isIndoor` reste celui du vélo.
- **Sous le filtre Course** (`runMode()`), carte par carte :
  - hero « en course à pied » ; objectif = `config.json` → `objectif_km_course` (`null` ou 0 : pas de barre d'objectif, projection seulement). Le vélo garde `objectif_km` ;
  - tuiles : sorties, temps de course, D+, allure moyenne (`m:ss /km`, sorties dehors), plus longue sortie, sorties ≥ 10 km, FC moyenne, charge rTSS (`Charge.tssOf`) ;
  - records de l'année : plus longue, plus de D+, plus longue durée, meilleure allure moyenne ≥ 5 / 10 / 21,1 km (dehors), plus grosse semaine, puis « Records Garmin (tous temps) » depuis `profile.run.pr` (1 km, 1 mile, 5 km, 10 km, semi, marathon ; lien Garmin Connect par `activityId`). Si `Recup.data` n'est pas encore chargé, il est demandé une fois (`Recup.ensure("recProbe")`, élément caché) et la ligne apparaît dès qu'il l'est ;
  - anecdotes propres à la course (`factsRun` : marathons, tours de piste, villes à pied, heures…), sans Ventoux, Tour de France, home trainer ni vitesse de pointe ;
  - habitudes : pas de part home trainer ; la part « Dehors / tapis » n'apparaît que s'il y a des séances sur tapis ;
  - calendrier : seuils de couleur à pied (5 / 10 / 15 / 21,1 km par jour), « jours courus » ;
  - dernières sorties : km, D+, durée, allure, FC ; la carte « Graissage de chaîne » est masquée.
  Sous « Tout », rien ne change (une course y reste affichée comme avant), mais son clic ouvre le bilan.
- **Bilan de séance course** (`bilan.js`, `openRun`) : le clic sur une course dans « Dernières sorties » ouvre le bilan (vélo : `RIDE_TYPES`, course : `Charge.RUN_TYPES`). Rien de propre au vélo (ni vent, ni Coggan, ni % FTP, ni conformité au plan : la course entre dans le plan à l'étape 5).
  - Tuiles : durée, distance, allure moyenne en mouvement, D+, charge = `Charge.tssOf` (rTSS) avec IF par rapport à l'allure seuil (`Charge.params().runPace`), FC moyenne et max, effet aérobie ; si le flux les a : cadence (pas/min), longueur de pas, contact au sol, oscillation verticale ; puissance de course seulement comme info (« puissance Garmin »).
  - Graphique : allure (axe inversé, plus rapide en haut, lissée sur 30 s, arrêts < `RUN_MIN_KMH` = 3 km/h filtrés), FC, altitude, repère de l'allure seuil.
  - Zones : FC (`hz` de l'activité) et allure en 5 zones autour de la vitesse seuil (`RUN_ZONES` : < 78 %, 78-88, 88-95, 95-102, > 102 %), calculées sur la vitesse brute (sans correction de dénivelé).
  - Endurance : découplage allure/FC (1re moitié vs 2de moitié, comme le découplage puissance/FC du vélo ; `RUN_DEC_SKIP` = 10 min retirées, `RUN_DEC_MIN` = 20 min minimum ensuite, donc une course d'au moins 30 min) et efficacité en m par battement.
  - Verdict de 2 à 4 phrases, toutes calculées : allure/FC/zone cardio dominante, intensité et rTSS, découplage (séance régulière seulement), cadence si < `RUN_CADENCE_LOW` = 160 pas/min, sinon part du temps en zones d'allure 1-2.
  - Sans flux (course de plus de 6 semaines) : résumé seul, avec le message existant. Les entrées de `data/streams/index.json` sans `s` sont du vélo : une course sans `s` n'existe pas.
- Tests : `node tests/bilan-course.mjs` (allure, zones d'allure, découplage, tuiles et verdict ; deux vrais flux de course dans `tests/fixtures/`, sans GPS, plus des flux synthétiques).

## Progression course (course.js, étape 3b)
Carte pleine largeur de l'onglet Activités, **filtre Course seulement**, après les records (`#progCourse`, rendue par `Course.render` ; données = `profile.run` via `loadProfile()` + `S.all`). Même style SVG, couleurs, infobulles et classes CSS (`pg-grid`, `pg-box`, `bm-p`, `legend`) que `Bilan.progress`. Chaque bloc n'apparaît que s'il a des données, sinon une phrase courte. Fonctions pures séparées du rendu, testées par `node tests/course.mjs`.
1. **Mes chronos** : `races.hist` (`[date, 5k, 10k, semi, marathon]`, valeurs parfois nulles). Puces 5 km · 10 km · Semi · Marathon (choix gardé dans `courseDist`, 10 km par défaut). Courbe du chrono prédit, **axe inversé** (plus rapide = plus haut), valeur actuelle et allure, variations en temps et en % sur 30 j, 90 j et depuis le 1er janvier (vert = plus rapide ; la valeur de référence est la dernière valeur connue à la date voulue, donc les trous sont reportés ; sans valeur à cette date : « pas assez de recul »), repère = record Garmin de la distance (`pr`, avec sa date).
2. **Efficacité à cardio égal** : sorties dehors (pas de tapis, pas de course virtuelle) d'au moins 25 min, FC moyenne entre 75 et 88 % de `lt.hr` (131-154 bpm sans seuil), D+/km < 15 m, sur 18 mois. Valeur = **allure équivalente à 145 bpm** : vitesse corrigée du D+ avec `Charge.RUN_CLIMB`, × 145 / FC moyenne. Points + médiane glissante sur 8 semaines (3 points minimum). Phrase : 4 dernières semaines contre les 4 précédentes (vitesses), « la chaleur et la fatigue jouent aussi ». Un clic sur un point ouvre le bilan. Contrôle du 09/10/2026 : médiane 5:28 (printemps 2025) → 4:48 (printemps 2026), contre « environ 5:55 → 5:26 » attendu : même sens, progression de −40 s/km contre −29, mais niveau plus rapide car 8 m de plat par mètre de D+ comptent (allure brute des mêmes sorties : 5:46 → 5:16). Formule non recalée.
3. **Allure seuil** : trois sources datées. a) Garmin (`lt.pace`, `lt.hr`). b) **Tes efforts** : sorties de 15 à 75 min des 180 derniers jours à FC moyenne ≥ 90 % de `lt.hr` (157 bpm sans seuil), distance tenable en 60 min par Riegel `D60 = D × (3600 / T)^(1/1,06)`, seuil = `3600 / max(D60)` en s/km ; l'effort retenu est montré (nom, date, lien vers le bilan) ; plus de 8 semaines : « Effort ancien : refais un test » + aide en une ligne (30 min à fond régulier, allure des 20 dernières minutes ≈ seuil). c) **Prédictions Garmin** : Riegel appliqué au 10 km prédit. La valeur utilisée par `Charge.params()` et sa source sont affichées. « Utiliser » (b et c) enregistre `runThrPace` ; champ m:ss (180 à 480 s/km, sinon message) ; « Revenir à Garmin » supprime `runThrPace`. Après un changement l'onglet est recalculé (`render()`), une ligne prévient que Forme, Récup et Plan suivent. Clés localStorage : `runThrPace` (s/km), `runThrPaceAt` (horodatage du dernier changement, pour la synchro). Synchro : collection `reglages` (voir Synchro).
4. **Jauge de reprise** (km courus, pas la charge) : aigu = km des 7 derniers jours, chronique = moyenne hebdomadaire des 28 jours d'avant ; ratio et 4 zones (< 0,8 sous-charge ; 0,8-1,3 sûre ; 1,3-1,5 vigilance ; > 1,5 risque élevé, bornes hautes incluses sauf la dernière) ; volume conseillé = chronique × 0,8 à 1,3. **Mode reprise** si chronique < 15 km/sem. (ratio sans objet quand elle vaut 0) : « reprise : 2 à 3 sorties faciles, +10 % par semaine au plus, garde du jus » et nombre de semaines (lundi-dimanche) depuis la dernière semaine à plus de 25 km. Barres des km par semaine sur 12 semaines. Pas de conseil médical.
5. **Indicateurs Garmin** : tuiles VO2max course (`vo2`), score d'endurance (`endu`) et hill score (`hill`), valeur actuelle, variation sur 30 et 90 j, mini-courbe.
- Constantes nommées en tête de `course.js` : `EFF`, `THR`, `GAUGE`, `RIEGEL`, `DISTS`.
- Chargement : `loadProfile()` (index.html) demande `profile` à Recup une seule fois par chargement de page (éléments d'interface cachés dans `#recProbe`) ; la carte et la ligne « Records Garmin » se complètent dès qu'il est là.
- Tests : `node tests/course.mjs` (Riegel, sélection et valeur de l'efficacité, seuil depuis les efforts avec fenêtre, filtre FC et effort ancien, jauge et mode reprise, variations avec trous, saisie m:ss, collection `reglages`, contrôle sur les vraies données).

## Synthèse (synthese.js, étape 4)
Premier onglet (`synthese`, titre « Ma forme »). **Défaut** : un appareil sans clé `tab` s'ouvre sur la Synthèse ; un appareil qui a déjà une clé garde son onglet. Les données viennent de `Charge`, de `Recup` (chargé à la demande par `loadProfile()`), de `Plan.ftp()` ; même style SVG, couleurs et infobulles que `Bilan.progress` et la carte Progression course (classes `crvar`, `crtile`, `crSpark`, `legend`, `bm-zbar`). 5 onglets tiennent en 390 px (police et espacement réduits sous 480 px, `recup.css`).
- **Ta forme** : fond (CTL) en grand, fatigue (ATL), forme (TSB) avec le libellé de la carte Forme du Plan (frais > 5 · équilibré > −10 · chargé > −25 · très chargé), variations du fond sur 7 et 30 jours (points et %, vert / rouge), courbe fond / fatigue / forme (puces 3 · 6 · 12 mois, choix gardé dans `synPeriod`, infobulle : date et les 3 valeurs).
  - **Même définition que le Plan** : `Charge.series(…, 120)` (fenêtre de 120 jours), pas 365. Une série sur 365 jours donne un fond plus haut (71,0 contre 67,0 le 09/10/2026, forme +18 contre +14) : on garde la définition du Plan pour la courbe et les variations, afin que le chiffre en grand soit EXACTEMENT celui de la carte Forme du Plan (testé : `fitSeries` finit sur `Charge.fitness`). Chaque point de la courbe est ce que le Plan aurait affiché ce jour-là.
- **Répartition de la charge** : barre empilée vélo / course / muscu / autre sur les 30 derniers jours (aujourd'hui compris, TSS de `Charge.dayLoadsBySport`), puis charge par semaine (lundi-dimanche) empilée par sport sur 12 semaines. Couleurs : vélo `--accent`, course `#1c7ed6`, muscu `#7048e8`, autre `--ghost`.
- **Indicateurs** (4 tuiles, un clic ouvre l'onglet) : FTP (`Plan.ftp()`, historique `profile.ftpHist`, variation 30 j) → Plan ; VO2max (`profile.vo2`) → Plan ; allure seuil (`Charge.params().runPace`, source : Garmin avec sa date, ou ta saisie `runThrPace`, pas d'historique) → Activités filtre Course ; récup du jour (`Recup.recoScore` du dernier jour, couleurs du score de l'onglet Récup en dur car ses variables sont celles du thème nuit, variation = écart à la moyenne des 30 jours d'avant) → Récup.
- **Ta semaine** : heures, charge et nombre de séances (10 min et plus) par sport depuis lundi, comparés à la moyenne des 4 semaines complètes d'avant.
- **Projection vers tes objectifs** (4b) : constante `GOALS = { ftp: 300, vo2: 65, date: "2026-12-31" }`. Tendance **robuste de Theil-Sen** (médiane des pentes de toutes les paires de mesures, `PROJ.days` = 120 derniers jours) : un test isolé (292 → 260 début octobre) ne la fait pas basculer, la moindre-carrés, si. FTP : `profile.ftpHist` + FTP de test rampe (séances « … Ramp Test », 75 % de la meilleure minute, un seul test par jour : le meilleur, pour écarter un « Lite » interrompu). VO2max : `profile.vo2`. Valeur projetée = valeur actuelle (FTP du Plan, dernière VO2max) + pente × jours restants ; rythme nécessaire en W (ou points) par semaine ; verdict en une phrase : « objectif atteint », « dans les temps » (projetée ≥ objectif), « un peu juste » (rythme actuel ≥ 60 % du rythme nécessaire, `PROJ.justFrac`), « hors de portée au rythme actuel ». Arrondis : FTP au watt, VO2max au dixième, rythmes au dixième. Graphique : mesures, tendance (pointillés après aujourd'hui) jusqu'au 31/12, ligne d'objectif.
- **Frais cachés** (4b) : quatre détecteurs, seuils dans la constante `DET`, chacun avec une phrase d'explication et une piste quand il est actif, bandeau « Rien à signaler » sinon, et son historique sur 90 jours (dernière alerte, nombre de jours en alerte ; chaque détecteur est évalué « au jour J » par la même fonction). Statut `nodata` si les données manquent.
  - **Zone grise** : sur 14 jours, ≥ 3 séances de 20 min et plus non dures (vélo : `Plan.hardRide` faux ; course : IF < 0,85, IF déduit du rTSS) avec plus de 20 % du temps en zone 3 (vélo : `pz[2]`, course : `hz[2]`) ; les sorties sans zones sont non évaluables.
  - **Charge qui monte trop vite** : charge (TSS, tous sports) des 7 derniers jours / moyenne hebdomadaire des 28 jours d'avant > 1,5.
  - **VFC basse** : `hrv` sous `hrvLo` (ta normale Garmin) 3 jours de suite.
  - **Dette de sommeil** : somme sur 7 nuits de max(0, médiane des 60 nuits d'avant − `sl`) > 3 h (au moins 20 nuits de référence).
  - Observé le 09/10/2026 : aucun détecteur actif ; historique sur 90 jours : zone grise 8 jours (dernière : 3 août), charge 21 jours (21 sept.), VFC 2 jours (23 juil.), sommeil 41 jours (2 oct.) : le seuil de dette de sommeil est souvent franchi.
- **Relevé de la semaine dernière** (4b) : carte en tête de la Synthèse le lundi et le mardi : heures, charge, km et séances par sport, variation du fond, séances clés faites contre prévues (`Plan.plannedFor` / `Plan.isKey` / `Plan.hardRide` ; « pas de plan enregistré » sans plan), alertes de la semaine. Bouton « Refermer » : clé localStorage `synReleve:<AAAA-MM-JJ du lundi>`.
- Clés localStorage de la Synthèse : `synPeriod` (3, 6 ou 12 mois), `synReleve:<lundi>`. La tuile « Allure seuil » ouvre l'onglet Activités sur le filtre Course (clé `sport` = `run`).
- Tests : `node tests/synthese.mjs` (forme identique à `Charge.fitness`, variations, répartition, semaines, indicateurs, Theil-Sen, projection et verdicts, chaque détecteur actif / inactif / sans données, historique 90 j, relevé).

## Moteur du Plan (plan.js)
- **La charge (TSS, fond/fatigue/forme) vient de `charge.js`** : plan.js n'a plus de copie de `tssOf`/`dayLoads`. Il garde ce qui lui est propre (dernière séance dure, km et heures de la semaine…) dans `fitness()`, qui complète `Charge.fitness()`.
- Semaine générée par recherche exhaustive (combinaisons de jours clés × permutations muscu) avec un score.
- Muscu le **matin**, vélo le **soir**. Jambes jamais le matin d'une séance clé, ni la veille d'une clé ou de la sortie longue.
- 2 séances clés par semaine (3 seulement si ≥6 jours vélo, pas de sortie longue et ≤2 matins muscu).
- Blocs de 4 semaines, avec test en semaine de décharge (testc en bloc VO2, sinon test FTP).
- Test FTP = **test rampe** (Nathan préfère celui de MyWhoosh) :
  - paliers d'1 min de +6 % de FTP, de 55 à 157 %, jusqu'à ne plus tenir ; FTP = 75 % de la meilleure minute (`RAMP_*`) ;
  - toujours placé sur MyWhoosh ;
  - séance faite : la carte affiche la FTP mesurée et un bouton « Utiliser » (les séances MyWhoosh arrivent sur Garmin sans le nom du test) ;
  - `detectFtp` compte aussi les activités nommées « … Ramp Test ».
- Pools par bloc : [vo2,thr,vo2r] [vo2r,ss,vo2] [thr,vo2r,ss] [ss,thr,tempo].
- Règles quotidiennes :
  - R1 : clé manquée → déplacée ;
  - R2 : readiness <45 → clé déplacée ou remplacée ;
  - R2bis : readiness <35 → séance facile remplacée par récup 45 min ;
  - R3 : assez de séances dures faites, ou sortie dure non prévue la veille ;
  - muscu manquée → replacée.
  - Chaque changement est annulable (`planUndo:<lundi>`).
- Le contenu des séances muscu n'est **pas** géré ici : on place seulement les 4 séances.
- Clés localStorage : `planCfg`, `runThrPace` (course, voir charge.js), `planWk:<lundi>`, `planOv:<lundi>`, `planUndo:<lundi>`, `muscuLbl`, `planSince`, `planFtp`, `bwWeight`, `bwAge`.
- API de test : `window.Plan._gen/_eff/_cfg/_phase/_build/_zwo`.

## Feuille de route multisport
Breizh Watts devient un outil d'analyse multisport (vélo + course + muscu), façon « Finary du sport ». On avance par étapes.
- **Pas de version beta ni d'interrupteur** : chaque étape est poussée en ligne, donc complète et testée.
- **Navigation cible : 5 onglets** : Synthèse · Activités (filtres Vélo / Extérieur / Home trainer / Course / Tout) · Récup · Plan · Sortie. Les anciens liens `#velo` mènent à Activités (alias de hash dans `Nav.TABS`, fait à l'étape 3a ; il reste 4 onglets jusqu'à la Synthèse de l'étape 4).
- **Compatibilité** : le localStorage existant, les liens `#plan=` et `#sync=` et l'onglet mémorisé (clé `tab`) continuent de marcher ; tout nouveau réglage a une valeur par défaut qui reproduit le comportement actuel.

| Étape | Contenu | État |
|---|---|---|
| 0 | Fondations : `charge.js` (charge, sports, fond/fatigue/forme, par sport) et `nav.js` (onglets en liste de données). Aucun changement visible ; formules strictement identiques, vérifiées par `tests/charge.mjs` | **faite** |
| 1 | Données course : flux FIT course dans `fetch_garmin.py` ; une fois par jour dans `recovery.py` : seuil lactique, prédictions de course, tolérance course, score d'endurance, hill score, records. Aucun changement visible. Tests : `python3 tests/test_garmin.py`. Validé sur données réelles le 09/10/2026 | **faite** |
| 2 | Charge course calculée à l'allure seuil (rTSS) au lieu de la FC (voir « Charge de course »). Seuls certains chiffres bougent (Forme du Plan, charge récente de Récup) | **faite** |
| 3a | Course visible : onglet Activités, filtre Course (allure, records, objectif km course séparé dans `config.json`), bilan de séance course sans vent ni profil Coggan (voir « Onglet Activités et bilan de course ») | **faite** |
| 3b | Carte Progression course : chronos prédits, efficacité à cardio égal, allure seuil (3 sources) + réglage `runThrPace` (synchro `reglages`), jauge de reprise, indicateurs Garmin (voir « Progression course ») | **faite** |
| 4 | **Faite** (4a : forme, répartition, indicateurs, semaine ; 4b : projection, détecteurs, relevé du lundi ; voir « Synthèse »). Onglet Synthèse : fond/fatigue/forme sur 12 mois, variations 7 et 30 j, répartition de la charge par sport, FTP / VO2max / allure seuil / récup du jour, projection lissée vers 300 W et VO2max 65 fin 2026, détecteurs (zone grise, charge aiguë/chronique > 1,5, VFC sous la normale 3 jours, dette de sommeil 7 jours) | à faire |
| 5 | Plan multisport : jours de course dans `planCfg` ; sans jour coché, plan identique ; appliqué à partir du lundi suivant, semaine en cours jamais modifiée | à faire |
| 6 | Ressenti 1-10 après séance (collection sync `rpe`) et boucles à pied (profil piéton BRouter) | à faire |

Étape 0 — tests : `node tests/charge.mjs` compare `Charge` à `tests/charge.ref0.json` (généré avec l'ancien code de recup.js et plan.js sur `data/activities.json`, date figée au 2026-10-09, trois jeux de seuils) : TSS de chaque activité, charge par jour, CTL/ATL/TSB sur 120 jours, `loadPart` et `dayLoad` jour par jour, égalité exacte. Ce qui dépend du DOM (score de récup, cartes Forme et Charge conseillée du Plan) a été comparé dans le navigateur avant/après (1280 et 390 px, clair et sombre) : aucune différence. À l'étape 2 la charge course a changé : `charge.ref0.json` est gardée comme preuve que le reste est identique, `charge.ref.json` est un nouvel instantané.

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
