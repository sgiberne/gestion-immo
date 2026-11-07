import { api } from "./api";
import { attachTooltip, categorySlices, groupedBarChart, pieChart } from "./chart";
import { renderNameManager, type Item } from "./nameManager";
import { current, loadProperties, state } from "./state";
import type { Category, Entry, Frequency, Kind, Property, Recurrence } from "./types";
import { $, escapeHtml, fmt, fmtSigned, frDate, handler, today } from "./util";

// ---------------------------------------------------------------- Accueil ----
interface Totals { expenses: number; income: number; net: number }

function totalsFor(entries: Entry[], prefix: string): Totals {
  let expenses = 0;
  let income = 0;
  for (const e of entries) {
    if (!e.date.startsWith(prefix)) continue;
    if (e.kind === "depense") expenses += e.cents;
    else income += e.cents;
  }
  return { expenses, income, net: income - expenses };
}

const totalsHtml = (t: Totals): string => `
  <dt>Total des dépenses</dt><dd class="depense">${fmt(t.expenses)}</dd>
  <dt>Total des rentrées</dt><dd class="recette">${fmt(t.income)}</dd>
  <dt class="strong">Solde (rentrées − dépenses)</dt><dd class="strong ${t.net > 0 ? "recette" : t.net < 0 ? "depense" : ""}">${fmtSigned(t.net)}</dd>`;

function monthlyValues(entries: Entry[], year: string, kind: Kind): number[] {
  const values = new Array<number>(12).fill(0);
  for (const e of entries) {
    if (e.kind === kind && e.date.startsWith(year)) values[Number(e.date.slice(5, 7)) - 1] += e.cents;
  }
  return values;
}

let homeMonth = today().slice(0, 7);

export async function renderHome(box: HTMLElement): Promise<void> {
  const property = current();
  const entries = await api<Entry[]>(`/api/properties/${property.id}/entries`);

  // Les couleurs sont attribuées d'après les catégories utilisées dans l'année (dépenses ET rentrées),
  // pour qu'une catégorie ait la même couleur dans les deux camemberts.
  const pieSlices = (year: string, kind: Kind) => {
    const inYear = entries.filter((e) => e.date.startsWith(year));
    const amounts = new Map<string, number>();
    for (const e of inYear) {
      if (e.kind === kind) amounts.set(e.category, (amounts.get(e.category) ?? 0) + e.cents);
    }
    return categorySlices([...new Set(inYear.map((e) => e.category))], amounts);
  };

  box.innerHTML = `
    <h1>${escapeHtml(property.name)}</h1>
    <section class="card">
      <div class="head">
        <h2>Totaux</h2>
        <label class="inline">Mois affiché <input id="month" type="month" /></label>
      </div>
      <div class="totals">
        <div><h3 id="month-title"></h3><dl id="month-totals"></dl></div>
        <div><h3 id="year-title"></h3><dl id="year-totals"></dl></div>
      </div>
    </section>
    <section class="card" id="chart"><div id="chart-body"></div></section>
    <section class="card" id="forecast"><div id="forecast-body"></div></section>
    <section class="pies">
      <div class="card" id="pie-expenses"><div id="pie-expenses-body"></div></div>
      <div class="card" id="pie-income"><div id="pie-income-body"></div></div>
    </section>`;

  const monthInput = $<HTMLInputElement>(box, "#month");
  monthInput.value = homeMonth;

  const update = (): void => {
    homeMonth = monthInput.value || homeMonth;
    const year = homeMonth.slice(0, 4);
    $(box, "#month-title").textContent = `Mois ${homeMonth.slice(5)}/${year}`;
    $(box, "#year-title").textContent = `Année ${year}`;
    $(box, "#month-totals").innerHTML = totalsHtml(totalsFor(entries, homeMonth));
    $(box, "#year-totals").innerHTML = totalsHtml(totalsFor(entries, year));
    $(box, "#chart-body").innerHTML = groupedBarChart("Dépenses et rentrées", year, [
      { name: "Dépenses", values: monthlyValues(entries, year, "depense"), colorVar: "--expense" },
      { name: "Rentrées", values: monthlyValues(entries, year, "recette"), colorVar: "--income" },
    ]);
    $(box, "#pie-expenses-body").innerHTML = pieChart("Dépenses par catégorie", year, pieSlices(year, "depense"), `Aucune dépense en ${year}.`);
    $(box, "#pie-income-body").innerHTML = pieChart("Rentrées par catégorie", year, pieSlices(year, "recette"), `Aucune rentrée en ${year}.`);
    void renderForecast(year);
  };
  // Aperçu de l'année suivante : opérations déjà saisies cette année-là + échéances des règles (non créées)
  const forecasts = new Map<string, Promise<Entry[]>>();
  const renderForecast = async (year: string): Promise<void> => {
    const next = String(Number(year) + 1);
    const body = $(box, "#forecast-body");
    let projected: Entry[];
    try {
      let pending = forecasts.get(next);
      if (!pending) {
        pending = api<Entry[]>(`/api/properties/${property.id}/forecast?year=${next}`);
        forecasts.set(next, pending);
      }
      projected = await pending;
    } catch (err) {
      body.innerHTML = `<p class="error">${escapeHtml((err as Error).message)}</p>`;
      return;
    }
    if (homeMonth.slice(0, 4) !== year) return; // l'utilisateur a changé d'année entre-temps
    const all = [...entries.filter((e) => e.date.startsWith(next)), ...projected];
    body.innerHTML = `
      <h2>Aperçu ${next}</h2>
      <p class="muted">Estimation : opérations déjà saisies pour ${next} et échéances des règles récurrentes. Aucune opération n'est créée.</p>
      <div class="totals"><dl>${totalsHtml(totalsFor(all, next))}</dl></div>
      ${groupedBarChart("Prévisionnel", next, [
        { name: "Dépenses", values: monthlyValues(all, next, "depense"), colorVar: "--expense" },
        { name: "Rentrées", values: monthlyValues(all, next, "recette"), colorVar: "--income" },
      ])}`;
  };

  monthInput.addEventListener("change", update);
  attachTooltip($(box, "#chart"));
  attachTooltip($(box, "#forecast"));
  attachTooltip($(box, "#pie-expenses"));
  attachTooltip($(box, "#pie-income"));
  update();
}

// ------------------------------------------------------------- Opérations ----
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
      <table>
        <thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th class="num">Montant</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>`;

  const drawRows = (): void => {
    $(box, "#rows").innerHTML = entries.length
      ? entries
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

// -------------------------------------------------------------- Récurrentes ----
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

// -------------------------------------------------------------- Catégories ----
const plural = (n: number): string => `${n} opération${n > 1 ? "s" : ""}`;
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

// --------------------------------------------------------------- Logements ----
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
