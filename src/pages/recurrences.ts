import { api } from "../api";
import { current } from "../state";
import type { Category, Frequency, Recurrence } from "../types";
import { $, escapeHtml, fmt, frDate, handler, today } from "../util";

const FREQUENCIES: Record<Frequency, string> = { monthly: "Chaque mois", quarterly: "Chaque trimestre", yearly: "Chaque année" };

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const two = (n: number): string => String(n).padStart(2, "0");

export async function renderRecurrences(box: HTMLElement): Promise<void> {
  const property = current();
  const base = `/api/properties/${property.id}`;
  const categories = await api<Category[]>(`${base}/categories`);
  let rules = await api<Recurrence[]>(`${base}/recurrences`);

  box.innerHTML = `
    <h1>Opérations récurrentes — ${escapeHtml(property.name)}</h1>
    <p class="muted">Une règle crée automatiquement une opération à chaque échéance (jusqu'à aujourd'hui). Les opérations créées apparaissent dans l'historique avec ↻ et restent modifiables une par une.</p>
    <section class="card">
      <h2 id="form-title">Nouvelle règle</h2>
      ${categories.length ? "" : `<p class="error">Ce logement n'a aucune catégorie. <a href="#/categories">Créez-en une</a> avant de saisir.</p>`}
      <form id="form">
        <label>Type
          <select id="type">
            <option value="depense">Dépense</option>
            <option value="recette">Rentrée d'argent</option>
          </select>
        </label>
        <label>Catégorie
          <select id="category" required>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </label>
        <label>Libellé (facultatif) <input id="label" type="text" maxlength="80" placeholder="Ex : Loyer appartement" /></label>
        <label>Montant (€) <input id="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>Fréquence
          <select id="frequency">
            ${(Object.keys(FREQUENCIES) as Frequency[]).map((f) => `<option value="${f}">${FREQUENCIES[f]}</option>`).join("")}
          </select>
        </label>
        <label><span id="day-text">Jour du mois</span>
          <span class="inline-fields">
            <input id="day" type="number" min="1" max="31" step="1" value="1" required />
            <select id="month" hidden>
              ${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}
            </select>
          </span>
        </label>
        <label>Début <input id="start" type="date" required value="${today()}" /></label>
        <label>Fin (facultative) <input id="end" type="date" /></label>
        <div class="actions">
          <button type="submit" id="submit" ${categories.length ? "" : "disabled"}>Ajouter</button>
          <button type="button" class="ghost" id="cancel" hidden>Annuler</button>
        </div>
      </form>
    </section>
    <section class="card">
      <h2>Règles</h2>
      <table>
        <thead><tr><th>Libellé</th><th>Catégorie</th><th class="num">Montant</th><th>Rythme</th><th>Période</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>`;

  const drawRows = (): void => {
    const now = today();
    $(box, "#rows").innerHTML = rules.length
      ? rules
          .map((r) => {
            const ended = r.endDate !== null && r.endDate < now;
            const period = `Depuis le ${frDate(r.startDate)}${r.endDate ? ` jusqu'au ${frDate(r.endDate)}` : ""}`;
            return `<tr>
              <td>${escapeHtml(r.label)}</td>
              <td>${escapeHtml(r.category)}</td>
              <td class="num ${r.kind}">${r.kind === "depense" ? "−" : "+"} ${fmt(r.cents)}</td>
              <td>${FREQUENCIES[r.frequency]}, le ${r.frequency === "yearly" ? `${two(r.day)}/${two(r.month ?? 1)}` : r.day}</td>
              <td>${period}${ended ? ' <span class="badge">Terminée</span>' : ""}</td>
              <td class="num">
                <button class="ghost" data-act="apply" data-id="${r.id}" title="Crée les opérations manquantes depuis la date de début">Appliquer</button>
                <button class="ghost" data-act="edit" data-id="${r.id}">Modifier</button>
                ${r.endDate ? "" : `<button class="ghost" data-act="stop" data-id="${r.id}">Arrêter</button>`}
                <button class="ghost danger" data-act="delete" data-id="${r.id}">Supprimer</button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="empty">Aucune règle récurrente.</td></tr>`;
  };
  drawRows();

  let editingId: string | null = null;
  const form = $<HTMLFormElement>(box, "#form");

  // Échéance annuelle : on saisit la date exacte (jour + mois)
  const syncFrequency = (): void => {
    const yearly = $<HTMLSelectElement>(box, "#frequency").value === "yearly";
    $<HTMLSelectElement>(box, "#month").hidden = !yearly;
    $(box, "#day-text").textContent = yearly ? "Date de l'échéance (jour / mois)" : "Jour du mois";
  };
  $(box, "#frequency").addEventListener("change", syncFrequency);
  $<HTMLSelectElement>(box, "#month").value = String(new Date().getMonth() + 1);

  const setEditing = (r: Recurrence | null): void => {
    editingId = r?.id ?? null;
    $(box, "#form-title").textContent = r ? "Modifier la règle (s'applique aux prochaines échéances)" : "Nouvelle règle";
    $(box, "#submit").textContent = r ? "Enregistrer" : "Ajouter";
    $(box, "#cancel").hidden = !r;
    $<HTMLInputElement>(box, "#start").disabled = r !== null; // la date de début est figée
    if (r) {
      $<HTMLSelectElement>(box, "#type").value = r.kind;
      $<HTMLSelectElement>(box, "#category").value = r.categoryId;
      $<HTMLInputElement>(box, "#label").value = r.label;
      $<HTMLInputElement>(box, "#amount").value = (r.cents / 100).toFixed(2);
      $<HTMLSelectElement>(box, "#frequency").value = r.frequency;
      $<HTMLInputElement>(box, "#day").value = String(r.day);
      $<HTMLSelectElement>(box, "#month").value = String(r.month ?? new Date().getMonth() + 1);
      $<HTMLInputElement>(box, "#start").value = r.startDate;
      $<HTMLInputElement>(box, "#end").value = r.endDate ?? "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      $<HTMLInputElement>(box, "#label").value = "";
      $<HTMLInputElement>(box, "#amount").value = "";
      $<HTMLInputElement>(box, "#end").value = "";
      $<HTMLInputElement>(box, "#day").value = "1";
    }
    syncFrequency();
  };

  const toPayload = (r: Recurrence, endDate: string | null) => ({
    kind: r.kind, categoryId: r.categoryId, label: r.label, cents: r.cents,
    frequency: r.frequency, day: r.day, month: r.month, startDate: r.startDate, endDate,
  });

  const save = async (fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      rules = await api<Recurrence[]>(`${base}/recurrences`);
      drawRows();
      return true;
    } catch (err) {
      alert((err as Error).message);
      return false;
    }
  };

  form.addEventListener("submit", handler(async (ev) => {
    ev.preventDefault();
    const cents = Math.round(parseFloat($<HTMLInputElement>(box, "#amount").value) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    const payload = {
      kind: $<HTMLSelectElement>(box, "#type").value,
      categoryId: $<HTMLSelectElement>(box, "#category").value,
      label: $<HTMLInputElement>(box, "#label").value.trim(),
      cents,
      frequency: $<HTMLSelectElement>(box, "#frequency").value,
      day: Number($<HTMLInputElement>(box, "#day").value),
      month: $<HTMLSelectElement>(box, "#frequency").value === "yearly" ? Number($<HTMLSelectElement>(box, "#month").value) : null,
      startDate: $<HTMLInputElement>(box, "#start").value,
      endDate: $<HTMLInputElement>(box, "#end").value || null,
    };
    const ok = await save(() =>
      editingId ? api(`/api/recurrences/${encodeURIComponent(editingId)}`, "PUT", payload) : api(`${base}/recurrences`, "POST", payload),
    );
    if (ok) setEditing(null);
  }));

  $(box, "#cancel").addEventListener("click", () => setEditing(null));

  $(box, "#rows").addEventListener("click", handler(async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const rule = rules.find((r) => r.id === btn.dataset.id);
    if (!rule) return;
    switch (btn.dataset.act) {
      case "edit":
        setEditing(rule);
        break;
      case "apply": {
        if (!confirm("Réappliquer cette règle depuis sa date de début jusqu'à aujourd'hui ?\nLes opérations déjà existantes ne sont pas recréées ; celles que vous aviez supprimées le seront.")) return;
        try {
          const { created } = await api<{ created: number }>(`/api/recurrences/${rule.id}/apply`, "POST");
          alert(created ? `${created} opération${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}.` : "Aucune opération à créer : tout existe déjà.");
        } catch (err) {
          alert((err as Error).message);
        }
        break;
      }
      case "stop": {
        if (!confirm("Arrêter cette règle à partir d'aujourd'hui ? Les opérations déjà créées sont conservées.")) return;
        const end = today() > rule.startDate ? today() : rule.startDate;
        await save(() => api(`/api/recurrences/${rule.id}`, "PUT", toPayload(rule, end)));
        break;
      }
      case "delete":
        if (!confirm("Supprimer cette règle ? Les opérations déjà créées sont conservées.")) return;
        if (await save(() => api(`/api/recurrences/${rule.id}`, "DELETE")) && editingId === rule.id) setEditing(null);
        break;
    }
  }));
}
