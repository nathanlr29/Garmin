# Mes kilomètres : tableau de bord Garmin Connect

Une page perso qui affiche tes km de l'année, ton objectif, tes records et des anecdotes. Elle se met à jour toute seule toutes les heures avec tes activités **Garmin Connect**, et c'est hébergé gratuitement sur GitHub Pages.

Compte environ 15 minutes pour l'installation, à faire une seule fois.

> Garmin ne propose pas d'API officielle aux particuliers. Ce projet utilise la bibliothèque open source `garminconnect`, qui passe par la même connexion que l'app Garmin Connect. Ça marche bien aujourd'hui, mais Garmin peut changer des choses de son côté. Dans ce cas, il suffira en général d'attendre une mise à jour de la bibliothèque (le site l'installe automatiquement).

---

## 1. Mettre le site sur GitHub (5 min)

1. Crée un compte sur https://github.com si tu n'en as pas.
2. Clique sur **New repository** (le bouton « + » en haut à droite) :
   - Nom : par exemple `mes-km`
   - **Public** (GitHub Pages gratuit exige un dépôt public, voir « Confidentialité » plus bas)
   - Clique sur **Create repository**.
3. Sur la page du dépôt vide, clique sur **uploading an existing file**.
4. Dans le Finder, ouvre le dossier dézippé `mes-km` et appuie sur **Cmd + Maj + .** pour afficher les fichiers cachés. Le dossier `.github` doit apparaître : il est indispensable.
5. Sélectionne **tout le contenu** du dossier (pas le dossier lui-même), glisse-le dans la page GitHub, puis clique sur **Commit changes**.
   - Vérifie ensuite que `.github/workflows/update.yml` apparaît bien dans le dépôt. Sinon, crée le fichier à la main : **Add file › Create new file**, nom `.github/workflows/update.yml`, et colles-y le contenu du fichier.

> Juste après l'upload, l'onglet *Actions* affichera un échec rouge : c'est normal, les secrets ne sont pas encore là.

## 2. Créer tes jetons Garmin sur ton Mac (5 min)

On se connecte **une seule fois** depuis ton Mac. Ça gère aussi le code de vérification si tu as activé la double authentification. Ton mot de passe n'est ni enregistré ni envoyé à GitHub.

1. Ouvre le **Terminal** (Cmd + Espace, puis tape « Terminal »).
2. Installe **uv**, un petit outil qui télécharge tout seul la bonne version de Python :

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

   Puis **ferme le Terminal et rouvre-le**.
3. Va dans le dossier `scripts` du projet dézippé et lance la connexion. Adapte le chemin si le dossier n'est pas dans Téléchargements :

   ```bash
   cd ~/Downloads/mes-km/scripts
   uv run --python 3.12 --with garminconnect garmin_setup.py
   ```

4. Entre ton e-mail et ton mot de passe Garmin, et le code de vérification si on te le demande.
5. Le script affiche **deux valeurs** : `GARMIN_TOKENS` (une longue ligne qui commence par `{`) et `GARMIN_KEY`. Garde le Terminal ouvert pour l'étape suivante.

## 3. Ajouter tes 2 secrets dans GitHub (2 min)

Dans le dépôt, va dans **Settings › Secrets and variables › Actions › New repository secret** et crée :

| Nom | Valeur |
|---|---|
| `GARMIN_TOKENS` | la longue ligne `{"di_token": ...}`, copiée en entier, accolades comprises |
| `GARMIN_KEY` | la seconde valeur |

Les secrets restent invisibles, même si le dépôt est public.

## 4. Activer la page (2 min)

1. Va dans **Settings › Pages**. Sous *Build and deployment › Source*, choisis **GitHub Actions**.
2. Va dans l'onglet **Actions**, clique sur **Mise à jour Garmin** à gauche, puis sur **Run workflow** et encore **Run workflow**.
3. Attends 1 à 2 minutes que la pastille passe au vert. Ta page est en ligne à :
   **`https://TON-PSEUDO.github.io/mes-km/`**

## 5. L'installer comme une app sur l'iPhone

Ouvre l'adresse dans **Safari**, puis **Partager › Sur l'écran d'accueil**. Tu obtiens une icône « Mes km » qui s'ouvre en plein écran. Sur PC, mets simplement la page en favori.

---

## Utilisation

- **Mise à jour automatique** : toutes les heures. GitHub peut parfois décaler de quelques minutes.
- **Forcer une mise à jour** : clique sur le lien « Forcer la mise à jour » en haut de la page, puis **Run workflow**. Ça marche aussi depuis l'app GitHub sur iPhone. La page se rafraîchit toute seule quand tu reviens dessus.
- **Changer ton objectif** : dans le dépôt, ouvre `config.json`, clique sur le crayon et modifie `objectif_km`. Le site se met à jour en environ 1 minute.

```json
{
  "titre": "Mes kilomètres",
  "objectif_km": 8000,
  "ville": "Rennes",
  "rayon_confidentialite_m": 400
}
```

- `ville` : sert aux anecdotes du type « Rennes → Marseille ».
- `rayon_confidentialite_m` : les traces GPS sont coupées dans ce rayon autour du départ et de l'arrivée, pour que ton domicile n'apparaisse jamais.

## Comment les jetons restent valides

Garmin renouvelle régulièrement les jetons de connexion. À chaque passage, le site enregistre les plus récents dans `.garmin/tokens.enc`, **chiffrés** (AES-256) avec ta `GARMIN_KEY`. Sans cette clé, le fichier est illisible, même dans un dépôt public. Tu n'as donc rien à refaire tant que tu ne te déconnectes pas de tous tes appareils sur Garmin et que tu ne changes pas ton mot de passe.

## Confidentialité

- Le dépôt et la page sont **publics mais non référencés** : la page bloque les moteurs de recherche, et il faut connaître l'adresse pour la trouver.
- Ce qui est visible : le nom, la date, la distance, le D+, la durée, la FC, la puissance et les calories de tes activités, ainsi que les **30 dernières traces, sans le départ ni l'arrivée**.
- Ton mot de passe Garmin n'est stocké nulle part (sauf si tu utilises le plan B ci-dessous).
- Pour un dépôt privé, il faut un abonnement GitHub Pro (4 $/mois).

## En cas de souci

- **Pastille rouge dans Actions** : clique dessus pour lire le message, qui est en français.
  - « Garmin refuse les jetons » : refais l'étape 2 et remplace le secret `GARMIN_TOKENS`.
  - « Garmin limite les requêtes (429) » : rien à faire, le passage suivant réessaiera.
- **La page affiche « Pas encore de données »** : lance le workflow à la main (étape 4.2).
- **Tout re-télécharger** : Run workflow, puis coche « Tout re-télécharger ». C'est de toute façon fait automatiquement une fois par jour.
- **Plan B, si l'étape 2 ne marche pas sur ton Mac** (uniquement si ton compte Garmin n'a **pas** la double authentification) : à la place de `GARMIN_TOKENS`, crée les secrets `GARMIN_EMAIL` et `GARMIN_PASSWORD`, en gardant `GARMIN_KEY` (invente une longue phrase au hasard). Une fois qu'un premier passage a réussi, tu peux supprimer ces deux secrets : les jetons chiffrés prennent le relais. Inconvénient : Garmin bloque parfois les connexions venant des serveurs de GitHub.
