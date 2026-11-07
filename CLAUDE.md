# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Application personnelle de suivi du coût de logements (dépenses/rentrées, catégories, opérations récurrentes, plusieurs logements indépendants). Interface et messages d'erreur en **français**.

## Commandes

- `npm install` puis `npm start` : build Vite dans `dist/` puis serveur sur http://localhost:3000 (usage quotidien).
- `npm run dev` : serveur (`tsx watch`, port 3000) + Vite (port 5173, proxy `/api` → 3000), rechargement auto.
- `npm test` (Vitest, `vitest run`) : tous les tests ; `npm run test:watch` en continu. Un seul fichier : `npx vitest run server/recurrence.test.ts` ; un seul test : `npx vitest run -t "début de nom du test"`.
- `npm run lint` (ESLint 10, `eslint.config.js`) ; `npm run lint:fix` corrige ce qui est automatique. Il faut garder `npm run lint`, `npx tsc` et `npm test` verts.
- `npx tsc` (ou `npm run build`) : vérification de types, tests compris (`tsconfig` inclut `server/`).
- Variables d'environnement du serveur : `PORT` (défaut 3000), `DATA_DIR` (défaut `./data`). Pour tester l'API sans toucher aux vraies données, lancer `PORT=3999 DATA_DIR=/chemin/temporaire npx tsx server/index.ts` puis `curl`.
- Lint : `typescript-eslint` (règles recommandées) + règles qui utilisent les types (`no-floating-promises`, `no-misused-promises`, `await-thenable`), `eqeqeq`, `prefer-const`, `no-var`. `no-explicit-any` est désactivé uniquement pour les tests, `server/fixtures/`, `server/validation.ts` et `server/importExport.ts` (JSON non typé venant du client, contrôlé champ par champ) ; ailleurs, préférer `unknown`. Un paramètre ou une variable inutilisée doit commencer par `_`.
- `package.json` force `minimatch` ≥ 11.0.5 (`overrides`) : ESLint et typescript-eslint dépendent d'une version signalée par `npm audit`. À retirer quand leurs dépendances seront corrigées ; vérifier alors que `npm audit` reste à 0 vulnérabilité.
- Node ≥ 22.5 requis : le stockage utilise le module intégré `node:sqlite` (aucune dépendance native, volontairement — `better-sqlite3` ne compile pas sur Node 26).

## Architecture

Deux parties dans un seul package, TypeScript strict :

- **`server/`** (Express 4 + `node:sqlite`), un module par responsabilité :
  - `index.ts` : point d'entrée, **l'ordre y est important** — créer `data/backups/`, sauvegarde quotidienne, `openDb`, `migrate`, `generateRecurrences`, puis `createApp().listen`. La sauvegarde doit précéder l'ouverture de la base (sinon on copierait un fichier neuf et vide).
  - `config.ts` (chemins, `PORT`, `DATA_DIR`), `db.ts` (connexion unique ouverte par `openDb`, helpers `rows/row/run/exec/tx` — rien ne marche avant `openDb`), `dailyBackup.ts`.
  - `schema.ts` : `migrate()`, schéma + migrations conditionnelles (voir « Migrations »).
  - `app.ts` : `createApp()` — JSON, génération des récurrences avant chaque requête `/api`, routeurs, gestionnaire d'erreurs, service de `dist/`.
  - `routes/` : un routeur par ressource (`properties`, `categories`, `entries`, `recurrences`, `dataTransfer`), montés sous `/api`. Les routes lèvent des `HttpError` ; le gestionnaire d'erreurs d'`app.ts` les convertit en JSON `{ error }` (erreurs `UNIQUE` → 409 ; erreurs 4xx du parseur JSON d'Express — JSON mal formé, corps ni objet ni liste → 400, trop gros → 413 ; tout le reste → 500).
  - `repository.ts` : accès base partagé entre routes (`requireProperty`, `assertCategoryInProperty`, `findOrCreateCategory`, `createProperty`, `upsertEntry`).
  - `recurrenceService.ts` : récurrences côté base (`generateRecurrences`, `applyRule`, `forecastOccurrences`, `occurrenceExists`). `importExport.ts` : export et import en fusion.
  - Fonctions **pures**, sans base : `recurrence.ts` (`occurrenceDates`, `STEP`, `todayLocal`) et `validation.ts` (`HttpError`, `cleanName/cleanId/cleanEntry/cleanRule`).
  - Base : `data/immo.db` (un seul fichier, c'est ce qui permet de déplacer/sauvegarder le projet). Une copie quotidienne est faite dans `data/backups/` au démarrage (30 conservées).
- **`src/`** (Vite, TypeScript vanilla sans framework) : SPA à routage par hash (`#/`, `#/operations`, `#/recurrentes`, `#/categories`, `#/logements`). `main.ts` gère menu + routeur + sélecteur de logement ; `pages.ts` contient toutes les pages (Accueil, Opérations, Récurrentes, Catégories, Logements) ; `chart.ts` les graphiques SVG faits main (histogramme groupé, camemberts, infobulle) ; `nameManager.ts` la page générique « liste de noms » (ajout/modif/suppression) réutilisée par Catégories et Logements ; `state.ts` la liste des logements et le logement courant (mémorisé en localStorage).

### Modèle de données et règles métier à connaître

- **Isolation par logement** : `categories`, `entries` et `recurrences` appartiennent à un `property_id`. Les catégories sont propres à chaque logement ; le serveur vérifie qu'une opération/règle n'utilise qu'une catégorie de son logement.
- **Montants en centimes (entiers)** partout, du formulaire à la base (`cents`). Formatage via `fmt`/`fmtSigned` dans `src/util.ts`. Les dates sont des chaînes `AAAA-MM-JJ`, comparées lexicalement.
- **Suppressions refusées (409)** : catégorie utilisée par une opération *ou une règle* ; logement contenant des opérations ; dernier logement restant.
- **Solde** = rentrées − dépenses (positif = gain), affiché avec signe.
- **Récurrences** (`recurrences`, fréquences `monthly|quarterly|yearly`) :
  - Les opérations sont **matérialisées** dans `entries` (colonne `recurrence_id`) par `generateRecurrences()` (`recurrenceService.ts`), appelée au démarrage et avant chaque requête `/api`, jusqu'à aujourd'hui (jamais dans le futur).
  - `generated_until` garantit qu'une échéance n'est traitée qu'une fois : une occurrence supprimée ou modifiée n'est **pas** recréée. Le bouton « Appliquer » (`POST /api/recurrences/:id/apply`) rejoue tout depuis la date de début.
  - `occurrenceExists` évite les doublons (même règle + date, ou opération identique saisie à la main : même date/type/catégorie/montant). Partagé par la génération auto, « Appliquer » et l'aperçu.
  - Annuelle : le mois (`month`) est indépendant de la date de début ; un jour inexistant est ramené au dernier jour du mois.
  - Modifier une règle n'affecte que les échéances futures ; la date de début est figée ; supprimer une règle conserve les opérations déjà créées.
  - `GET /api/properties/:pid/forecast?year=` calcule l'aperçu de l'année suivante **sans rien écrire** ; le client le fusionne avec les opérations déjà saisies cette année-là.
- **Migrations** : `migrate()` dans `server/schema.ts`, exécutée à chaque démarrage (renommage de l'ancienne table `entries` sans logement → création de « Mon logement » ; `ALTER TABLE` conditionnels pour `recurrence_id` et `month`). Toute évolution de schéma doit rester compatible avec une base existante de l'utilisateur dans `data/`.
- **Export/Import** (`/api/export`, `/api/import`) : JSON `version: 2` (logements, catégories, règles, opérations), import en **fusion** (jamais de suppression). L'import accepte aussi l'ancien format (liste d'opérations avec catégorie en texte, rattachée au logement indiqué en `?property=`).

### Tests (Vitest, dossier `server/`)

- `recurrence.test.ts` et `validation.test.ts` : tests unitaires des fonctions pures (échéances mensuelles/trimestrielles/annuelles, jours inexistants, années bissextiles, bornes `from`/`until` ; règles de validation).
- `api.test.ts` : tests d'intégration. Les modules dépendent de la connexion ouverte par `index.ts` : `testServer.ts` lance donc le **vrai** `server/index.ts` dans un processus (`node --import tsx`) avec un `PORT` libre et un `DATA_DIR` temporaire, puis les tests appellent l'API par `fetch`. Les vraies données de `data/` ne sont jamais touchées.
- **Fixtures** (`server/fixtures/`) — à réutiliser plutôt que de redéfinir des payloads dans les tests :
  - `data.ts` (pur, sans Vitest) : constructeurs `entryBody`, `ruleBody` (règle mensuelle terminée dans le passé, échéances = `PAST_RULE_DATES`), `futureRuleBody` (démarre l'an prochain, ne crée rien aujourd'hui), `NEXT_YEAR` ; entrées brutes `validEntry`/`validRule` ; fichiers d'import (`v2File`, `importedRentalFile`, `fileWithInvalidEntry`, `fileWithForeignCategory`, `legacyImportList`) ; `seedLegacyDb` pour une ancienne base sans logements.
  - `api.ts` : classe `Api` (client JSON + raccourcis `property`, `categoryId`, `addEntry`, `addRule`, `entries`, `rules`, `entryOn`), `useTestServer()` (un serveur pour tout le fichier), `withTestServer(fn, seed?)` (serveur éphémère : base neuve ou préparée), scénario `rentalWithPastRule`.
- Les tests doivent rester **indépendants de la date du jour** : règle terminée dans le passé (`endDate` fixe) ou année dérivée de `NEXT_YEAR` pour l'aperçu.

### Pièges côté interface

- Un gestionnaire d'événement `async` se passe à `addEventListener` via `handler(async (ev) => …)` (`src/util.ts`), sinon le lint refuse (`no-misused-promises`) ; il doit gérer lui-même ses erreurs (try/catch + `alert`), car une promesse rejetée ne serait signalée nulle part.
- Les listeners d'une page doivent être attachés **une seule fois** sur l'élément `box` que le routeur crée à chaque navigation ; redessiner via `innerHTML` sur un sous-élément, pas sur `box`.
- `attachTooltip` ajoute un `<div>` dans son conteneur : ce conteneur doit être stable (les graphiques sont rendus dans un `*-body` enfant), sinon l'infobulle est détruite au rafraîchissement.
- Couleurs des graphiques : tokens `--income` / `--expense` dans `src/style.css`, palette catégorielle dans `src/chart.ts` (couleur par catégorie, ordre alphabétique, au-delà de 8 → « Autres »). Thème clair uniquement.
