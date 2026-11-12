import { api } from "../api";
import { current } from "../state";
import type { Category, Entry } from "../types";
import { $, escapeHtml, fmt, frDate, handler, today } from "../util";

export async function renderOperations(box: HTMLElement): Promise<void> {
  const property = current();
  const base = `/api/properties/${property.id}`;
  const [categories, initial] = await Promise.all([
    api<Category[]>(`${base}/categories`),
    api<Entry[]>(`${base}/entries`),
  ]);
  let entries = initial;

  box.innerHTML = `
    <h1>Opérations — ${escapeHtml(property.name)}</h1>
    <section class="card">
      <h2 id="form-title">Nouvelle opération</h2>
      ${categories.length ? "" : `<p class="error">Ce logement n'a aucune catégorie. <a href="#/categories">Créez-en une</a> avant de saisir.</p>`}
      <form id="form">
        <label>Type
          <select id="type" required>
            <option value="depense">Dépense</option>
            <option value="recette">Rentrée d'argent</option>
          </select>
        </label>
        <label>Date <input id="date" type="date" required value="${today()}" /></label>
        <label>Catégorie
          <select id="category" required>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </label>
        <label>Libellé (facultatif) <input id="label" type="text" maxlength="80" placeholder="Facultatif — ex : Facture plombier" /></label>
        <label>Montant (€) <input id="amount" type="number" min="0.01" step="0.01" required /></label>
        <div class="actions">
          <button type="submit" id="submit" ${categories.length ? "" : "disabled"}>Ajouter</button>
          <button type="button" class="ghost" id="cancel" hidden>Annuler</button>
        </div>
      </form>
    </section>
    <section class="card">
      <h2>Historique</h2>
      <div class="pager" id="pager"></div>
      <table>
        <thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th class="num">Montant</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>`;

  // Pagination par année : on affiche une année à la fois (par défaut l'année en cours, sinon la plus récente).
  const yearsOf = (): string[] => [...new Set(entries.map((e) => e.date.slice(0, 4)))].sort().reverse();
  let year = today().slice(0, 4);
  const fixYear = (): void => {
    const years = yearsOf();
    if (years.length && !years.includes(year)) year = years.find((y) => y < year) ?? years[0];
  };
  fixYear();

  const drawPager = (): void => {
    const years = yearsOf();
    const i = years.indexOf(year);
    $(box, "#pager").innerHTML = years.length
      ? `<button type="button" class="ghost" data-year="${years[i + 1] ?? ""}" ${i < years.length - 1 ? "" : "disabled"}>← ${years[i + 1] ?? ""}</button>
         <select id="year" aria-label="Année">${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select>
         <button type="button" class="ghost" data-year="${years[i - 1] ?? ""}" ${i > 0 ? "" : "disabled"}>${years[i - 1] ?? ""} →</button>
         <span class="muted">${entries.filter((e) => e.date.startsWith(year)).length} opération(s)</span>`
      : "";
  };

  const drawRows = (): void => {
    fixYear();
    drawPager();
    const shown = entries.filter((e) => e.date.startsWith(year));
    $(box, "#rows").innerHTML = shown.length
      ? shown
          .map((e) => `<tr>
              <td>${frDate(e.date)}</td>
              <td>${escapeHtml(e.category)}</td>
              <td>${escapeHtml(e.label)}${e.recurrenceId ? ' <span class="badge" title="Opération créée par une règle récurrente">↻</span>' : ""}</td>
              <td class="num ${e.kind}">${e.kind === "depense" ? "−" : "+"} ${fmt(e.cents)}</td>
              <td class="num">
                <button class="ghost" data-act="edit" data-id="${e.id}">Modifier</button>
                <button class="ghost danger" data-act="delete" data-id="${e.id}" title="Supprimer">✕</button>
              </td>
            </tr>`)
          .join("")
      : `<tr><td colspan="5" class="empty">Aucune opération saisie.</td></tr>`;
  };
  drawRows();

  $(box, "#pager").addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-year]");
    if (!btn?.dataset.year) return;
    year = btn.dataset.year;
    drawRows();
  });
  $(box, "#pager").addEventListener("change", (ev) => {
    if ((ev.target as HTMLElement).id !== "year") return;
    year = (ev.target as HTMLSelectElement).value;
    drawRows();
  });

  let editingId: string | null = null;
  const form = $<HTMLFormElement>(box, "#form");

  const setEditing = (entry: Entry | null): void => {
    editingId = entry?.id ?? null;
    $(box, "#form-title").textContent = entry ? "Modifier l'opération" : "Nouvelle opération";
    $(box, "#submit").textContent = entry ? "Enregistrer" : "Ajouter";
    $(box, "#cancel").hidden = !entry;
    if (entry) {
      $<HTMLSelectElement>(box, "#type").value = entry.kind;
      $<HTMLInputElement>(box, "#date").value = entry.date;
      $<HTMLSelectElement>(box, "#category").value = entry.categoryId;
      $<HTMLInputElement>(box, "#label").value = entry.label;
      $<HTMLInputElement>(box, "#amount").value = (entry.cents / 100).toFixed(2);
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      $<HTMLInputElement>(box, "#label").value = "";
      $<HTMLInputElement>(box, "#amount").value = "";
    }
  };

  form.addEventListener("submit", handler(async (ev) => {
    ev.preventDefault();
    const cents = Math.round(parseFloat($<HTMLInputElement>(box, "#amount").value) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    const payload = {
      kind: $<HTMLSelectElement>(box, "#type").value,
      date: $<HTMLInputElement>(box, "#date").value,
      categoryId: $<HTMLSelectElement>(box, "#category").value,
      label: $<HTMLInputElement>(box, "#label").value.trim(),
      cents,
    };
    try {
      if (editingId) await api(`/api/entries/${encodeURIComponent(editingId)}`, "PUT", payload);
      else await api(`${base}/entries`, "POST", payload);
      entries = await api<Entry[]>(`${base}/entries`);
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    setEditing(null);
    year = payload.date.slice(0, 4);
    drawRows();
  }));

  $(box, "#cancel").addEventListener("click", () => setEditing(null));

  $(box, "#rows").addEventListener("click", handler(async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id ?? "";
    if (btn.dataset.act === "edit") {
      setEditing(entries.find((e) => e.id === id) ?? null);
      return;
    }
    if (!confirm("Supprimer cette opération ?")) return;
    try {
      await api(`/api/entries/${encodeURIComponent(id)}`, "DELETE");
      entries = entries.filter((e) => e.id !== id);
      if (editingId === id) setEditing(null);
      drawRows();
    } catch (err) {
      alert((err as Error).message);
    }
  }));
}
