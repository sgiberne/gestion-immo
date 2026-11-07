import { api } from "../api";
import { renderNameManager, type Item } from "../nameManager";
import { loadProperties, state } from "../state";
import type { Property } from "../types";
import { $, handler } from "../util";

const plural = (n: number): string => `${n} opération${n > 1 ? "s" : ""}`;

export async function renderProperties(box: HTMLElement, refreshMenu: () => void): Promise<void> {
  const manager = document.createElement("div");
  const backup = document.createElement("div");
  box.append(manager, backup);

  await renderNameManager(manager, {
    title: "Logements",
    intro: "Chaque logement a ses propres opérations et catégories. Un logement ne peut être supprimé que s'il ne contient aucune opération.",
    placeholder: "Nom du nouveau logement",
    addLabel: "Ajouter un logement",
    confirmDelete: "Supprimer ce logement ?",
    load: async (): Promise<Item[]> => {
      const list = await api<Property[]>("/api/properties");
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        info: p.entryCount ? plural(p.entryCount) : "Vide",
        blocked: p.entryCount
          ? "Ce logement contient des opérations"
          : list.length <= 1 ? "Impossible de supprimer le seul logement" : undefined,
      }));
    },
    add: (name) => api("/api/properties", "POST", { name }),
    rename: (id, name) => api(`/api/properties/${id}`, "PUT", { name }),
    remove: (id) => api(`/api/properties/${id}`, "DELETE"),
    afterChange: async () => {
      await loadProperties();
      refreshMenu();
    },
  });

  backup.innerHTML = `
    <section class="card">
      <h2>Sauvegarde</h2>
      <p class="muted">L'export contient tous les logements, catégories et opérations. L'import fusionne le fichier avec les données existantes, sans rien supprimer.</p>
      <div class="actions">
        <a class="btn" href="/api/export" download>Exporter (JSON)</a>
        <label class="btn">Importer
          <input id="import" type="file" accept="application/json" hidden />
        </label>
      </div>
    </section>`;

  $<HTMLInputElement>(backup, "#import").addEventListener("change", handler(async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const res = await api<{ imported: number }>(
        `/api/import?property=${encodeURIComponent(state.currentId)}`, "POST", JSON.parse(await file.text()),
      );
      alert(`${res.imported} opération(s) importée(s).`);
      location.reload();
    } catch (err) {
      alert(`Import impossible : ${(err as Error).message}`);
      input.value = "";
    }
  }));
}
