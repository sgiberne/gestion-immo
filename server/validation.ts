import { randomUUID } from "node:crypto";
import { STEP, type Frequency } from "./recurrence";

export type Kind = "depense" | "recette";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- Validation ---------------------------------------------------------------
export function cleanName(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.trim().length > 80) throw new HttpError(400, "Nom invalide (1 à 80 caractères).");
  return v.trim();
}
export function cleanId(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 100) throw new HttpError(400, "Identifiant invalide.");
  return v;
}
export function cleanEntry(x: any): { id: string; kind: Kind; date: string; label: string; cents: number } {
  if (!x || typeof x !== "object") throw new HttpError(400, "Opération invalide.");
  if (x.kind !== "depense" && x.kind !== "recette") throw new HttpError(400, "Type invalide.");
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || Number.isNaN(Date.parse(x.date)))
    throw new HttpError(400, "Date invalide.");
  if (!Number.isInteger(x.cents) || x.cents <= 0) throw new HttpError(400, "Montant invalide.");
  const id = typeof x.id === "string" && x.id ? x.id : randomUUID();
  const label = typeof x.label === "string" ? x.label.trim() : "";
  if (label.length > 80) throw new HttpError(400, "Libellé trop long (80 caractères maximum).");
  return { id, kind: x.kind, date: x.date, label, cents: x.cents };
}

export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function cleanRule(x: any) {
  const base = cleanEntry({ ...x, date: x?.startDate, id: undefined });
  if (typeof x.frequency !== "string" || !Object.hasOwn(STEP, x.frequency)) throw new HttpError(400, "Fréquence invalide.");
  if (!Number.isInteger(x.day) || x.day < 1 || x.day > 31) throw new HttpError(400, "Jour du mois invalide (1 à 31).");
  let month: number | null = null;
  if (x.frequency === "yearly") {
    if (!Number.isInteger(x.month) || x.month < 1 || x.month > 12) throw new HttpError(400, "Mois invalide (1 à 12).");
    month = x.month;
  }
  let endDate: string | null = null;
  if (x.endDate) {
    if (!isDate(x.endDate)) throw new HttpError(400, "Date de fin invalide.");
    if (x.endDate < base.date) throw new HttpError(400, "La date de fin précède la date de début.");
    endDate = x.endDate;
  }
  return { kind: base.kind, label: base.label, cents: base.cents, startDate: base.date, frequency: x.frequency as Frequency, day: x.day as number, month, endDate };
}
