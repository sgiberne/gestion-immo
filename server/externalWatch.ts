// Suivi des documents du site externe : vérification quotidienne, détection des nouveaux.
import { row, rows, run, tx } from "./db";
import { isExternalConfigured, listExternalDocuments, type ExternalDocument } from "./externalSite";
import { todayLocal } from "./recurrence";

const HOUR_MS = 3_600_000;

export function lastCheck(): string | null {
  return row<{ value: string }>("SELECT value FROM external_state WHERE key = 'last_check'")?.value ?? null;
}

/**
 * Enregistre les documents relevés sur le site. Le tout premier relevé sert de référence (tout est
 * considéré comme déjà vu) ; ensuite, un document inconnu est « nouveau » jusqu'à `markAllSeen`.
 */
export function recordDocuments(docs: ExternalDocument[]): void {
  tx(() => {
    const seen = lastCheck() === null ? 1 : 0;
    for (const d of docs) {
      run("INSERT OR IGNORE INTO external_documents (id, title, doc_date, folder, seen) VALUES (?, ?, ?, ?, ?)",
        d.id, d.title, d.date, d.folder, seen);
    }
    run("INSERT INTO external_state (key, value) VALUES ('last_check', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      todayLocal());
  });
}

/** Documents relevés mais pas encore marqués comme vus, du plus récent au plus ancien. */
export function newDocuments(): ExternalDocument[] {
  return rows<{ id: string; title: string; doc_date: string; folder: string }>(
    "SELECT * FROM external_documents WHERE seen = 0 ORDER BY doc_date DESC, title",
  ).map((r) => ({ id: r.id, title: r.title, date: r.doc_date, folder: r.folder }));
}

export function markAllSeen(): void {
  run("UPDATE external_documents SET seen = 1 WHERE seen = 0");
}

/** Relève la liste du site une fois par jour (sans effet si le site n'est pas configuré ou déjà relevé aujourd'hui). */
export async function checkOncePerDay(): Promise<void> {
  if (!isExternalConfigured() || lastCheck() === todayLocal()) return;
  try {
    recordDocuments(await listExternalDocuments());
  } catch (err) {
    // pas de date enregistrée : on réessaiera au prochain passage
    console.warn("Vérification des documents du site externe impossible :", err instanceof Error ? err.message : err);
  }
}

/** Vérifie au démarrage, puis toutes les heures (le changement de jour déclenche alors le relevé). */
export function startExternalWatch(): void {
  void checkOncePerDay();
  setInterval(() => void checkOncePerDay(), HOUR_MS).unref();
}
