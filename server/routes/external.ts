import { Router } from "express";
import { tx } from "../db";
import { connect, downloadExternalDocument, isExternalConfigured, listExternalDocuments } from "../externalSite";
import { lastCheck, markAllSeen, newDocuments, recordDocuments } from "../externalWatch";
import { todayLocal } from "../recurrence";
import { entryExists, findOrCreateCategory, requireProperty, upsertEntry } from "../repository";
import { cleanEntry, HttpError } from "../validation";
import { createZip, type ZipFile } from "../zip";
import { analyzePdf, analyzerFor, FUND_CALL_CATEGORY } from "./documents";

export const externalRouter = Router();

/** PDF disponibles sur le site externe (relevés au passage : les nouveaux sont signalés par `isNew`). */
externalRouter.get("/external/documents", (_req, res, next) => {
  listExternalDocuments().then((documents) => {
    recordDocuments(documents);
    const fresh = new Set(newDocuments().map((d) => d.id));
    res.json({ documents: documents.map((d) => ({ ...d, isNew: fresh.has(d.id) })) });
  }, next);
});

/** État du suivi, sans contacter le site : dernière vérification et documents nouveaux. */
externalRouter.get("/external/status", (_req, res) => {
  res.json({ configured: isExternalConfigured(), lastCheck: lastCheck(), newDocuments: newDocuments() });
});

/** L'utilisateur a pris connaissance des nouveaux documents. */
externalRouter.post("/external/seen", (_req, res) => {
  markAllSeen();
  res.status(204).end();
});

/** Nom de fichier sûr pour un chemin dans l'archive. */
const safeName = (s: string): string =>
  [...s].map((c) => (c < " " || '\\/:*?"<>|'.includes(c) ? "-" : c)).join("").trim() || "document";

/** Archive ZIP de tous les PDF du site, rangés par classeur. */
externalRouter.get("/external/documents/download-all", (_req, res, next) => {
  downloadAll().then((zip) => {
    res.set({
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="documents-${todayLocal()}.zip"`,
    });
    res.send(zip);
  }, next);
});

async function downloadAll(): Promise<Buffer> {
  const session = await connect();
  const documents = await listExternalDocuments(session);
  if (!documents.length) throw new HttpError(404, "Aucun document à télécharger.");
  const used = new Set<string>();
  const files: ZipFile[] = [];
  for (const d of documents) {
    const base = `${safeName(d.folder)}/${d.date} - ${safeName(d.title)}`;
    let name = `${base}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).pdf`;
    used.add(name.toLowerCase());
    files.push({ name, data: await downloadExternalDocument(d.id, session) });
  }
  return createZip(files);
}

/** Télécharge un PDF du site externe et l'analyse comme un PDF envoyé à la main. */
externalRouter.post("/external/documents/:id/analyze", (req, res, next) => {
  const analyzer = analyzerFor((req.body as { type?: unknown } | undefined)?.type);
  downloadExternalDocument(req.params.id)
    .then((pdf) => analyzePdf(analyzer, pdf))
    .then((found) => res.json(found), next);
});

const isFundCall = (title: string): boolean => /appels?\s+de\s+fonds/i.test(title);

interface ImportReport {
  added: { title: string; date: string; cents: number }[];
  /** Appels de fonds déjà enregistrés (même date, libellé et montant). */
  alreadyThere: number;
  /** Documents qui ne sont pas des appels de fonds : ni téléchargés ni analysés. */
  ignored: number;
  failed: { title: string; error: string }[];
}

/**
 * Télécharge tous les appels de fonds du site externe et les ajoute en dépenses.
 * Date = date du document (celle du jour s'il n'en a pas), libellé = nom du document.
 * Relancer l'importation n'ajoute rien de plus.
 */
externalRouter.post("/properties/:pid/external/import-fund-calls", (req, res, next) => {
  const pid = req.params.pid;
  requireProperty(pid);
  importFundCalls(pid).then((report) => res.json(report), next);
});

async function importFundCalls(pid: string): Promise<ImportReport> {
  const analyzer = analyzerFor("appel_de_fonds");
  const session = await connect();
  const documents = await listExternalDocuments(session);
  const report: ImportReport = { added: [], alreadyThere: 0, ignored: 0, failed: [] };
  const toAdd: ReturnType<typeof cleanEntry>[] = [];

  for (const doc of documents) {
    if (!isFundCall(doc.title)) {
      report.ignored++;
      continue;
    }
    try {
      const found = await analyzePdf(analyzer, await downloadExternalDocument(doc.id, session));
      toAdd.push(cleanEntry({ kind: "depense", date: doc.date || todayLocal(), label: doc.title, cents: found.cents }));
    } catch (err) {
      report.failed.push({ title: doc.title, error: err instanceof Error ? err.message : String(err) });
    }
  }

  tx(() => {
    const category = findOrCreateCategory(pid, FUND_CALL_CATEGORY);
    for (const e of toAdd) {
      if (entryExists(pid, category, e)) {
        report.alreadyThere++;
        continue;
      }
      upsertEntry(e, pid, category);
      report.added.push({ title: e.label, date: e.date, cents: e.cents });
    }
  });
  return report;
}
