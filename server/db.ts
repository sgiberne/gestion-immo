import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Connexion unique, ouverte explicitement par index.ts (openDb) une fois la sauvegarde quotidienne faite.
let db: DatabaseSync | undefined;

function conn(): DatabaseSync {
  if (!db) throw new Error("La base de données n'est pas ouverte (appeler openDb d'abord).");
  return db;
}

export function openDb(file: string): void {
  db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
}

export const exec = (sql: string): void => conn().exec(sql);
export const rows = <T>(sql: string, ...p: SQLInputValue[]) => conn().prepare(sql).all(...p) as T[];
export const row = <T>(sql: string, ...p: SQLInputValue[]) => conn().prepare(sql).get(...p) as T | undefined;
export const run = (sql: string, ...p: SQLInputValue[]) => conn().prepare(sql).run(...p);

/** Exécute fn dans une transaction (annulée si fn lève une erreur). */
export function tx<T>(fn: () => T): T {
  exec("BEGIN");
  try {
    const r = fn();
    exec("COMMIT");
    return r;
  } catch (err) {
    exec("ROLLBACK");
    throw err;
  }
}
