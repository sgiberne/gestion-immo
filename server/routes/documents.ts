import { Router, type Response } from "express";
import { ANALYZERS, extractPdfText, type Analysis } from "../pdfAnalysis";
import { findOrCreateCategory, requireProperty, upsertEntry } from "../repository";
import { cleanEntry, HttpError } from "../validation";

export const documentsRouter = Router();

export const FUND_CALL_CATEGORY = "Appel de fonds";

documentsRouter.post("/documents/analyze", (req, res, next) => {
  analyze(req.body, res).catch(next);
});

/** Choisit l'analyseur du type demandé (400 si inconnu). */
export function analyzerFor(type: unknown): (lines: string[]) => Analysis {
  const analyzer = typeof type === "string" && Object.hasOwn(ANALYZERS, type) ? ANALYZERS[type] : undefined;
  if (!analyzer) throw new HttpError(400, "Type de document inconnu.");
  return analyzer;
}

/** Extrait le texte d'un PDF et l'analyse (422 si le PDF est illisible ou sans montant). */
export async function analyzePdf(analyzer: (lines: string[]) => Analysis, pdf: Buffer): Promise<Analysis> {
  let lines: string[];
  try {
    lines = await extractPdfText(new Uint8Array(pdf));
  } catch {
    throw new HttpError(422, "Impossible de lire ce PDF.");
  }
  return analyzer(lines);
}

async function analyze(body: unknown, res: Response): Promise<void> {
  const { type, data } = (body ?? {}) as { type?: unknown; data?: unknown };
  const analyzer = analyzerFor(type);
  if (typeof data !== "string" || !data) throw new HttpError(400, "Aucun PDF reçu.");
  const buffer = Buffer.from(data, "base64");
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "Ce fichier n'est pas un PDF.");
  res.json(await analyzePdf(analyzer, buffer));
}

documentsRouter.post("/properties/:pid/documents/fund-call", (req, res) => {
  requireProperty(req.params.pid);
  const e = cleanEntry({ ...req.body, kind: "depense", id: undefined });
  const cid = findOrCreateCategory(req.params.pid, FUND_CALL_CATEGORY);
  upsertEntry(e, req.params.pid, cid);
  res.status(201).json({ id: e.id });
});
