// Export complet en JSON et import en fusion (même id = remplacé, rien n'est jamais supprimé).
import { row, rows, run, tx } from "./db";
import { assertCategoryInProperty, findOrCreateCategory, requireProperty, upsertEntry } from "./repository";
import { cleanEntry, cleanId, cleanName, cleanRule, HttpError, isDate } from "./validation";

export function exportAll() {
  return {
    version: 2,
    properties: rows("SELECT id, name FROM properties ORDER BY name"),
    categories: rows("SELECT id, property_id AS propertyId, name FROM categories ORDER BY name"),
    recurrences: rows(
      `SELECT id, property_id AS propertyId, category_id AS categoryId, kind, label, cents, frequency, day, month,
              start_date AS startDate, end_date AS endDate, generated_until AS generatedUntil FROM recurrences`,
    ),
    entries: rows(
      `SELECT id, property_id AS propertyId, category_id AS categoryId, kind, date, label, cents,
              recurrence_id AS recurrenceId FROM entries ORDER BY date`,
    ),
  };
}

const list = (v: unknown): any[] => {
  if (!Array.isArray(v)) throw new HttpError(400, "Format invalide.");
  return v;
};

/** Importe un fichier (format version 2, ou ancienne liste d'opérations). Tout ou rien. Renvoie le nombre d'opérations. */
export function importData(body: any, wantedPropertyId: string): number {
  return tx(() => (body && body.version === 2 ? importV2(body) : importLegacy(body, wantedPropertyId)));
}

/** Logement + catégorie d'une ligne du fichier ; la catégorie a pu être fusionnée avec une existante (idMap). */
function resolveOwner(x: any, idMap: Map<string, string>): { pid: string; cid: string } {
  const pid = cleanId(x?.propertyId);
  requireProperty(pid);
  const cid = idMap.get(cleanId(x?.categoryId)) ?? cleanId(x?.categoryId);
  assertCategoryInProperty(cid, pid, "Catégorie inconnue dans le fichier.");
  return { pid, cid };
}

function importV2(body: any): number {
  for (const p of list(body.properties)) {
    run(
      "INSERT INTO properties (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      cleanId(p?.id), cleanName(p?.name),
    );
  }

  // Une catégorie du fichier de même nom qu'une existante (même logement) est fusionnée avec elle.
  const idMap = new Map<string, string>();
  for (const c of list(body.categories)) {
    const pid = cleanId(c?.propertyId);
    requireProperty(pid);
    const name = cleanName(c?.name);
    const existing = row<{ id: string }>("SELECT id FROM categories WHERE property_id = ? AND name = ?", pid, name);
    const id = existing?.id ?? cleanId(c?.id);
    if (!existing) run("INSERT INTO categories (id, property_id, name) VALUES (?, ?, ?)", id, pid, name);
    idMap.set(cleanId(c?.id), id);
  }

  const ruleIds = new Set<string>();
  for (const x of list(body.recurrences ?? [])) {
    const { pid, cid } = resolveOwner(x, idMap);
    const r = cleanRule(x);
    const id = cleanId(x?.id);
    ruleIds.add(id);
    run(
      `INSERT INTO recurrences (id, property_id, category_id, kind, label, cents, frequency, day, month, start_date, end_date, generated_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET property_id = excluded.property_id, category_id = excluded.category_id,
         kind = excluded.kind, label = excluded.label, cents = excluded.cents, frequency = excluded.frequency,
         day = excluded.day, month = excluded.month, start_date = excluded.start_date, end_date = excluded.end_date,
         generated_until = excluded.generated_until`,
      id, pid, cid, r.kind, r.label, r.cents, r.frequency, r.day, r.month, r.startDate, r.endDate,
      isDate(x?.generatedUntil) ? x.generatedUntil : null,
    );
  }

  const entries = list(body.entries);
  for (const x of entries) {
    const { pid, cid } = resolveOwner(x, idMap);
    upsertEntry(cleanEntry(x), pid, cid, ruleIds.has(x?.recurrenceId) ? x.recurrenceId : null);
  }
  return entries.length;
}

/** Ancien format : liste d'opérations avec la catégorie en texte -> logement indiqué, sinon le premier. */
function importLegacy(body: any, wantedPropertyId: string): number {
  const items = list(Array.isArray(body) ? body : body?.entries);
  const pid = row<{ id: string }>("SELECT id FROM properties WHERE id = ?", wantedPropertyId)?.id
    ?? row<{ id: string }>("SELECT id FROM properties ORDER BY name LIMIT 1")!.id;
  for (const x of items) upsertEntry(cleanEntry(x), pid, findOrCreateCategory(pid, cleanName(x?.category)));
  return items.length;
}
