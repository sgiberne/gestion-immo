import { escapeHtml, fmt } from "./util";

const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const euros = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface Series {
  name: string;
  values: number[]; // 12 valeurs en centimes (janvier -> décembre)
  colorVar: string; // ex. "--expense"
}

/** Histogramme mensuel groupé (une barre par série et par mois), avec infobulle et tableau de données. */
export function groupedBarChart(title: string, year: string, series: Series[]): string {
  const W = 900, H = 300;
  const m = { l: 66, r: 8, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const band = iw / 12;
  const gap = 2; // espace entre deux barres voisines
  const bw = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = bw * series.length + gap * (series.length - 1);
  const base = m.t + ih;

  const maxEuros = Math.max(...series.flatMap((s) => s.values)) / 100;
  const step = niceStep((maxEuros || 1) / 4);
  const top = step * 4;
  const y = (cents: number) => base - (cents / 100 / top) * ih;

  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const gy = y(i * step * 100);
    svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${gy}" y2="${gy}"/>`;
    svg += `<text class="tick" x="${m.l - 8}" y="${gy + 4}" text-anchor="end">${euros.format(i * step)} €</text>`;
  }
  for (let i = 0; i < 12; i++) {
    const x0 = m.l + i * band + (band - groupW) / 2;
    const tip = [`${LONG[i]} ${year}`, ...series.map((s) => `${s.name} : ${fmt(s.values[i])}`)].join(" · ");
    svg += `<g class="col">`;
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v <= 0) return;
      const x = x0 + k * (bw + gap);
      const h = base - y(v);
      const r = Math.min(4, h, bw / 2);
      svg += `<path class="bar" style="fill:var(${s.colorVar})" d="M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z"/>`;
    });
    svg += `<rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih}" data-tip="${escapeHtml(tip)}"/></g>`;
    svg += `<text class="tick" x="${m.l + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${SHORT[i]}</text>`;
  }

  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const legend = series
    .map((s) => `<span class="legend-item"><i class="swatch" style="background:var(${s.colorVar})"></i>${escapeHtml(s.name)} <strong>${fmt(sum(s.values))}</strong></span>`)
    .join("");
  const table =
    `<thead><tr><th>Mois</th>${series.map((s) => `<th class="num">${escapeHtml(s.name)}</th>`).join("")}</tr></thead><tbody>` +
    LONG.map((l, i) => `<tr><td>${l}</td>${series.map((s) => `<td class="num">${fmt(s.values[i])}</td>`).join("")}</tr>`).join("") +
    "</tbody>";

  return `
    <div class="chart">
      <div class="head"><h2>${escapeHtml(title)} ${year}</h2><div class="legend">${legend}</div></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)} ${year} : ${series.map((s) => s.name).join(" et ")} par mois">${svg}</svg>
      <details><summary>Voir le tableau</summary><table>${table}</table></details>
    </div>`;
}

// Couleurs des catégories : une couleur par catégorie (ordre alphabétique), identique d'un graphique à l'autre.
// Au-delà de 8 catégories utilisées, les suivantes sont regroupées dans « Autres » (gris neutre).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER_COLOR = "#9ca3af";

export interface Slice { name: string; cents: number; color: string }

/** Répartit des montants par catégorie en parts colorées (les plus grosses d'abord). */
export function categorySlices(allCategories: string[], amounts: Map<string, number>): Slice[] {
  const sorted = [...allCategories].sort((a, b) => a.localeCompare(b, "fr"));
  const slices: Slice[] = [];
  let other = 0;
  for (const [name, cents] of amounts) {
    if (cents <= 0) continue;
    const i = sorted.indexOf(name);
    if (i >= 0 && i < PALETTE.length) slices.push({ name, cents, color: PALETTE[i] });
    else other += cents;
  }
  slices.sort((a, b) => b.cents - a.cents);
  if (other > 0) slices.push({ name: "Autres", cents: other, color: OTHER_COLOR });
  return slices;
}

const percent = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Camembert + légende (montant et pourcentage de chaque catégorie), avec infobulle. */
export function pieChart(title: string, year: string, slices: Slice[], emptyText: string): string {
  const total = slices.reduce((a, s) => a + s.cents, 0);
  const heading = `<h2>${escapeHtml(title)} ${year}</h2>`;
  if (!total) return `${heading}<p class="empty">${escapeHtml(emptyText)}</p>`;

  const cx = 100, cy = 100, r = 96;
  let angle = -Math.PI / 2;
  let svg = "";
  for (const s of slices) {
    const frac = s.cents / total;
    const tip = escapeHtml(`${s.name} : ${fmt(s.cents)} (${percent.format(frac * 100)} %)`);
    if (slices.length === 1) {
      svg += `<circle class="slice" cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}" data-tip="${tip}"/>`;
      break;
    }
    const next = angle + frac * 2 * Math.PI;
    const [x0, y0] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const [x1, y1] = [cx + r * Math.cos(next), cy + r * Math.sin(next)];
    svg += `<path class="slice" fill="${s.color}" data-tip="${tip}" d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1},${y1} Z"/>`;
    angle = next;
  }
  const legend = slices
    .map((s) => `<li><i class="swatch" style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span><span class="legend-val">${fmt(s.cents)} · ${percent.format((s.cents / total) * 100)} %</span></li>`)
    .join("");
  return `${heading}
    <div class="pie">
      <svg class="pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(title)} ${year} par catégorie">${svg}</svg>
      <ul class="pie-legend">${legend}</ul>
    </div>`;
}

/** Infobulle au survol des barres (éléments portant data-tip). */
export function attachTooltip(container: HTMLElement): void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  container.append(tip);
  container.addEventListener("mousemove", (ev) => {
    const el = (ev.target as Element).closest<SVGElement>("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    const box = container.getBoundingClientRect();
    tip.textContent = el.dataset.tip ?? "";
    tip.hidden = false;
    tip.style.left = `${ev.clientX - box.left + 12}px`;
    tip.style.top = `${ev.clientY - box.top + 12}px`;
  });
  container.addEventListener("mouseleave", () => { tip.hidden = true; });
}
