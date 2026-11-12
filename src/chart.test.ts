import { describe, expect, it } from "vitest";
import { categorySlices } from "./chart";

describe("categorySlices", () => {
  it("ignore les montants nuls ou négatifs et trie les parts par montant décroissant", () => {
    const slices = categorySlices(["Eau", "Loyer", "Taxe"], new Map([["Eau", 100], ["Loyer", 900], ["Taxe", 0]]));
    expect(slices.map((s) => s.name)).toEqual(["Loyer", "Eau"]);
  });

  it("attribue la couleur selon l'ordre alphabétique des catégories, quel que soit le montant", () => {
    const a = categorySlices(["B", "A"], new Map([["A", 1], ["B", 2]]));
    const b = categorySlices(["A", "B"], new Map([["B", 2], ["A", 1]]));
    expect(a).toEqual(b);
    expect(a.find((s) => s.name === "A")!.color).not.toBe(a.find((s) => s.name === "B")!.color);
  });

  it("regroupe au-delà de 8 catégories (et les inconnues) dans « Autres », en dernier", () => {
    const names = "ABCDEFGHIJ".split("");
    const amounts = new Map(names.map((n, i) => [n, (i + 1) * 100]));
    const slices = categorySlices(names, amounts);
    expect(slices).toHaveLength(9);
    const last = slices[slices.length - 1];
    expect(last.name).toBe("Autres");
    expect(last.cents).toBe(900 + 1000); // I et J
  });

  it("renvoie une liste vide sans montant positif", () => {
    expect(categorySlices(["A"], new Map())).toEqual([]);
  });
});
