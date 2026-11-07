export type Kind = "depense" | "recette";
export interface Property { id: string; name: string; entryCount: number }
export interface Category { id: string; name: string; used: number }
export interface Entry {
  id: string;
  kind: Kind;
  date: string; // AAAA-MM-JJ
  categoryId: string;
  category: string;
  label: string;
  cents: number; // montant en centimes (évite les erreurs d'arrondi)
  recurrenceId: string | null; // renseigné si l'opération vient d'une règle récurrente
}
export type Frequency = "monthly" | "quarterly" | "yearly";
export interface Recurrence {
  id: string;
  kind: Kind;
  categoryId: string;
  category: string;
  label: string;
  cents: number;
  frequency: Frequency;
  day: number;
  month: number | null; // échéance annuelle uniquement (1-12)
  startDate: string;
  endDate: string | null;
}
