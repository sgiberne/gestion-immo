import { api } from "../api";
import { current } from "../state";
import { $, escapeHtml, fmt, handler, today } from "../util";

type Analysis = { label: string; cents: number };

/** Lit un fichier en base64 (sans le préfixe « data: »). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

export async function renderDocuments(box: HTMLElement): Promise<void> {
  const property = current();
  box.innerHTML = `
    <h1>Documents — ${escapeHtml(property.name)}</h1>
    <section class="card">
      <h2>Analyser un PDF</h2>
      <form id="form">
        <label>Type de document
          <select id="type"><option value="appel_de_fonds">Appel de fonds</option></select>
        </label>
        <label>Fichier PDF <input id="file" type="file" accept="application/pdf,.pdf" required /></label>
        <div class="actions"><button type="submit" id="analyze">Analyser</button></div>
      </form>
      <div id="result"></div>
    </section>`;

  const result = $(box, "#result");
  const reset = (): void => { result.innerHTML = ""; };
  $(box, "#file").addEventListener("change", reset);
  $(box, "#type").addEventListener("change", reset);

  $<HTMLFormElement>(box, "#form").addEventListener("submit", handler(async (ev) => {
    ev.preventDefault();
    reset();
    try {
      const file = $<HTMLInputElement>(box, "#file").files?.[0];
      if (!file) return;
      const found = await api<Analysis>("/api/documents/analyze", "POST", {
        type: $<HTMLSelectElement>(box, "#type").value,
        data: await toBase64(file),
      });
      result.innerHTML = `
        <p>Montant à régler trouvé : <strong>${fmt(found.cents)}</strong></p>
        <form id="add">
          <label>Libellé <input id="label" type="text" maxlength="80" value="${escapeHtml(found.label)}" /></label>
          <label>Date <input id="date" type="date" required value="${today()}" /></label>
          <div class="actions"><button type="submit">Ajouter aux dépenses</button></div>
        </form>`;
      $<HTMLFormElement>(result, "#add").addEventListener("submit", handler(async (e2) => {
        e2.preventDefault();
        try {
          await api(`/api/properties/${property.id}/documents/fund-call`, "POST", {
            label: $<HTMLInputElement>(result, "#label").value,
            date: $<HTMLInputElement>(result, "#date").value,
            cents: found.cents,
          });
          result.innerHTML = `<p>Dépense de ${fmt(found.cents)} ajoutée (catégorie « Appel de fonds »). <a href="#/operations">Voir les opérations</a></p>`;
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }));
}
