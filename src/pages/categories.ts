import { api } from "../api";
import { renderNameManager, type Item } from "../nameManager";
import { current } from "../state";
import type { Category } from "../types";
import { escapeHtml } from "../util";

const usage = (n: number): string => `${n} utilisation${n > 1 ? "s" : ""}`;

export function renderCategories(box: HTMLElement): Promise<void> {
  const property = current();
  const base = `/api/properties/${property.id}/categories`;
  return renderNameManager(box, {
    title: `Catégories — ${escapeHtml(property.name)}`,
    intro: "Les catégories sont propres à chaque logement. Une catégorie utilisée par une opération ou une règle récurrente ne peut pas être supprimée.",
    placeholder: "Nouvelle catégorie",
    addLabel: "Ajouter",
    confirmDelete: "Supprimer cette catégorie ?",
    load: async (): Promise<Item[]> =>
      (await api<Category[]>(base)).map((c) => ({
        id: c.id,
        name: c.name,
        info: c.used ? usage(c.used) : "Non utilisée",
        blocked: c.used ? `Utilisée (${usage(c.used)})` : undefined,
      })),
    add: (name) => api(base, "POST", { name }),
    rename: (id, name) => api(`/api/categories/${id}`, "PUT", { name }),
    remove: (id) => api(`/api/categories/${id}`, "DELETE"),
  });
}
