# Synchro du Plan entre appareils (Mac / téléphone)

Date : 2026-10-16. Demandé par Nathan (fil « Firebase »). Statut : **à valider avant de coder**.

## Pourquoi
Le plan se règle et s'ajuste presque chaque jour (course ajoutée, durée changée, séance déplacée, annulation). Tout est en `localStorage` : le Mac et le téléphone affichent donc des semaines différentes. La synchro Google Sheet existe déjà (`sync.js`, `apps-script/sync.gs`) mais ne couvre que le graissage et l'allure seuil.

## Décision : Google Sheet, pas Firebase
Un seul utilisateur, très peu de données, fusion « le plus récent gagne » déjà écrite et testée. Firebase ajouterait un compte, des règles de sécurité et un SDK dans un site public, pour du temps réel dont on n'a pas besoin. `sync.gs` ne change pas : une collection = un onglet créé à la volée. **Aucune donnée Garmin à synchroniser** : activités, récup et profil viennent de `data/` et sont déjà identiques partout.

## Ce qui est synchronisé (collection `plan`, un élément `{id, ts, v}` par ligne)
| Clé locale | Éléments | Pourquoi ce découpage |
|---|---|---|
| `planOv:<lundi>` | un par jour : `planOv:<lundi>:<jour>` | jeudi sur le Mac + vendredi sur le téléphone = les deux gardés |
| `planUndo:<lundi>` | un par ajustement annulé : `planUndo:<lundi>:<id>` (`true`) ; « Refaire » = `null` sur chacun | idem |
| `muscuLbl` | un par entrée : `muscuLbl:<clé>` | idem |
| `planCfg`, `planRc` | un chacun, en entier | changés rarement ; le plus récent gagne |
| `planFtp`, `bwWeight`, `bwAge` | un chacun | réglages simples |
| `planSince` | un ; **la date la plus ancienne gagne** (mon choix) | évite qu'un appareil neuf recule l'historique |
| `planWk:<lundi>` | un par semaine figée, seulement les 8 dernières semaines | les deux appareils montrent la même semaine figée ; limite la taille |

**Pas synchronisés** : `tab`, `sport`, `synPeriod`, `synDetails` (préférences d'affichage), `soStart` et tout le contexte des boucles (**point de départ jamais publié**, même dans une Sheet privée), `runThrPace` (déjà dans `reglages`), graissage (déjà dans `chain`).

## Règles de fusion
- Suppression = élément `v: null` horodaté (le serveur ne supprime jamais).
- Horodatage tenu dans une clé locale `planTs` (`{id: ts}`), mis à jour à chaque écriture locale.
- Même id modifié des deux côtés avant synchro : le `ts` le plus grand gagne (horloge de chaque appareil ; écart de quelques secondes sans importance).
- **Migration** : les clés déjà présentes sans horodatage partent avec `ts = 0`. Le premier appareil qui se synchronise impose donc son plan, le second l'adopte (un `ts` égal ne bat jamais le serveur). **Configurer le Mac en premier**, attendre la pastille ✓, puis le téléphone. Toute modification ultérieure (`ts` > 0) gagne normalement.
- Taille : un élément trop gros pour une cellule (> 40 000 caractères) n'est pas envoyé (ligne dans la console), jamais tronqué.

## Branchement dans le code
- `plan.js` : `store2.set/del` appellent un crochet facultatif `window.PlanHook?.change(clé, ancienne, nouvelle)`. **Sans `PlanHook`, comportement strictement identique** (garde-fou `tests/plan.mjs`). `Plan.refresh()` exposé pour redessiner l'onglet.
- Nouveau fichier `plansync.js`, chargé **après `sync.js`** dans `index.html` (`*.js` est déjà dans le `cp` du workflow) : découpage clé → éléments, `Sync.register("plan", {local, apply})`, `Sync.push` après chaque écriture. `apply` écrit directement dans `localStorage` (pas d'écho) puis déclenche `Plan.refresh()` si l'onglet Plan est ouvert.
- Rythme (déjà fourni par `sync.js`) : au chargement, 300 ms après chaque modification, retour du réseau, page de nouveau visible (donc en rouvrant l'app sur le téléphone). Sans configuration, rien ne s'exécute.
- La Synthèse (« séance prévue ce soir ») lit `Plan.plannedFor` : elle est à jour au prochain changement d'onglet ou rechargement ; je ne la redessine pas en direct (mon choix).

## Hors périmètre
Firebase ; journal muscu ; synchro des préférences d'affichage ; redessin en direct de la Synthèse.

## Étapes
1. `tests/plansync.mjs` d'abord : découpage clé ↔ éléments dans les deux sens, suppression, fusion deux appareils (jeudi / vendredi gardés, même jour = plus récent), `planSince` minimal, fenêtre de 8 semaines, taille.
2. Crochet dans `plan.js` + `plansync.js` + balise dans `index.html`.
3. Vérifier : `node tests/plan.mjs` et `node tests/charge.mjs` inchangés ; faux Apps Script en Node (exécute le vrai `sync.gs` avec un `SpreadsheetApp` simulé) ; deux contextes Chromium (`localhost` / `127.0.0.1`) : scénarios jeudi / vendredi, même jour, suppression, hors ligne puis retour, migration Mac puis téléphone ; 1280 et 390 px, clair et sombre, zéro erreur console.
4. Mettre à jour `CLAUDE.md` (collection `plan`, règles, clés), commits français, `git pull --rebase`, PR **sans fusion**.
5. Après ta fusion : Pages se redéploie seul. Sur chaque appareil, rien à saisir si la synchro est déjà active ; sinon Chaîne > réglages > « Copier le lien de configuration » depuis le Mac, ouvert sur le téléphone.

## Risques connus
Horloges très décalées entre appareils (gagnant inattendu sur un même jour) ; latence d'Apps Script (1 à 2 s) ; un appareil jamais rouvert garde l'ancien plan jusqu'à sa prochaine ouverture.
