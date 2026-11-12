import { describe, expect, it } from "vitest";
import { pdfWithLines } from "./fixtures/data";
import { analyzeFundCall, extractPdfText, parseAmount } from "./pdfAnalysis";

describe("parseAmount", () => {
  it("lit les formats français", () => {
    expect(parseAmount("1 234,56 EUR")).toBe(123456);
    expect(parseAmount("1 234,56")).toBe(123456);
    expect(parseAmount("987,50")).toBe(98750);
    expect(parseAmount("pas de montant")).toBeNull();
  });
});

describe("analyzeFundCall", () => {
  it("trouve le montant sur la même ligne et le titre", () => {
    expect(analyzeFundCall(["Copropriete X", "1er appel de fonds", "MONTANT A REGLER : 1 234,56 EUR"]))
      .toEqual({ label: "1er appel de fonds", cents: 123456 });
  });
  it("trouve le montant sur la ligne suivante, tolère accents et casse", () => {
    expect(analyzeFundCall(["Montant à régler", "450,00"]).cents).toBe(45000);
  });
  it("titre par défaut", () => {
    expect(analyzeFundCall(["MONTANT A REGLER 10,00"]).label).toBe("Appel de fonds");
  });
  it("refuse un document sans montant", () => {
    expect(() => analyzeFundCall(["rien ici"])).toThrow(/introuvables/);
  });
});

describe("extractPdfText", () => {
  it("extrait les lignes d'un vrai PDF", async () => {
    const lines = await extractPdfText(new Uint8Array(pdfWithLines(["2e appel de fonds", "MONTANT A REGLER 99,90"])));
    expect(lines).toEqual(["2e appel de fonds", "MONTANT A REGLER 99,90"]);
  });
});
