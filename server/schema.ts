// Schéma de la base et migrations, exécutés à chaque démarrage. Toute évolution doit rester compatible
// avec une base existante de l'utilisateur (voir les migrations conditionnelles ci-dessous).
import { exec, row, rows, run, tx } from "./db";
import { createProperty, findOrCreateCategory } from "./repository";
import type { Kind } from "./validation";

const hasColumn = (table: string, column: string): boolean =>
  rows<{ name: string }>(`PRAGMA table_info(${table})`).some((c) => c.name === column);

export function migrate(): void {
  // Très ancienne version : table `entries` sans logement -> on la met de côté, ses données sont reprises plus bas.
  const entryColumns = rows<{ name: string }>("PRAGMA table_info(entries)");
  const isLegacy = entryColumns.length > 0 && !entryColumns.some((c) => c.name === "property_id");
  if (isLegacy) exec("ALTER TABLE entries RENAME TO entries_old");

  exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      name        TEXT NOT NULL COLLATE NOCASE,
      UNIQUE (property_id, name)
    );
    CREATE TABLE IF NOT EXISTS recurrences (
      id              TEXT PRIMARY KEY,
      property_id     TEXT NOT NULL REFERENCES properties(id),
      category_id     TEXT NOT NULL REFERENCES categories(id),
      kind            TEXT NOT NULL CHECK (kind IN ('depense','recette')),
      label           TEXT NOT NULL,
      cents           INTEGER NOT NULL CHECK (cents > 0),
      frequency       TEXT NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
      day             INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      start_date      TEXT NOT NULL,
      end_date        TEXT,
      generated_until TEXT
    );
    CREATE TABLE IF NOT EXISTS entries (
      id          TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      category_id TEXT NOT NULL REFERENCES categories(id),
      kind        TEXT NOT NULL CHECK (kind IN ('depense','recette')),
      date        TEXT NOT NULL,
      label       TEXT NOT NULL,
      cents       INTEGER NOT NULL CHECK (cents > 0)
    );
    -- Documents du site externe déjà relevés (seen = 0 : nouveau, pas encore vu par l'utilisateur)
    CREATE TABLE IF NOT EXISTS external_documents (
      id       TEXT PRIMARY KEY,
      title    TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      folder   TEXT NOT NULL,
      seen     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS external_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Colonnes ajoutées après coup
  if (!hasColumn("entries", "recurrence_id")) exec("ALTER TABLE entries ADD COLUMN recurrence_id TEXT");
  if (!hasColumn("recurrences", "month")) {
    exec("ALTER TABLE recurrences ADD COLUMN month INTEGER");
    exec("UPDATE recurrences SET month = CAST(substr(start_date, 6, 2) AS INTEGER) WHERE frequency = 'yearly'");
  }

  if (isLegacy) importLegacyEntries();
  if (!row("SELECT id FROM properties LIMIT 1")) createProperty("Mon logement", true);
}

/** Rattache les opérations de l'ancienne table à un logement « Mon logement » et recrée leurs catégories. */
function importLegacyEntries(): void {
  tx(() => {
    const pid = createProperty("Mon logement", false);
    const old = rows<{ id: string; kind: Kind; date: string; category: string; label: string; cents: number }>(
      "SELECT * FROM entries_old",
    );
    for (const o of old) {
      run(
        "INSERT INTO entries (id, property_id, category_id, kind, date, label, cents) VALUES (?, ?, ?, ?, ?, ?, ?)",
        o.id, pid, findOrCreateCategory(pid, o.category), o.kind, o.date, o.label, o.cents,
      );
    }
    exec("DROP TABLE entries_old");
  });
}
