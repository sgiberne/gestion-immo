# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Application personnelle de suivi du coût de logements (dépenses/rentrées, catégories, opérations récurrentes, plusieurs logements indépendants). Interface et messages d'erreur en **français**.

## Commandes

- `npm install` puis `npm start` : build Vite dans `dist/` puis serveur sur http://localhost:3000 (usage quotidien).
- `npm run dev` : serveur (`tsx watch`, port 3000) + Vite (port 5173, proxy `/api` → 3000), rechargement auto.
- `npm test` (Vitest, `vitest run`) : tous les tests ; `npm run test:watch` en continu. Un seul fichier : `npx vitest run server/recurrence.test.ts` ; un seul test : `npx vitest run -t "début de nom du test"`.
- `npm run lint` (ESLint 10, `eslint.config.js`) ; `npm run lint:fix` corrige ce qui est automatique. Il faut garder `npm run lint`, `npx tsc` et `npm test` verts.
- `npx tsc` (ou `npm run build`) : vérification de types, tests compris (`tsconfig` inclut `server/`).
- **Hook git pre-commit** (`.githooks/pre-commit`, versionné) : à chaque `git commit` qui touche du code (`.ts/.js/.json/.html/.css` ou `.githooks/`), lance `npx tsc`, `npm run lint` puis `npm test` et **annule le commit** si l'un échoue ; un commit qui ne touche que de la documentation est ignoré. Il vérifie l'arbre de travail, pas seulement ce qui est indexé. Il est activé par `npm install` (script `prepare` → `git config core.hooksPath .githooks`) ; sur un clone, lancer `npm install` ou `npm run prepare`. Contournement exceptionnel : `git commit --no-verify`. Ne jamais l'utiliser pour faire passer un commit qui casse tsc, le lint ou les tests.
- Variables d'environnement du serveur : `PORT` (défaut 3000), `DATA_DIR` (défaut `./data`), et pour le site externe `SYNDIC_SITE_URL`, `SYNDIC_SITE_USER`, `SYNDIC_SITE_PASSWORD`. `config.ts` charge le fichier `.env` (ignoré par git ; modèle : `.env.example`) ; une variable déjà définie dans l'environnement l'emporte. Pour tester l'API sans toucher aux vraies données, lancer `PORT=3999 DATA_DIR=/chemin/temporaire npx tsx server/index.ts` puis `curl`.
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
  - `pdfAnalysis.ts` + `routes/documents.ts` : `POST /api/documents/analyze` (PDF en base64 JSON, texte extrait par `pdfjs-dist`, registre `ANALYZERS` par type ; « appel_de_fonds » cherche « MONTANT A REGLER ») et `POST /api/properties/:pid/documents/fund-call` (dépense, catégorie « Appel de fonds » créée au besoin). Fixture `pdfWithLines` pour les tests.
  - `externalSite.ts` + `routes/external.ts` : `GET /api/external/documents` (liste des PDF de tous les classeurs de l'extranet du syndic) et `POST /api/external/documents/:id/analyze` (télécharge puis analyse comme un PDF envoyé à la main). Connexion par `fetch` : `POST /authenticate` (JSON `login`/`password`) renvoie un cookie de session ; puis `/api/extranet/coproprietaire/documents/classeur[/id]` et `/api/extranet/documents/download/<id>`. Une connexion par requête, aucun état. Les classeurs sont lus page par page jusqu'à avoir le `fileCount` annoncé ou une page sans document nouveau (le site peut plafonner la taille de page) ; un document sans date garde `date: ""` (non importé, signalé à saisir à la main ; « sans date » dans le ZIP) ; l'import des appels de fonds considère « déjà là » toute dépense de la catégorie ayant même date et même montant, quel que soit le libellé, à raison d'une dépense existante par document ; le ZIP se télécharge 4 PDF à la fois (`pool.ts`, `mapPool`), plafonné à 300 Mo. Erreurs en français : 503 si `.env` est incomplet, 502 si le site refuse ou ne répond pas. Ces chemins ne sont pas documentés par le site : s'ils changent, les relever dans l'onglet Réseau du navigateur. Les tests utilisent le faux site `fixtures/externalSite.ts` ; `testServer.ts` vide `SYNDIC_SITE_*` par défaut pour ne jamais lire le vrai `.env`.
  - Fonctions **pures**, sans base : `recurrence.ts` (`occurrenceDates`, `STEP`, `todayLocal`) et `validation.ts` (`HttpError`, `cleanName/cleanId/cleanEntry/cleanRule`).
  - Base : `data/immo.db` (un seul fichier, c'est ce qui permet de déplacer/sauvegarder le projet). Une copie quotidienne est faite dans `data/backups/` au démarrage (30 conservées).
- **`src/`** (Vite, TypeScript vanilla sans framework) : SPA à routage par hash (`#/`, `#/operations`, `#/recurrentes`, `#/categories`, `#/documents`, `#/logements`). `main.ts` gère menu + routeur + sélecteur de logement ; `pages/` (dont `documents` : envoi d'un PDF, analyse, ajout d'une dépense) contient un module par page (`home`, `operations`, `recurrences`, `categories`, `properties`), réexportés par `pages/index.ts` ; une page est une fonction `renderX(box)` appelée par le routeur ; `chart.ts` les graphiques SVG faits main (histogramme groupé, camemberts, infobulle) ; `nameManager.ts` la page générique « liste de noms » (ajout/modif/suppression) réutilisée par Catégories et Logements ; `state.ts` la liste des logements et le logement courant (mémorisé en localStorage).

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

## Avant chaque commit

- Avant tout `git commit` fait par Claude, lancer `/code-review` sur les changements à commiter.
- S'il y a au moins un retour : le corriger (ou, si c'est un faux positif, le justifier explicitement à l'utilisateur), puis relancer `/code-review`. Répéter jusqu'à ce qu'il ne reste **aucun** retour. Ne pas commiter tant que ce n'est pas le cas.
- Vérifier ensuite `npx tsc`, `npm run lint` et `npm test` (le hook pre-commit les relance de toute façon), puis commiter.
- Un commit qui ne touche que de la documentation est dispensé de revue.

## Conventions de code

- Un fichier = une responsabilité. Au-delà d'environ 300 lignes, découper en modules plutôt que d'agrandir le fichier.
- Ne jamais ajouter de nouvelle page ou de nouveau routeur dans un fichier existant volumineux : créer un module dédié (`src/pages/<nom>.ts`).
- Si une tâche oblige à modifier un fichier de plus de 300 lignes, le signaler et proposer un découpage avant de continuer.
