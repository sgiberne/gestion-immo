import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import { distDir } from "./config";
import { generateRecurrences } from "./recurrenceService";
import { categoriesRouter } from "./routes/categories";
import { dataTransferRouter } from "./routes/dataTransfer";
import { documentsRouter } from "./routes/documents";
import { entriesRouter } from "./routes/entries";
import { propertiesRouter } from "./routes/properties";
import { recurrencesRouter } from "./routes/recurrences";
import { HttpError } from "./validation";

/** Les routes lèvent des HttpError ; les doublons de nom (contrainte UNIQUE) deviennent des 409 ;
 *  les erreurs 4xx du parseur JSON d'Express (JSON mal formé, corps qui n'est ni un objet ni une liste,
 *  corps trop gros) gardent leur code au lieu de devenir des 500. */
function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (/UNIQUE/.test(err.message)) return void res.status(409).json({ error: "Ce nom existe déjà." });
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const error = status === 413 ? "Requête trop volumineuse." : "Requête invalide : JSON attendu (objet ou liste).";
    return void res.status(status).json({ error });
  }
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
}

/** L'application Express : API sous /api, et l'interface construite (dist/) si elle existe. */
export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Les échéances dépassées sont matérialisées avant chaque requête d'API.
  app.use("/api", (_req, _res, next) => {
    generateRecurrences();
    next();
  });
  app.use("/api", propertiesRouter, categoriesRouter, entriesRouter, recurrencesRouter, dataTransferRouter, documentsRouter);
  app.use("/api", errorHandler);

  if (fs.existsSync(distDir)) app.use(express.static(distDir));
  return app;
}
