// Opérations récurrentes : matérialisation des échéances en opérations réelles, et aperçu.
// Le calcul des dates elles-mêmes est dans recurrence.ts (fonctions pures).
import { randomUUID } from "node:crypto";
import { row, rows, run, tx } from "./db";
import { occurrenceDates, STEP, todayLocal, type Frequency } from "./recurrence";
import { upsertEntry } from "./repository";
import type { Kind } from "./validation";

export interface RuleRow {
  id: string; property_id: string; category_id: string; kind: Kind; label: string; cents: number;
  frequency: Frequency; day: number; month: number | null; start_date: string; end_date: string | null; generated_until: string | null;
}

export const findRule = (id: string): RuleRow | undefined => row<RuleRow>("SELECT * FROM recurrences WHERE id = ?", id);

/** Dernier jour à traiter : aujourd'hui, ou la date de fin de la règle si elle est déjà passée. */
const cutoffOf = (r: RuleRow, today: string): string => (r.end_date && r.end_date < today ? r.end_date : today);

/** Vrai si l'échéance existe déjà : opération de cette règle à cette date, ou opération identique
 *  (même logement, date, type, catégorie, montant) saisie à la main. */
export function occurrenceExists(r: RuleRow, date: string): boolean {
  return !!row(
    `SELECT id FROM entries WHERE property_id = ? AND date = ?
       AND (recurrence_id = ? OR (category_id = ? AND kind = ? AND cents = ?))`,
    r.property_id, date, r.id, r.category_id, r.kind, r.cents,
  );
}

/** Crée les opérations manquantes des échéances de ]from, cutoff], puis avance `generated_until`.
 *  À appeler dans une transaction. Renvoie le nombre d'opérations créées. */
function materialize(r: RuleRow, from: string | null, cutoff: string): number {
  let created = 0;
  for (const date of occurrenceDates(r.start_date, STEP[r.frequency], r.day, r.month, from, cutoff)) {
    if (occurrenceExists(r, date)) continue;
    upsertEntry(
      { id: randomUUID(), kind: r.kind, date, label: r.label, cents: r.cents },
      r.property_id, r.category_id, r.id,
    );
    created++;
  }
  // generated_until ne recule jamais : une échéance déjà traitée n'est pas recréée si on raccourcit puis rallonge la règle
  run(
    "UPDATE recurrences SET generated_until = ? WHERE id = ?",
    r.generated_until && r.generated_until > cutoff ? r.generated_until : cutoff, r.id,
  );
  return created;
}

/** Crée les opérations des échéances dépassées. Une échéance n'est traitée qu'une fois (generated_until),
 *  donc une occurrence supprimée ou modifiée n'est jamais recréée. */
export function generateRecurrences(): void {
  const today = todayLocal();
  const todo = rows<RuleRow>("SELECT * FROM recurrences").filter(
    (r) => r.generated_until === null || cutoffOf(r, today) > r.generated_until,
  );
  if (!todo.length) return;
  tx(() => {
    for (const r of todo) materialize(r, r.generated_until, cutoffOf(r, today));
  });
}

/** Réapplique la règle depuis sa date de début : recrée les échéances manquantes (y compris supprimées). */
export function applyRule(r: RuleRow): number {
  const cutoff = cutoffOf(r, todayLocal());
  return tx(() => materialize(r, null, cutoff));
}

/** Échéances d'une année qui n'existent pas encore, sous forme d'opérations fictives (rien n'est écrit en base). */
export function forecastOccurrences(propertyId: string, year: string): unknown[] {
  const out: unknown[] = [];
  for (const r of rows<RuleRow>("SELECT * FROM recurrences WHERE property_id = ?", propertyId)) {
    const yearEnd = `${year}-12-31`;
    const until = r.end_date && r.end_date < yearEnd ? r.end_date : yearEnd;
    const category = row<{ name: string }>("SELECT name FROM categories WHERE id = ?", r.category_id)?.name ?? "";
    for (const date of occurrenceDates(r.start_date, STEP[r.frequency], r.day, r.month, null, until)) {
      if (!date.startsWith(year) || occurrenceExists(r, date)) continue;
      out.push({
        id: `forecast:${r.id}:${date}`, kind: r.kind, date, categoryId: r.category_id, category,
        label: r.label, cents: r.cents, recurrenceId: r.id,
      });
    }
  }
  return out;
}
