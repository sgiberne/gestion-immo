import { describe, expect, it } from "vitest";
import { validEntry, validRule } from "./fixtures/data";
import { cleanEntry, cleanId, cleanName, cleanRule, HttpError } from "./validation";

/** Exécute fn et renvoie le statut HTTP de l'erreur levée (ou null si rien n'est levé). */
function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
}

describe("cleanName", () => {
  it("retire les espaces autour et accepte jusqu'à 80 caractères", () => {
    expect(cleanName("  Loyer  ")).toBe("Loyer");
    expect(cleanName("x".repeat(80))).toHaveLength(80);
  });

  it.each([["vide", ""], ["espaces", "   "], ["trop long", "x".repeat(81)], ["nombre", 12], ["null", null], ["absent", undefined]])(
    "refuse %s", (_label, value) => {
      expect(status(() => cleanName(value))).toBe(400);
    },
  );
});

describe("cleanId", () => {
  it("accepte une chaîne non vide d'au plus 100 caractères", () => {
    expect(cleanId("abc")).toBe("abc");
    expect(status(() => cleanId("x".repeat(100)))).toBeNull();
  });

  it.each([["vide", ""], ["trop long", "x".repeat(101)], ["nombre", 5], ["absent", undefined]])("refuse %s", (_l, value) => {
    expect(status(() => cleanId(value))).toBe(400);
  });
});

describe("cleanEntry", () => {
  const valid = validEntry;

  it("renvoie l'opération nettoyée et conserve l'id fourni", () => {
    expect(cleanEntry({ ...valid, id: "mon-id", label: "  Plombier " })).toEqual({
      id: "mon-id", kind: "depense", date: "2026-05-10", label: "Plombier", cents: 12345,
    });
  });

  it("génère un id quand il est absent ou vide", () => {
    expect(cleanEntry(valid).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cleanEntry({ ...valid, id: "" }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("le libellé est facultatif : absent ou espaces → chaîne vide", () => {
    expect(cleanEntry({ ...valid, label: undefined }).label).toBe("");
    expect(cleanEntry({ ...valid, label: "   " }).label).toBe("");
  });

  it("limite le libellé à 80 caractères", () => {
    expect(status(() => cleanEntry({ ...valid, label: "x".repeat(80) }))).toBeNull();
    expect(status(() => cleanEntry({ ...valid, label: "x".repeat(81) }))).toBe(400);
  });

  it("accepte « recette » comme type", () => {
    expect(cleanEntry({ ...valid, kind: "recette" }).kind).toBe("recette");
  });

  it.each([
    ["null", null],
    ["une chaîne", "x"],
    ["type inconnu", { ...valid, kind: "autre" }],
    ["type absent", { ...valid, kind: undefined }],
    ["date sans zéros", { ...valid, date: "2026-5-10" }],
    ["date avec des slashs", { ...valid, date: "2026/05/10" }],
    ["date absente", { ...valid, date: undefined }],
    ["date non numérique", { ...valid, date: "abcd-ef-gh" }],
    ["montant nul", { ...valid, cents: 0 }],
    ["montant négatif", { ...valid, cents: -5 }],
    ["montant décimal", { ...valid, cents: 10.5 }],
    ["montant en texte", { ...valid, cents: "100" }],
  ])("refuse : %s", (_label, input) => {
    expect(status(() => cleanEntry(input))).toBe(400);
  });
});

describe("cleanRule", () => {
  const valid = validRule;

  it("renvoie la règle nettoyée (mois et fin nuls par défaut)", () => {
    expect(cleanRule(valid)).toEqual({
      kind: "depense", label: "Loyer", cents: 65000, startDate: "2026-01-01",
      frequency: "monthly", day: 5, month: null, endDate: null,
    });
  });

  it("exige un mois (1 à 12) pour une règle annuelle", () => {
    const yearly = { ...valid, frequency: "yearly", day: 15 };
    expect(status(() => cleanRule(yearly))).toBe(400);
    expect(status(() => cleanRule({ ...yearly, month: 0 }))).toBe(400);
    expect(status(() => cleanRule({ ...yearly, month: 13 }))).toBe(400);
    expect(status(() => cleanRule({ ...yearly, month: 2.5 }))).toBe(400);
    expect(cleanRule({ ...yearly, month: 10 }).month).toBe(10);
  });

  it("ignore le mois pour les fréquences mensuelle et trimestrielle", () => {
    expect(cleanRule({ ...valid, month: 7 }).month).toBeNull();
    expect(cleanRule({ ...valid, frequency: "quarterly", month: 7 }).month).toBeNull();
  });

  it.each([["weekly"], ["toString"], ["constructor"], [""], [undefined], [3]])("refuse la fréquence %j", (frequency) => {
    expect(status(() => cleanRule({ ...valid, frequency }))).toBe(400);
  });

  it.each([[0], [32], [-1], [1.5], ["5"], [undefined]])("refuse le jour %j", (day) => {
    expect(status(() => cleanRule({ ...valid, day }))).toBe(400);
  });

  it("accepte les jours 1 et 31", () => {
    expect(cleanRule({ ...valid, day: 1 }).day).toBe(1);
    expect(cleanRule({ ...valid, day: 31 }).day).toBe(31);
  });

  it("date de fin : facultative, jamais avant le début, bien formée", () => {
    expect(cleanRule({ ...valid, endDate: "" }).endDate).toBeNull();
    expect(cleanRule({ ...valid, endDate: null }).endDate).toBeNull();
    expect(cleanRule({ ...valid, endDate: "2026-01-01" }).endDate).toBe("2026-01-01"); // égale au début : ok
    expect(cleanRule({ ...valid, endDate: "2027-06-30" }).endDate).toBe("2027-06-30");
    expect(status(() => cleanRule({ ...valid, endDate: "2025-12-31" }))).toBe(400);
    expect(status(() => cleanRule({ ...valid, endDate: "30/06/2027" }))).toBe(400);
  });

  it("applique les validations d'une opération (type, montant, date de début, libellé)", () => {
    expect(status(() => cleanRule({ ...valid, kind: "x" }))).toBe(400);
    expect(status(() => cleanRule({ ...valid, cents: 0 }))).toBe(400);
    expect(status(() => cleanRule({ ...valid, startDate: "bad" }))).toBe(400);
    expect(status(() => cleanRule({ ...valid, label: "x".repeat(81) }))).toBe(400);
    expect(cleanRule({ ...valid, label: undefined }).label).toBe("");
  });

  it("refuse une valeur nulle", () => {
    expect(status(() => cleanRule(null))).toBe(400);
  });
});
