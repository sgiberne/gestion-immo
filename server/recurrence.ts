// Calcul des échéances des opérations récurrentes (fonctions pures, sans accès à la base).

export type Frequency = "monthly" | "quarterly" | "yearly";
export const STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const pad = (n: number): string => String(n).padStart(2, "0");
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dates d'échéance dans ]from, until] (jour ramené au dernier jour du mois s'il n'existe pas). */
export function occurrenceDates(
  startDate: string, step: number, day: number, month: number | null, from: string | null, until: string,
): string[] {
  const out: string[] = [];
  const [sy, startMonth] = startDate.split("-").map(Number);
  const sm = month ?? startMonth; // échéance annuelle : mois choisi, indépendant de la date de début
  for (let n = 0; n < 5000; n++) {
    const idx = sm - 1 + n * step;
    const y = sy + Math.floor(idx / 12);
    const m = idx % 12;
    const date = `${y}-${pad(m + 1)}-${pad(Math.min(day, new Date(y, m + 1, 0).getDate()))}`;
    if (date > until) break;
    if (date >= startDate && (from === null || date > from)) out.push(date);
  }
  return out;
}
