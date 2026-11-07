import { Router } from "express";
import { row, rows, run, tx } from "../db";
import { createProperty, requireProperty } from "../repository";
import { cleanName, HttpError } from "../validation";

export const propertiesRouter = Router();

propertiesRouter.get("/properties", (_req, res) => {
  res.json(
    rows(`SELECT p.id, p.name, (SELECT COUNT(*) FROM entries e WHERE e.property_id = p.id) AS entryCount
          FROM properties p ORDER BY p.name COLLATE NOCASE`),
  );
});

propertiesRouter.post("/properties", (req, res) => {
  const id = tx(() => createProperty(cleanName(req.body?.name), true));
  res.status(201).json({ id });
});

propertiesRouter.put("/properties/:id", (req, res) => {
  requireProperty(req.params.id);
  run("UPDATE properties SET name = ? WHERE id = ?", cleanName(req.body?.name), req.params.id);
  res.status(204).end();
});

// Refusée si le logement contient des opérations, ou s'il est le dernier ; ses catégories et règles partent avec lui.
propertiesRouter.delete("/properties/:id", (req, res) => {
  requireProperty(req.params.id);
  const n = row<{ n: number }>("SELECT COUNT(*) AS n FROM entries WHERE property_id = ?", req.params.id)!.n;
  if (n > 0) throw new HttpError(409, "Ce logement contient des opérations : suppression impossible.");
  if (row<{ n: number }>("SELECT COUNT(*) AS n FROM properties")!.n <= 1)
    throw new HttpError(409, "Impossible de supprimer le seul logement.");
  tx(() => {
    run("DELETE FROM recurrences WHERE property_id = ?", req.params.id);
    run("DELETE FROM categories WHERE property_id = ?", req.params.id);
    run("DELETE FROM properties WHERE id = ?", req.params.id);
  });
  res.status(204).end();
});
