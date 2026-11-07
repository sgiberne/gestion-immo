import { Router } from "express";
import { randomUUID } from "node:crypto";
import { row, rows, run } from "../db";
import { requireProperty } from "../repository";
import { cleanName, HttpError } from "../validation";

// Les catégories sont propres à chaque logement.
export const categoriesRouter = Router();

// `used` compte les opérations ET les règles récurrentes qui utilisent la catégorie.
categoriesRouter.get("/properties/:pid/categories", (req, res) => {
  requireProperty(req.params.pid);
  res.json(
    rows(
      `SELECT c.id, c.name, (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id)
         + (SELECT COUNT(*) FROM recurrences r WHERE r.category_id = c.id) AS used
       FROM categories c WHERE c.property_id = ? ORDER BY c.name`,
      req.params.pid,
    ),
  );
});

categoriesRouter.post("/properties/:pid/categories", (req, res) => {
  requireProperty(req.params.pid);
  const id = randomUUID();
  run("INSERT INTO categories (id, property_id, name) VALUES (?, ?, ?)", id, req.params.pid, cleanName(req.body?.name));
  res.status(201).json({ id });
});

categoriesRouter.put("/categories/:id", (req, res) => {
  if (!row("SELECT id FROM categories WHERE id = ?", req.params.id)) throw new HttpError(404, "Catégorie introuvable.");
  run("UPDATE categories SET name = ? WHERE id = ?", cleanName(req.body?.name), req.params.id);
  res.status(204).end();
});

categoriesRouter.delete("/categories/:id", (req, res) => {
  const used = row<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM entries WHERE category_id = ?) + (SELECT COUNT(*) FROM recurrences WHERE category_id = ?) AS n",
    req.params.id, req.params.id,
  )!.n;
  if (used > 0) throw new HttpError(409, "Cette catégorie est utilisée : suppression impossible.");
  run("DELETE FROM categories WHERE id = ?", req.params.id);
  res.status(204).end();
});
