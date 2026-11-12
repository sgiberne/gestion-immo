import { api } from "../api";
import { current } from "../state";
import { $, escapeHtml, fmt, frDate, handler, today } from "../util";

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

type ExternalDocument = { id: string; title: string; date: string; folder: string; isNew?: boolean };
type ExternalStatus = { configured: boolean; lastCheck: string | null; newDocuments: ExternalDocument[] };

type ImportReport = {
  added: { title: string; date: string; cents: number }[];
  alreadyThere: number;
  ignored: number;
  failed: { title: string; error: string }[];
};

/** Affiche le montant trouvé et le formulaire d'ajout de la dépense. */
function showFound(result: HTMLElement, propertyId: string, found: Analysis, date: string): void {
  result.innerHTML = `
    <p>Montant à régler trouvé : <strong>${fmt(found.cents)}</strong></p>
    <form id="add">
      <label>Libellé <input id="label" type="text" maxlength="80" value="${escapeHtml(found.label)}" /></label>
      <label>Date <input id="date" type="date" required value="${date}" /></label>
      <div class="actions"><button type="submit">Ajouter aux dépenses</button></div>
    </form>`;
  $<HTMLFormElement>(result, "#add").addEventListener("submit", handler(async (e2) => {
    e2.preventDefault();
    try {
      await api(`/api/properties/${propertyId}/documents/fund-call`, "POST", {
        label: $<HTMLInputElement>(result, "#label").value,
        date: $<HTMLInputElement>(result, "#date").value,
        cents: found.cents,
      });
      result.innerHTML = `<p>Dépense de ${fmt(found.cents)} ajoutée (catégorie « Appel de fonds »). <a href="#/operations">Voir les opérations</a></p>`;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }));
}

/** Section « site externe » : liste les PDF du site, puis analyse celui qu'on choisit. */
function renderExternal(box: HTMLElement, propertyId: string): void {
  const section = $(box, "#external");
  const body = $(section, "#external-body");
  const result = $(section, "#external-result");
  let documents: ExternalDocument[] = [];

  // Nouveaux documents détectés par la vérification quotidienne
  const newBox = $(section, "#new-docs");
  const showNew = async (): Promise<void> => {
    try {
      const st = await api<ExternalStatus>("/api/external/status");
      if (!st.configured) return;
      const last = st.lastCheck ? `Dernière vérification : ${frDate(st.lastCheck)}.` : "Pas encore vérifié.";
      newBox.innerHTML = st.newDocuments.length
        ? `<div class="new-docs"><strong>${st.newDocuments.length} nouveau(x) document(s)</strong>
             <ul>${st.newDocuments.map((d) => `<li>${frDate(d.date)} — ${escapeHtml(d.title)} (${escapeHtml(d.folder)})</li>`).join("")}</ul>
             <button type="button" class="ghost" id="seen">Marquer comme vus</button></div>
           <p class="muted">${last}</p>`
        : `<p class="muted">Aucun nouveau document. ${last}</p>`;
    } catch {
      newBox.textContent = "";
    }
  };
  newBox.addEventListener("click", handler(async (ev) => {
    if (!(ev.target as HTMLElement).closest("#seen")) return;
    try {
      await api("/api/external/seen", "POST");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return;
    }
    await showNew();
    window.dispatchEvent(new Event("documents-changed"));
  }));
  void showNew();

  const zip = $<HTMLButtonElement>(section, "#zip");
  zip.addEventListener("click", handler(async () => {
    zip.disabled = true;
    try {
      const res = await fetch("/api/external/documents/download-all");
      if (!res.ok) {
        const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
        throw new Error(msg ?? `Erreur serveur (${res.status})`);
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await res.blob());
      link.download = `documents-${today()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      zip.disabled = false;
    }
  }));

  const report = $(section, "#import-report");
  const importAll = $<HTMLButtonElement>(section, "#import-all");
  importAll.addEventListener("click", handler(async () => {
    report.textContent = "Téléchargement et analyse des appels de fonds…";
    importAll.disabled = true;
    try {
      const r = await api<ImportReport>(`/api/properties/${propertyId}/external/import-fund-calls`, "POST");
      const lines = [
        `<p><strong>${r.added.length}</strong> dépense(s) ajoutée(s) (catégorie « Appel de fonds »)` +
          (r.alreadyThere ? `, ${r.alreadyThere} déjà présente(s)` : "") + `. <a href="#/operations">Voir les opérations</a></p>`,
      ];
      if (r.added.length) {
        lines.push(`<ul>${r.added.map((a) => `<li>${frDate(a.date)} — ${escapeHtml(a.title)} : ${fmt(a.cents)}</li>`).join("")}</ul>`);
      }
      if (r.failed.length) {
        lines.push(`<p>Non importés :</p><ul>${r.failed.map((f) => `<li>${escapeHtml(f.title)} : ${escapeHtml(f.error)}</li>`).join("")}</ul>`);
      }
      report.innerHTML = lines.join("");
    } catch (err) {
      report.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      importAll.disabled = false;
    }
  }));

  $(section, "#load").addEventListener("click", handler(async () => {
    result.innerHTML = "";
    body.textContent = "Connexion au site…";
    try {
      documents = (await api<{ documents: ExternalDocument[] }>("/api/external/documents")).documents;
    } catch (err) {
      body.textContent = err instanceof Error ? err.message : String(err);
      return;
    }
    void showNew();
    window.dispatchEvent(new Event("documents-changed"));
    if (!documents.length) {
      body.textContent = "Aucun PDF trouvé sur le site.";
      return;
    }
    body.innerHTML = `
      <form id="pick">
        <label>Document
          <select id="doc">${documents.map((d) =>
            `<option value="${escapeHtml(d.id)}">${d.isNew ? "● Nouveau — " : ""}${frDate(d.date)} — ${escapeHtml(d.title)} (${escapeHtml(d.folder)})</option>`).join("")}
          </select>
        </label>
        <div class="actions"><button type="submit">Analyser ce document</button></div>
      </form>`;
    $(body, "#doc").addEventListener("change", () => { result.innerHTML = ""; });
    $<HTMLFormElement>(body, "#pick").addEventListener("submit", handler(async (ev) => {
      ev.preventDefault();
      result.innerHTML = "";
      try {
        const id = $<HTMLSelectElement>(body, "#doc").value;
        const doc = documents.find((d) => d.id === id);
        const found = await api<Analysis>(`/api/external/documents/${encodeURIComponent(id)}/analyze`, "POST", { type: "appel_de_fonds" });
        showFound(result, propertyId, found, doc?.date ?? today());
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }));
  }));
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
    </section>
    <section class="card" id="external">
      <h2>Récupérer depuis le site du syndic</h2>
      <p>Se connecte au site configuré dans le fichier <code>.env</code> et liste ses PDF (appels de fonds…).</p>
      <div class="actions">
        <button type="button" id="load">Charger la liste</button>
        <button type="button" id="import-all">Importer tous les appels de fonds</button>
        <button type="button" id="zip">Télécharger tous les documents (ZIP)</button>
      </div>
      <div id="new-docs"></div>
      <div id="import-report"></div>
      <div id="external-body"></div>
      <div id="external-result"></div>
    </section>`;
  renderExternal(box, property.id);

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
      showFound(result, property.id, found, today());
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }));
}
