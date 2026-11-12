import { loadProperties, setCurrent, state } from "./state";
import { renderCategories, renderDocuments, renderHome, renderOperations, renderProperties, renderRecurrences } from "./pages";
import { $, escapeHtml } from "./util";

const view = $<HTMLElement>(document, "#view");
const select = $<HTMLSelectElement>(document, "#property");

function renderMenu(): void {
  select.innerHTML = state.properties
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");
  select.value = state.currentId;
}

const routes: Record<string, (box: HTMLElement) => Promise<void>> = {
  "": renderHome,
  operations: renderOperations,
  recurrentes: renderRecurrences,
  categories: renderCategories,
  documents: renderDocuments,
  logements: (box) => renderProperties(box, renderMenu),
};

let seq = 0;
async function route(): Promise<void> {
  const mine = ++seq;
  const hash = location.hash.replace(/^#\/?/, "");
  const page = hash in routes ? hash : "";
  document.querySelectorAll<HTMLAnchorElement>("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === page);
  });
  const box = document.createElement("div");
  view.replaceChildren(box);
  try {
    await routes[page](box);
  } catch (err) {
    if (mine === seq) box.innerHTML = `<p class="error">${escapeHtml((err as Error).message)}</p>`;
  }
}

select.addEventListener("change", () => {
  setCurrent(select.value);
  void route();
});
window.addEventListener("hashchange", () => void route());

loadProperties()
  .then(() => {
    renderMenu();
    return route();
  })
  .catch((err: Error) => {
    view.innerHTML = `<p class="error">Impossible de joindre le serveur : ${escapeHtml(err.message)}</p>`;
  });
