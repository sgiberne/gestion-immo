import { Router } from "express";
import { tx } from "../db";
import { connect, downloadExternalDocument, isExternalConfigured, listExternalDocuments } from "../externalSite";
import { lastCheck, markAllSeen, newDocuments, recordDocuments } from "../externalWatch";
import { mapPool } from "../pool";
import { todayLocal } from "../recurrence";
import { findOrCreateCategory, requireProperty, countSameAmountOnDate, upsertEntry } from "../repository";
import { cleanEntry, HttpError } from "../validation";
import { createZip, safeName, type ZipFile } from "../zip";
import { analyzePdf, analyzerFor, FUND_CALL_CATEGORY } from "./documents";

export const externalRouter = Router();

/** PDF disponibles sur le site externe (relevés au passage : les nouveaux sont signalés par `isNew`). */
externalRouter.get("/external/documents", (_req, res, next) => {
  listExternalDocuments()
    .then((documents) => {
      recordDocuments(documents);
      const fresh = new Set(newDocuments().map((d) => d.id));
      res.json({ documents: documents.map((d) => ({ ...d, isNew: fresh.has(d.id) })) });
    })
    .catch(next);
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

/** Téléchargements simultanés pour l'archive : assez pour aller vite, sans saturer le site. */
const ZIP_CONCURRENCY = 4;
/** Taille maximale de l'archive, qui est construite en mémoire. */
const ZIP_MAX_BYTES = 300 * 1024 * 1024;

/** Archive ZIP de tous les PDF du site, rangés par classeur. */
externalRouter.get("/external/documents/download-all", (_req, res, next) => {
  let cancelled = false;
  res.on("close", () => { cancelled = true; }); // navigateur fermé : inutile de continuer
  downloadAll(() => cancelled)
    .then((zip) => {
      res.set({
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="documents-${todayLocal()}.zip"`,
      });
      res.send(zip);
    })
    .catch((err: unknown) => { if (!cancelled) next(err); }); // personne n'attend plus la réponse
});

async function downloadAll(isCancelled: () => boolean): Promise<Buffer> {
  const session = await connect();
  if (isCancelled()) throw new HttpError(499, "Téléchargement annulé.");
  const documents = await listExternalDocuments(session);
  if (!documents.length) throw new HttpError(404, "Aucun document à télécharger.");
  const used = new Set<string>();
  const names = documents.map((d) => {
    const base = `${safeName(d.folder)}/${d.date || "sans date"} - ${safeName(d.title)}`;
    let name = `${base}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).pdf`;
    used.add(name.toLowerCase());
    return name;
  });

  let bytes = 0;
  const files = await mapPool(documents, ZIP_CONCURRENCY, async (d, i): Promise<ZipFile> => {
    if (isCancelled()) throw new HttpError(499, "Téléchargement annulé.");
    const data = await downloadExternalDocument(d.id, session);
    bytes += data.length;
    if (bytes > ZIP_MAX_BYTES) throw new HttpError(413, "Les documents sont trop volumineux pour une seule archive.");
    return { name: names[i], data };
  });
  return createZip(files);
}

/** Télécharge un PDF du site externe et l'analyse comme un PDF envoyé à la main. */
externalRouter.post("/external/documents/:id/analyze", (req, res, next) => {
  const analyzer = analyzerFor((req.body as { type?: unknown } | undefined)?.type);
  downloadExternalDocument(req.params.id)
    .then((pdf) => analyzePdf(analyzer, pdf))
    .then((found) => res.json(found))
    .catch(next);
});

const isFundCall = (title: string): boolean => /appels?\s+de\s+fonds/i.test(title);

interface ImportReport {
  added: { title: string; date: string; cents: number }[];
  /** Appels de fonds déjà enregistrés (même date et même montant, quel que soit le libellé, à raison d'un par document). */
  alreadyThere: number;
  /** Documents qui ne sont pas des appels de fonds : ni téléchargés ni analysés. */
  ignored: number;
  failed: { title: string; error: string }[];
}

/**
 * Télécharge tous les appels de fonds du site externe et les ajoute en dépenses.
 * Date = date du document (un document sans date n'est pas importé), libellé = nom du document.
 * Relancer l'importation n'ajoute rien de plus.
 */
externalRouter.post("/properties/:pid/external/import-fund-calls", (req, res, next) => {
  const pid = req.params.pid;
  requireProperty(pid);
  importFundCalls(pid).then((report) => res.json(report)).catch(next);
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
    if (!doc.date) {
      // sans date de document, on ne peut pas reconnaître l'opération à la relance : mieux vaut la saisir à la main
      report.failed.push({ title: doc.title, error: "Document sans date sur le site : ajoutez la dépense à la main." });
      continue;
    }
    try {
      const found = await analyzePdf(analyzer, await downloadExternalDocument(doc.id, session));
      toAdd.push(cleanEntry({ kind: "depense", date: doc.date, label: doc.title, cents: found.cents }));
    } catch (err) {
      report.failed.push({ title: doc.title, error: err instanceof Error ? err.message : String(err) });
    }
  }

  tx(() => {
    const category = findOrCreateCategory(pid, FUND_CALL_CATEGORY);
    // Un appel de fonds est « déjà là » s'il existe une dépense de même date et même montant, quel que soit son libellé
    // (saisie à la main, par exemple). Chaque dépense existante ne couvre qu'un document : si deux documents partagent
    // la date et le montant et qu'une seule dépense existe, l'autre est ajouté.
    const covered = new Map<string, number>();
    for (const e of toAdd) {
      const key = `${e.date}|${e.cents}`;
      const left = covered.get(key) ?? countSameAmountOnDate(pid, category, e);
      if (left > 0) {
        covered.set(key, left - 1);
        report.alreadyThere++;
        continue;
      }
      covered.set(key, 0);
      upsertEntry(e, pid, category);
      report.added.push({ title: e.label, date: e.date, cents: e.cents });
    }
  });
  return report;
}
