// Données de test réutilisables : constructeurs de payloads et jeux de données, sans dépendance à Vitest
// ni au serveur (utilisables aussi par les tests unitaires).
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Année suivante : sert à tester l'aperçu et les règles qui ne démarrent que dans le futur. */
export const NEXT_YEAR = new Date().getFullYear() + 1;

// --- Entrées brutes (avant ajout d'une catégorie), pour les tests unitaires de validation ----------------

export const validEntry = { kind: "depense", date: "2026-05-10", label: "Plombier", cents: 12345 };

export const validRule = {
  kind: "depense", label: "Loyer", cents: 65000, frequency: "monthly", day: 5, startDate: "2026-01-01",
};

// --- Payloads de l'API ---------------------------------------------------------------------------------

/** Opération prête à poster. Une propriété passée à `undefined` dans `over` est omise du JSON. */
export const entryBody = (categoryId: string | undefined, over: object = {}) => ({
  kind: "depense", date: "2024-05-10", categoryId, label: "Test", cents: 1000, ...over,
});

/** Les 6 échéances de `ruleBody` par défaut : le 31 chaque mois de janvier à juin 2024 (février bissextile). */
export const PAST_RULE_DATES = ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30"];

/** Règle mensuelle terminée dans le passé : son résultat ne dépend pas de la date du jour (voir PAST_RULE_DATES). */
export const ruleBody = (categoryId: string | undefined, over: object = {}) => ({
  kind: "depense", categoryId, label: "Loyer", cents: 65000, frequency: "monthly", day: 31,
  startDate: "2024-01-31", endDate: "2024-06-30", ...over,
});

/** Règle mensuelle (le 1er) qui ne démarre que l'année prochaine : elle ne crée aucune opération aujourd'hui. */
export const futureRuleBody = (categoryId: string | undefined, over: object = {}) =>
  ruleBody(categoryId, { day: 1, startDate: `${NEXT_YEAR}-01-01`, endDate: null, ...over });

/** Dates triées d'une liste d'opérations. */
export const dates = (list: { date: string }[]): string[] => list.map((e) => e.date).sort();

// --- Ancien format d'import (liste d'opérations, catégorie en texte) -------------------------------------

export const legacyImportList = [
  { id: "old-1", kind: "depense", date: "2024-05-05", category: "Nouvelle catégorie", label: "l", cents: 99 },
  { id: "old-2", kind: "recette", date: "2024-05-06", category: "Loyer", label: "", cents: 100 },
];

// --- Fichiers d'import au format version 2 -------------------------------------------------------------

export interface V2File {
  version: 2;
  properties: object[];
  categories: object[];
  recurrences: object[];
  entries: object[];
}

export const v2File = (parts: Partial<Omit<V2File, "version">> = {}): V2File => ({
  version: 2, properties: [], categories: [], recurrences: [], entries: [], ...parts,
});

const importedEntry = (over: object = {}) => ({
  id: "e", propertyId: "p-import", categoryId: "c-import", kind: "depense", date: "2024-01-01", label: "", cents: 100, ...over,
});

/** Un logement avec sa catégorie, sa règle (déjà traitée jusqu'au 01/02) et une opération issue de cette règle. */
export const importedRentalFile = (): V2File =>
  v2File({
    properties: [{ id: "p-import", name: "Importé" }],
    categories: [{ id: "c-import", propertyId: "p-import", name: "Loyer" }],
    recurrences: [{
      id: "r-import", propertyId: "p-import", categoryId: "c-import", kind: "depense", label: "Loyer", cents: 500,
      frequency: "monthly", day: 1, month: null, startDate: "2024-01-01", endDate: "2024-02-01", generatedUntil: "2024-02-01",
    }],
    entries: [importedEntry({ id: "e-import", label: "Loyer", cents: 500, recurrenceId: "r-import" })],
  });

/** Fichier dont la 2e opération est invalide : l'import doit tout refuser, y compris le logement. */
export const fileWithInvalidEntry = (): V2File =>
  v2File({
    properties: [{ id: "p-import", name: "Ne doit pas exister" }],
    categories: [{ id: "c-import", propertyId: "p-import", name: "Loyer" }],
    entries: [importedEntry({ id: "ok" }), importedEntry({ id: "ko", date: "pas une date" })],
  });

/** Opération rattachée à un logement (p-y) alors que sa catégorie appartient à un autre (p-x). */
export const fileWithForeignCategory = (): V2File =>
  v2File({
    properties: [{ id: "p-x", name: "X" }, { id: "p-y", name: "Y" }],
    categories: [{ id: "c-x", propertyId: "p-x", name: "Loyer" }],
    entries: [importedEntry({ propertyId: "p-y", categoryId: "c-x" })],
  });

// --- Ancienne base (avant l'arrivée des logements), pour tester la migration ---------------------------

export const LEGACY_DB_ROWS = [
  ["a", "depense", "2026-11-01", "Loyer", "x", 1000],
  ["b", "recette", "2026-11-02", "Autre", "y", 500],
] as const;

/** Crée dans `dir` une base de l'ancien format : une seule table `entries`, catégorie en texte. */
export function seedLegacyDb(dir: string): void {
  const db = new DatabaseSync(path.join(dir, "immo.db"));
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, kind TEXT, date TEXT, category TEXT, label TEXT, cents INTEGER)");
  const insert = db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of LEGACY_DB_ROWS) insert.run(...r);
  db.close();
}
