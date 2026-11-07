// Accès à la base partagé par plusieurs routes.
import { randomUUID } from "node:crypto";
import { row, run } from "./db";
import { HttpError, type cleanEntry } from "./validation";

export const DEFAULT_CATEGORIES = ["Loyer", "Crédit", "Charges", "Taxe foncière", "Assurance", "Travaux", "Entretien", "Autre"];

export function requireProperty(id: string): void {
  if (!row("SELECT id FROM properties WHERE id = ?", id)) throw new HttpError(404, "Logement introuvable.");
}

/** Refuse une catégorie qui n'appartient pas au logement : les catégories sont propres à chaque logement. */
export function assertCategoryInProperty(
  categoryId: string, propertyId: string, message = "Catégorie invalide pour ce logement.",
): void {
  if (!row("SELECT id FROM categories WHERE id = ? AND property_id = ?", categoryId, propertyId))
    throw new HttpError(400, message);
}

/** Id de la catégorie de ce nom dans le logement (insensible à la casse), créée si elle n'existe pas. */
export function findOrCreateCategory(propertyId: string, name: string): string {
  const found = row<{ id: string }>("SELECT id FROM categories WHERE property_id = ? AND name = ?", propertyId, name);
  if (found) return found.id;
  const id = randomUUID();
  run("INSERT INTO categories (id, property_id, name) VALUES (?, ?, ?)", id, propertyId, name);
  return id;
}

/** Crée un logement ; `seed` ajoute les catégories par défaut. */
export function createProperty(name: string, seed: boolean): string {
  const id = randomUUID();
  run("INSERT INTO properties (id, name) VALUES (?, ?)", id, name);
  if (seed) for (const c of DEFAULT_CATEGORIES) findOrCreateCategory(id, c);
  return id;
}

/** Insère ou remplace une opération (même id). Sans `recurrenceId`, le lien existant avec une règle est conservé. */
export function upsertEntry(
  e: ReturnType<typeof cleanEntry>, propertyId: string, categoryId: string, recurrenceId: string | null = null,
): void {
  run(
    `INSERT INTO entries (id, property_id, category_id, kind, date, label, cents, recurrence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET property_id = excluded.property_id, category_id = excluded.category_id,
       kind = excluded.kind, date = excluded.date, label = excluded.label, cents = excluded.cents,
       recurrence_id = COALESCE(excluded.recurrence_id, recurrence_id)`,
    e.id, propertyId, categoryId, e.kind, e.date, e.label, e.cents, recurrenceId,
  );
}
