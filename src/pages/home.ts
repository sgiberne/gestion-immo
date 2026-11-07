import { api } from "../api";
import { attachTooltip, categorySlices, groupedBarChart, pieChart } from "../chart";
import { current } from "../state";
import type { Entry, Kind } from "../types";
import { $, escapeHtml, fmt, fmtSigned, today } from "../util";

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
