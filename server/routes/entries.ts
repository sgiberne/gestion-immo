import { Router } from "express";
import { row, rows, run } from "../db";
import { assertCategoryInProperty, requireProperty, upsertEntry } from "../repository";
import { cleanEntry, cleanId, HttpError } from "../validation";

export const entriesRouter = Router();

entriesRouter.get("/properties/:pid/entries", (req, res) => {
  requireProperty(req.params.pid);
  res.json(
    rows(
      `SELECT e.id, e.kind, e.date, e.category_id AS categoryId, c.name AS category, e.label, e.cents,
              e.recurrence_id AS recurrenceId
       FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.property_id = ? ORDER BY e.date DESC, e.rowid DESC`,
      req.params.pid,
    ),
  );
});

entriesRouter.post("/properties/:pid/entries", (req, res) => {
  requireProperty(req.params.pid);
  const e = cleanEntry({ ...req.body, id: undefined });
  const cid = cleanId(req.body?.categoryId);
  assertCategoryInProperty(cid, req.params.pid);
  upsertEntry(e, req.params.pid, cid);
  res.status(201).json({ id: e.id });
});

// Une opération reste dans son logement : seule une catégorie de ce logement est acceptée.
entriesRouter.put("/entries/:id", (req, res) => {
  const existing = row<{ property_id: string }>("SELECT property_id FROM entries WHERE id = ?", req.params.id);
  if (!existing) throw new HttpError(404, "Opération introuvable.");
  const e = cleanEntry({ ...req.body, id: req.params.id });
  const cid = cleanId(req.body?.categoryId);
  assertCategoryInProperty(cid, existing.property_id);
  upsertEntry(e, existing.property_id, cid);
  res.status(204).end();
});

entriesRouter.delete("/entries/:id", (req, res) => {
  run("DELETE FROM entries WHERE id = ?", req.params.id);
  res.status(204).end();
});
