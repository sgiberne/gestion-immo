import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./repository";
import { useTestServer, withTestServer, rentalWithPastRule } from "./fixtures/api";
import {
  dates, entryBody, fileWithForeignCategory, fileWithInvalidEntry, futureRuleBody, importedRentalFile,
  LEGACY_DB_ROWS, legacyImportList, NEXT_YEAR, PAST_RULE_DATES, ruleBody, seedLegacyDb,
} from "./fixtures/data";

const api = useTestServer();

describe("logements", () => {
  it("crée un logement vide avec les catégories par défaut", async () => {
    const pid = await api.property("Studio");
    const cats = (await api.get(`/api/properties/${pid}/categories`)).body.map((c: any) => c.name);
    expect(cats).toEqual(expect.arrayContaining(DEFAULT_CATEGORIES));
    expect(await api.entries(pid)).toEqual([]);
  });

  it.each([[""], ["   "], [123], ["x".repeat(81)], [undefined]])("refuse le nom %j (400)", async (name) => {
    expect((await api.post("/api/properties", { name })).status).toBe(400);
  });

  it("renomme un logement ; 404 si inconnu ; 400 si nom invalide", async () => {
    const pid = await api.property("A renommer");
    expect((await api.put(`/api/properties/${pid}`, { name: "Nouveau nom" })).status).toBe(204);
    const names = (await api.get("/api/properties")).body.map((p: any) => p.name);
    expect(names).toContain("Nouveau nom");
    expect((await api.put(`/api/properties/${pid}`, { name: "" })).status).toBe(400);
    expect((await api.put("/api/properties/inconnu", { name: "x" })).status).toBe(404);
  });

  it("refuse de supprimer un logement qui contient des opérations (409), accepte s'il est vide", async () => {
    const pid = await api.property("Avec opérations");
    await api.addEntry(pid);
    expect((await api.del(`/api/properties/${pid}`)).status).toBe(409);

    const empty = await api.property("Vide");
    expect((await api.del(`/api/properties/${empty}`)).status).toBe(204);
    expect((await api.get(`/api/properties/${empty}/entries`)).status).toBe(404);
  });

  it("supprime aussi les règles et catégories d'un logement vide", async () => {
    const pid = await api.property("Avec règle future");
    const r = await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(await api.categoryId(pid)));
    expect(r.status).toBe(201);
    expect(await api.entries(pid)).toEqual([]); // rien n'est créé : la règle commence dans le futur
    expect((await api.del(`/api/properties/${pid}`)).status).toBe(204);
  });

  it("le nombre d'opérations est renvoyé par logement", async () => {
    const pid = await api.property("Compteur");
    await api.addEntry(pid);
    await api.addEntry(pid);
    const found = (await api.get("/api/properties")).body.find((p: any) => p.id === pid);
    expect(found.entryCount).toBe(2);
  });
});

describe("dernier logement (base neuve)", () => {
  it("refuse de supprimer le seul logement (409)", () =>
    withTestServer(async (solo) => {
      const list = (await solo.get("/api/properties")).body;
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("Mon logement");
      expect((await solo.del(`/api/properties/${list[0].id}`)).status).toBe(409);
    }));
});

describe("catégories", () => {
  it("refuse un doublon sans tenir compte de la casse (409), à la création et au renommage", async () => {
    const pid = await api.property();
    expect((await api.post(`/api/properties/${pid}/categories`, { name: "loyer" })).status).toBe(409);
    const created = await api.post(`/api/properties/${pid}/categories`, { name: "Jardin" });
    expect(created.status).toBe(201);
    expect((await api.put(`/api/categories/${created.body.id}`, { name: "ASSURANCE" })).status).toBe(409);
    expect((await api.put(`/api/categories/${created.body.id}`, { name: "Piscine" })).status).toBe(204);
  });

  it("autorise le même nom dans deux logements différents", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    expect((await api.post(`/api/properties/${a}/categories`, { name: "Spécifique" })).status).toBe(201);
    expect((await api.post(`/api/properties/${b}/categories`, { name: "Spécifique" })).status).toBe(201);
  });

  it("valide le nom et le logement", async () => {
    const pid = await api.property();
    expect((await api.post(`/api/properties/${pid}/categories`, { name: " " })).status).toBe(400);
    expect((await api.post("/api/properties/inconnu/categories", { name: "X" })).status).toBe(404);
    expect((await api.put("/api/categories/inconnue", { name: "X" })).status).toBe(404);
  });

  it("refuse de supprimer une catégorie utilisée par une opération (409), accepte sinon", async () => {
    const pid = await api.property();
    await api.addEntry(pid);
    expect((await api.del(`/api/categories/${await api.categoryId(pid, "Loyer")}`)).status).toBe(409);
    expect((await api.del(`/api/categories/${await api.categoryId(pid, "Autre")}`)).status).toBe(204);
  });

  it("refuse de supprimer une catégorie utilisée seulement par une règle (409)", async () => {
    const pid = await api.property();
    const cat = await api.categoryId(pid, "Charges");
    await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(cat));
    expect((await api.del(`/api/categories/${cat}`)).status).toBe(409);
  });

  it("indique l'utilisation (opérations + règles) de chaque catégorie", async () => {
    const pid = await api.property();
    await api.addEntry(pid);
    await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(await api.categoryId(pid)));
    const loyer = (await api.get(`/api/properties/${pid}/categories`)).body.find((c: any) => c.name === "Loyer");
    expect(loyer.used).toBe(2);
  });
});

describe("opérations", () => {
  it("crée une opération (libellé facultatif) et la renvoie dans la liste", async () => {
    const pid = await api.property();
    await api.addEntry(pid, { label: undefined });
    await api.addEntry(pid, { label: "   " });
    const list = await api.entries(pid);
    expect(list).toHaveLength(2);
    expect(list.every((e) => e.label === "" && e.category === "Loyer" && e.recurrenceId === null)).toBe(true);
  });

  it.each([
    ["type inconnu", { kind: "autre" }],
    ["date invalide", { date: "10/05/2024" }],
    ["montant nul", { cents: 0 }],
    ["montant négatif", { cents: -1 }],
    ["montant décimal", { cents: 12.5 }],
    ["libellé trop long", { label: "x".repeat(81) }],
    ["catégorie absente", { categoryId: undefined }],
  ])("refuse : %s (400)", async (_label, over) => {
    const pid = await api.property();
    const r = await api.post(`/api/properties/${pid}/entries`, entryBody(await api.categoryId(pid), over));
    expect(r.status).toBe(400);
    expect(await api.entries(pid)).toEqual([]);
  });

  it("refuse la catégorie d'un autre logement (400) et un logement inconnu (404)", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    expect((await api.post(`/api/properties/${b}/entries`, entryBody(await api.categoryId(a)))).status).toBe(400);
    expect((await api.post("/api/properties/inconnu/entries", entryBody("x"))).status).toBe(404);
  });

  it("modifie une opération (204) et conserve son logement", async () => {
    const pid = await api.property();
    const id = await api.addEntry(pid);
    const travaux = await api.categoryId(pid, "Travaux");
    const changes = { kind: "recette", cents: 2500, label: "Modifié", date: "2024-06-01" };
    expect((await api.put(`/api/entries/${id}`, entryBody(travaux, changes))).status).toBe(204);
    const [e] = await api.entries(pid);
    expect(e).toMatchObject({ id, ...changes, category: "Travaux" });
  });

  it("refuse une modification invalide (400), inconnue (404), ou vers la catégorie d'un autre logement (400)", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    const id = await api.addEntry(a);
    expect((await api.put(`/api/entries/${id}`, { kind: "x" })).status).toBe(400);
    expect((await api.put("/api/entries/inconnue", entryBody(await api.categoryId(a)))).status).toBe(404);
    expect((await api.put(`/api/entries/${id}`, entryBody(await api.categoryId(b)))).status).toBe(400);
  });

  it("supprime une opération", async () => {
    const pid = await api.property();
    const id = await api.addEntry(pid);
    expect((await api.del(`/api/entries/${id}`)).status).toBe(204);
    expect(await api.entries(pid)).toEqual([]);
  });

  it("isole les logements : une opération n'apparaît que dans son logement", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    await api.addEntry(a);
    expect(await api.entries(a)).toHaveLength(1);
    expect(await api.entries(b)).toHaveLength(0);
    expect((await api.get("/api/properties/inconnu/entries")).status).toBe(404);
  });
});

describe("règles récurrentes — validation", () => {
  it.each([
    ["fréquence inconnue", { frequency: "weekly" }],
    ["annuelle sans mois", { frequency: "yearly" }],
    ["annuelle avec mois 13", { frequency: "yearly", month: 13 }],
    ["jour 0", { day: 0 }],
    ["jour 32", { day: 32 }],
    ["fin avant le début", { endDate: "2023-12-31" }],
    ["date de fin invalide", { endDate: "30/06/2024" }],
    ["montant nul", { cents: 0 }],
  ])("refuse : %s (400)", async (_label, over) => {
    const pid = await api.property();
    expect((await api.post(`/api/properties/${pid}/recurrences`, ruleBody(await api.categoryId(pid), over))).status).toBe(400);
    expect(await api.rules(pid)).toEqual([]);
  });

  it("refuse la catégorie d'un autre logement (400), un logement inconnu (404), une règle inconnue (404)", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    expect((await api.post(`/api/properties/${b}/recurrences`, ruleBody(await api.categoryId(a)))).status).toBe(400);
    expect((await api.post("/api/properties/inconnu/recurrences", ruleBody("x"))).status).toBe(404);
    expect((await api.put("/api/recurrences/inconnue", ruleBody(await api.categoryId(a)))).status).toBe(404);
    expect((await api.post("/api/recurrences/inconnue/apply")).status).toBe(404);
  });

  it("refuse de modifier une règle vers la catégorie d'un autre logement (400)", async () => {
    const a = await api.property("A");
    const b = await api.property("B");
    const rid = await api.addRule(a);
    expect((await api.put(`/api/recurrences/${rid}`, ruleBody(await api.categoryId(b)))).status).toBe(400);
  });
});

describe("règles récurrentes — génération des opérations", () => {
  it("crée les échéances jusqu'à la date de fin, liées à la règle", async () => {
    const { pid, ruleId } = await rentalWithPastRule(api);
    const list = await api.entries(pid);
    expect(dates(list)).toEqual(PAST_RULE_DATES);
    for (const e of list) {
      expect(e).toMatchObject({ kind: "depense", cents: 65000, label: "Loyer", category: "Loyer", recurrenceId: ruleId });
    }
  });

  it("génère des rentrées et des échéances trimestrielles et annuelles", async () => {
    const pid = await api.property();
    await api.addRule(pid, { kind: "recette", label: "Trim", frequency: "quarterly", day: 1, startDate: "2024-01-01", endDate: "2024-12-31" });
    await api.addRule(pid, { label: "Taxe", frequency: "yearly", day: 15, month: 10, startDate: "2023-01-01", endDate: "2024-12-31" });
    const list = await api.entries(pid);
    expect(dates(list.filter((e) => e.label === "Trim"))).toEqual(["2024-01-01", "2024-04-01", "2024-07-01", "2024-10-01"]);
    expect(list.filter((e) => e.label === "Trim").every((e) => e.kind === "recette")).toBe(true);
    expect(dates(list.filter((e) => e.label === "Taxe"))).toEqual(["2023-10-15", "2024-10-15"]);
  });

  it("ne crée pas d'échéance dans le futur", async () => {
    const pid = await api.property();
    await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(await api.categoryId(pid)));
    expect(await api.entries(pid)).toEqual([]);
  });

  it("n'ajoute pas de doublon pour une opération identique saisie à la main, mais crée si le montant diffère", async () => {
    const pid = await api.property();
    await api.addEntry(pid, { date: "2024-02-29", cents: 65000, label: "manuel" });
    await api.addEntry(pid, { date: "2024-03-31", cents: 60000, label: "autre montant" });
    await api.addRule(pid, { endDate: "2024-03-31" });
    const list = await api.entries(pid);
    expect(list.filter((e) => e.date === "2024-02-29")).toHaveLength(1);
    expect(list.find((e) => e.date === "2024-02-29").recurrenceId).toBeNull();
    expect(list.filter((e) => e.date === "2024-03-31")).toHaveLength(2);
    expect(list.filter((e) => e.date === "2024-01-31")).toHaveLength(1);
  });

  it("ne recrée pas une occurrence supprimée lors des requêtes suivantes", async () => {
    const { pid } = await rentalWithPastRule(api);
    await api.del(`/api/entries/${(await api.entryOn(pid, "2024-03-31")).id}`);
    await api.get("/api/properties"); // chaque requête /api relance la génération
    expect(dates(await api.entries(pid))).not.toContain("2024-03-31");
    expect(await api.entries(pid)).toHaveLength(5);
  });

  it("« Appliquer » recrée les échéances manquantes et reste idempotent", async () => {
    const { pid, ruleId } = await rentalWithPastRule(api);
    expect((await api.post(`/api/recurrences/${ruleId}/apply`)).body).toEqual({ created: 0 });

    await api.del(`/api/entries/${(await api.entryOn(pid, "2024-03-31")).id}`);
    expect((await api.post(`/api/recurrences/${ruleId}/apply`)).body).toEqual({ created: 1 });
    expect(dates(await api.entries(pid))).toContain("2024-03-31");
    expect((await api.post(`/api/recurrences/${ruleId}/apply`)).body).toEqual({ created: 0 });
    expect(await api.entries(pid)).toHaveLength(6);
  });

  it("« Appliquer » ignore une opération identique saisie à la main", async () => {
    const { pid, ruleId } = await rentalWithPastRule(api);
    await api.del(`/api/entries/${(await api.entryOn(pid, "2024-04-30")).id}`);
    await api.addEntry(pid, { date: "2024-04-30", cents: 65000, label: "saisi à la main" });
    expect((await api.post(`/api/recurrences/${ruleId}/apply`)).body).toEqual({ created: 0 });
  });

  it("modifier une règle n'affecte pas les opérations déjà créées et fige la date de début", async () => {
    const { pid, cat, ruleId } = await rentalWithPastRule(api);
    const r = await api.put(`/api/recurrences/${ruleId}`, ruleBody(cat, { cents: 70000, startDate: "2020-01-01" }));
    expect(r.status).toBe(204);

    const [rule] = await api.rules(pid);
    expect(rule).toMatchObject({ cents: 70000, startDate: "2024-01-31" });
    const list = await api.entries(pid);
    expect(list).toHaveLength(6);
    expect(list.every((e) => e.cents === 65000)).toBe(true);
    expect((await api.post(`/api/recurrences/${ruleId}/apply`)).body).toEqual({ created: 0 });
  });

  it("supprimer une règle conserve les opérations créées, détachées de la règle", async () => {
    const { pid, ruleId } = await rentalWithPastRule(api);
    expect((await api.del(`/api/recurrences/${ruleId}`)).status).toBe(204);
    expect(await api.rules(pid)).toEqual([]);
    const list = await api.entries(pid);
    expect(list).toHaveLength(6);
    expect(list.every((e) => e.recurrenceId === null)).toBe(true);
  });
});

describe("aperçu (forecast)", () => {
  const forecast = async (pid: string, year: number | string = NEXT_YEAR) =>
    (await api.get(`/api/properties/${pid}/forecast?year=${year}`)).body;

  it("liste les échéances de l'année demandée sans rien créer en base", async () => {
    const pid = await api.property();
    await api.addRule(pid, { label: "Mensuelle", day: 1, startDate: "2020-01-01", endDate: null });
    await api.addRule(pid, { label: "Annuelle", frequency: "yearly", day: 15, month: 10, startDate: "2020-01-01", endDate: null });
    const before = (await api.entries(pid)).length;

    const result = await forecast(pid);
    expect(result.filter((e: any) => e.label === "Mensuelle")).toHaveLength(12);
    expect(dates(result.filter((e: any) => e.label === "Annuelle"))).toEqual([`${NEXT_YEAR}-10-15`]);
    expect(result.every((e: any) => e.date.startsWith(String(NEXT_YEAR)) && e.recurrenceId && e.category === "Loyer")).toBe(true);
    expect(result.every((e: any) => String(e.id).startsWith("forecast:"))).toBe(true);

    expect((await api.entries(pid)).length).toBe(before); // rien n'a été écrit
    expect((await api.entries(pid)).some((e) => e.date.startsWith(String(NEXT_YEAR)))).toBe(false);
  });

  it("respecte la date de fin et ignore une règle terminée avant l'année", async () => {
    const pid = await api.property();
    await api.addRule(pid, { label: "Coupée", day: 1, startDate: "2020-01-01", endDate: `${NEXT_YEAR}-03-15` });
    await api.addRule(pid, { label: "Finie" }); // fin en 2024
    const result = await forecast(pid);
    expect(dates(result.filter((e: any) => e.label === "Coupée"))).toEqual([`${NEXT_YEAR}-01-01`, `${NEXT_YEAR}-02-01`, `${NEXT_YEAR}-03-01`]);
    expect(result.filter((e: any) => e.label === "Finie")).toEqual([]);
  });

  it("inclut une règle qui ne démarre que l'année demandée", async () => {
    const pid = await api.property();
    await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(await api.categoryId(pid)));
    expect(await forecast(pid)).toHaveLength(12);
  });

  it("n'inclut pas une échéance déjà couverte par une opération identique", async () => {
    const pid = await api.property();
    await api.post(`/api/properties/${pid}/recurrences`, futureRuleBody(await api.categoryId(pid), { endDate: `${NEXT_YEAR}-03-31` }));
    await api.addEntry(pid, { date: `${NEXT_YEAR}-02-01`, cents: 65000 });
    expect(dates(await forecast(pid))).toEqual([`${NEXT_YEAR}-01-01`, `${NEXT_YEAR}-03-01`]);
  });

  it("valide l'année (400) et le logement (404)", async () => {
    const pid = await api.property();
    expect((await api.get(`/api/properties/${pid}/forecast?year=abc`)).status).toBe(400);
    expect((await api.get(`/api/properties/${pid}/forecast`)).status).toBe(400);
    expect((await api.get(`/api/properties/inconnu/forecast?year=${NEXT_YEAR}`)).status).toBe(404);
  });
});

describe("export / import", () => {
  it("l'export contient logements, catégories, règles et opérations (version 2)", async () => {
    const { pid } = await rentalWithPastRule(api, "Export");
    const exported = (await api.get("/api/export")).body;
    expect(exported.version).toBe(2);
    expect(exported.properties.some((p: any) => p.id === pid)).toBe(true);
    expect(exported.categories.some((c: any) => c.propertyId === pid)).toBe(true);
    expect(exported.recurrences.some((r: any) => r.propertyId === pid && r.generatedUntil)).toBe(true);
    expect(exported.entries.filter((e: any) => e.propertyId === pid)).toHaveLength(6);
  });

  it("réimporter son propre export ne crée aucun doublon et garde les liens avec les règles", async () => {
    const { pid } = await rentalWithPastRule(api, "Aller-retour");
    const exported = (await api.get("/api/export")).body;
    const r = await api.post("/api/import", exported);
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(exported.entries.length);

    const after = (await api.get("/api/export")).body;
    expect(after.entries).toHaveLength(exported.entries.length);
    expect(after.categories).toHaveLength(exported.categories.length);
    expect(after.recurrences).toHaveLength(exported.recurrences.length);
    expect((await api.entries(pid)).every((e) => e.recurrenceId !== null)).toBe(true);
  });

  it("restaure une règle et ses opérations dans un logement ajouté par l'import", async () => {
    expect((await api.post("/api/import", importedRentalFile())).body).toEqual({ imported: 1 });
    const [e] = await api.entries("p-import");
    expect(e).toMatchObject({ id: "e-import", category: "Loyer", recurrenceId: "r-import" });
    // generated_until est restauré : l'échéance du 01/02 (non présente dans le fichier) n'est pas recréée
    expect(await api.entries("p-import")).toHaveLength(1);
  });

  it("refuse un format invalide (400)", async () => {
    expect((await api.post("/api/import", { foo: "bar" })).status).toBe(400);
    expect((await api.post("/api/import", { version: 2, properties: "x" })).status).toBe(400);
  });

  it.each([["texte"], [42], [null], [true]])("répond 400 (et non 500) à un corps JSON qui n'est ni un objet ni une liste : %j", async (body) => {
    const r = await api.post("/api/import", body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/JSON attendu/);
  });

  it.each([["{bad"], ['{"name": "x"'], ["pas du json"]])("répond 400 à un JSON mal formé : %s", async (raw) => {
    const r = await api.raw("POST", "/api/properties", raw);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/JSON attendu/);
  });

  it("répond 413 à un corps trop volumineux (> 10 Mo)", async () => {
    const huge = JSON.stringify({ entries: [], padding: "x".repeat(11 * 1024 * 1024) });
    const r = await api.raw("POST", "/api/import", huge);
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/volumineuse/);
  });

  it("est atomique : une ligne invalide n'importe rien", async () => {
    expect((await api.post("/api/import", fileWithInvalidEntry())).status).toBe(400);
    const names = (await api.get("/api/properties")).body.map((p: any) => p.name);
    expect(names).not.toContain("Ne doit pas exister");
  });

  it("refuse une opération dont la catégorie n'appartient pas au logement indiqué (400)", async () => {
    expect((await api.post("/api/import", fileWithForeignCategory())).status).toBe(400);
  });

  it("accepte l'ancien format (liste avec catégorie en texte) dans le logement indiqué", async () => {
    const pid = await api.property("Ancien format");
    const r = await api.post(`/api/import?property=${pid}`, legacyImportList);
    expect(r.body).toEqual({ imported: 2 });
    const list = await api.entries(pid);
    expect(list.map((e) => e.category).sort()).toEqual(["Loyer", "Nouvelle catégorie"]);
    expect((await api.get(`/api/properties/${pid}/categories`)).body.some((c: any) => c.name === "Nouvelle catégorie")).toBe(true);
  });

  it("refuse une ligne invalide de l'ancien format (400)", async () => {
    const pid = await api.property("Ancien invalide");
    const r = await api.post(`/api/import?property=${pid}`, [{ id: "x", kind: "depense", date: "2024-05-05", category: "", cents: 1 }]);
    expect(r.status).toBe(400);
    expect(await api.entries(pid)).toEqual([]);
  });
});

describe("migration d'une ancienne base (sans logements)", () => {
  it("rattache les anciennes opérations à « Mon logement » et recrée leurs catégories", () =>
    withTestServer(async (legacy) => {
      const props = (await legacy.get("/api/properties")).body;
      expect(props).toHaveLength(1);
      expect(props[0]).toMatchObject({ name: "Mon logement", entryCount: LEGACY_DB_ROWS.length });

      const entries = await legacy.entries(props[0].id);
      const expected = LEGACY_DB_ROWS.map((r) => [r[0], r[3], r[5]]).sort();
      expect(entries.map((e: any) => [e.id, e.category, e.cents]).sort()).toEqual(expected);

      const cats = (await legacy.get(`/api/properties/${props[0].id}/categories`)).body;
      expect(cats.map((c: any) => c.name).sort()).toEqual([...new Set(LEGACY_DB_ROWS.map((r) => r[3]))].sort());
    }, seedLegacyDb));
});
