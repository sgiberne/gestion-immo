import { describe, expect, it } from "vitest";
import { useTestServer } from "./fixtures/api";
import { pdfWithLines } from "./fixtures/data";

const api = useTestServer();
const pdf = (lines: string[]) => pdfWithLines(lines).toString("base64");

describe("documents", () => {
  it("analyse un appel de fonds", async () => {
    const r = await api.post("/api/documents/analyze", {
      type: "appel_de_fonds", data: pdf(["1er appel de fonds", "MONTANT A REGLER : 1 500,25 EUR"]),
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ label: "1er appel de fonds", cents: 150025 });
  });

  it("refuse type inconnu, fichier absent, non-PDF et PDF sans montant", async () => {
    expect((await api.post("/api/documents/analyze", { type: "x", data: pdf(["a"]) })).status).toBe(400);
    expect((await api.post("/api/documents/analyze", { type: "appel_de_fonds" })).status).toBe(400);
    expect((await api.post("/api/documents/analyze", { type: "appel_de_fonds", data: Buffer.from("hello").toString("base64") })).status).toBe(400);
    expect((await api.post("/api/documents/analyze", { type: "appel_de_fonds", data: pdf(["rien"]) })).status).toBe(422);
  });

  it("ajoute la dépense avec la catégorie « Appel de fonds » (créée une seule fois)", async () => {
    const pid = await api.property("Copro");
    const body = { label: "1er appel de fonds", date: "2024-05-10", cents: 150025 };
    expect((await api.post(`/api/properties/${pid}/documents/fund-call`, body)).status).toBe(201);
    expect((await api.post(`/api/properties/${pid}/documents/fund-call`, { ...body, label: "2e appel de fonds" })).status).toBe(201);
    const list = await api.entries(pid);
    expect(list.map((e: any) => [e.kind, e.category, e.label, e.cents]).sort()).toEqual([
      ["depense", "Appel de fonds", "1er appel de fonds", 150025],
      ["depense", "Appel de fonds", "2e appel de fonds", 150025],
    ]);
    const cats = (await api.get(`/api/properties/${pid}/categories`)).body;
    expect(cats.filter((c: any) => c.name === "Appel de fonds")).toHaveLength(1);
  });

  it("refuse un logement inconnu (404)", async () => {
    expect((await api.post("/api/properties/inconnu/documents/fund-call", { date: "2024-05-10", cents: 100 })).status).toBe(404);
  });
});
