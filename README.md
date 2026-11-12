# Gestion immo

Application personnelle de suivi du coût de logements : dépenses et rentrées, catégories, opérations récurrentes, avec plusieurs logements indépendants. L'interface est en français.

## Fonctionnalités

- Plusieurs logements, chacun avec ses propres catégories et opérations.
- Saisie des dépenses et des rentrées ; le solde est calculé (rentrées − dépenses).
- Opérations récurrentes (mensuelles, trimestrielles, annuelles) générées automatiquement jusqu'à aujourd'hui.
- Aperçu des opérations récurrentes de l'année suivante, sans rien écrire.
- Graphiques (histogramme et camemberts) sur la page d'accueil.
- Export et import JSON (import en fusion, sans suppression).
- Sauvegarde quotidienne automatique de la base.

## Prérequis

- Node.js ≥ 22.5 (le stockage utilise le module intégré `node:sqlite`, sans dépendance native).

## Utilisation

```sh
npm install
npm start
```

L'application est alors disponible sur http://localhost:3000.

Les données sont stockées dans un seul fichier, `data/immo.db`, qui n'est pas versionné. Une copie quotidienne est faite dans `data/backups/` (30 conservées). Variables d'environnement : `PORT` (défaut 3000) et `DATA_DIR` (défaut `./data`).

## Développement

```sh
npm run dev        # serveur (port 3000) + Vite (port 5173), rechargement auto
npm test           # tests Vitest
npm run lint       # ESLint
npx tsc            # vérification des types
```

Un hook git pre-commit (activé par `npm install`) lance `tsc`, le lint et les tests avant chaque commit qui touche du code.

## Architecture

- `server/` : API Express et stockage SQLite (`node:sqlite`).
- `src/` : interface en TypeScript sans framework, construite avec Vite.

Le détail de l'architecture et des règles métier est dans [CLAUDE.md](CLAUDE.md).
