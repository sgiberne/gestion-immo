import { Router } from "express";
import { exportAll, importData } from "../importExport";

export const dataTransferRouter = Router();

// Export complet (tous les logements) en JSON
dataTransferRouter.get("/export", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="immo-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(exportAll());
});

// Import : fusionne avec l'existant. `?property=` désigne le logement cible pour l'ancien format.
dataTransferRouter.post("/import", (req, res) => {
  const wanted = typeof req.query.property === "string" ? req.query.property : "";
  res.json({ imported: importData(req.body, wanted) });
});
