const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const fmt = (cents: number): string => eur.format(cents / 100);
const eurSigned = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", signDisplay: "exceptZero" });
/** Montant avec signe explicite (+ / −), pour un solde. */
export const fmtSigned = (cents: number): string => eurSigned.format(cents / 100);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function $<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Élément ${selector} introuvable`);
  return el;
}

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const frDate = (iso: string): string => iso.split("-").reverse().join("/");

/** Adapte un gestionnaire d'événement asynchrone à addEventListener (qui attend une fonction synchrone).
 *  Le gestionnaire doit gérer lui-même ses erreurs : une promesse rejetée ne serait signalée nulle part. */
export const handler = <E extends Event>(fn: (ev: E) => Promise<void>) => (ev: E): void => {
  void fn(ev);
};
