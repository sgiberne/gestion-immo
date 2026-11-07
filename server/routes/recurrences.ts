import { Router } from "express";
import { randomUUID } from "node:crypto";
import { row, rows, run, tx } from "../db";
import { applyRule, findRule, forecastOccurrences, generateRecurrences } from "../recurrenceService";
import { assertCategoryInProperty, requireProperty } from "../repository";
import { cleanId, cleanRule, HttpError } from "../validation";

export const recurrencesRouter = Router();

const ruleSelect = `SELECT r.id, r.kind, r.label, r.cents, r.frequency, r.day, r.month, r.start_date AS startDate,
  r.end_date AS endDate, r.category_id AS categoryId, c.name AS category
  FROM recurrences r JOIN categories c ON c.id = r.category_id`;

recurrencesRouter.get("/properties/:pid/recurrences", (req, res) => {
  requireProperty(req.params.pid);
  res.json(rows(`${ruleSelect} WHERE r.property_id = ? ORDER BY r.start_date DESC, r.label`, req.params.pid));
});

// Créer une règle génère aussitôt les opérations des échéances déjà passées.
recurrencesRouter.post("/properties/:pid/recurrences", (req, res) => {
  requireProperty(req.params.pid);
  const r = cleanRule(req.body);
  const cid = cleanId(req.body?.categoryId);
  assertCategoryInProperty(cid, req.params.pid);
  const id = randomUUID();
  run(
    `INSERT INTO recurrences (id, property_id, category_id, kind, label, cents, frequency, day, month, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.pid, cid, r.kind, r.label, r.cents, r.frequency, r.day, r.month, r.startDate, r.endDate,
  );
  generateRecurrences();
  res.status(201).json({ id });
});

// La modification ne touche que les échéances à venir ; la date de début est figée.
recurrencesRouter.put("/recurrences/:id", (req, res) => {
  const existing = row<{ property_id: string; start_date: string }>(
    "SELECT property_id, start_date FROM recurrences WHERE id = ?", req.params.id,
  );
  if (!existing) throw new HttpError(404, "Règle introuvable.");
  const r = cleanRule({ ...req.body, startDate: existing.start_date });
  const cid = cleanId(req.body?.categoryId);
  assertCategoryInProperty(cid, existing.property_id);
  run(
    `UPDATE recurrences SET category_id = ?, kind = ?, label = ?, cents = ?, frequency = ?, day = ?, month = ?, end_date = ? WHERE id = ?`,
    cid, r.kind, r.label, r.cents, r.frequency, r.day, r.month, r.endDate, req.params.id,
  );
  generateRecurrences();
  res.status(204).end();
});

// Aperçu d'une année : échéances des règles qui n'existent pas encore (rien n'est créé en base).
recurrencesRouter.get("/properties/:pid/forecast", (req, res) => {
  requireProperty(req.params.pid);
  const year = String(req.query.year ?? "");
  if (!/^\d{4}$/.test(year)) throw new HttpError(400, "Année invalide.");
  res.json(forecastOccurrences(req.params.pid, year));
});

// Réapplique la règle de la date de début jusqu'à aujourd'hui (ou la date de fin).
// Mêmes critères que la création automatique (voir occurrenceExists).
recurrencesRouter.post("/recurrences/:id/apply", (req, res) => {
  const r = findRule(req.params.id);
  if (!r) throw new HttpError(404, "Règle introuvable.");
  res.json({ created: applyRule(r) });
});

// Supprimer une règle conserve les opérations déjà créées.
recurrencesRouter.delete("/recurrences/:id", (req, res) => {
  tx(() => {
    run("UPDATE entries SET recurrence_id = NULL WHERE recurrence_id = ?", req.params.id);
    run("DELETE FROM recurrences WHERE id = ?", req.params.id);
  });
  res.status(204).end();
});
