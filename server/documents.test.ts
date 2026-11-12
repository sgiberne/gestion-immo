import { describe, expect, it } from "vitest";
import { useTestServer, withTestServer, type Api } from "./fixtures/api";
import { pdfWithLines } from "./fixtures/data";
import { readZip } from "./fixtures/zip";
import { FAKE_PASSWORD, FAKE_USER, startFakeExtranet, type FakeExtranet } from "./fixtures/externalSite";

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

describe("documents du site externe", () => {
  const withFakeSite = async (
    fn: (api: Api, site: FakeExtranet) => Promise<void>,
    creds: { user: string; password: string } = { user: FAKE_USER, password: FAKE_PASSWORD },
    siteOptions: { redirectLogin?: boolean; maxPageSize?: number } = {},
  ) => {
    const site = await startFakeExtranet(siteOptions);
    try {
      await withTestServer((api) => fn(api, site), undefined, {
        SYNDIC_SITE_URL: site.url,
        SYNDIC_SITE_USER: creds.user,
        SYNDIC_SITE_PASSWORD: creds.password,
      });
    } finally {
      await site.stop();
    }
  };

  it("explique comment configurer le site quand .env est incomplet (503)", async () => {
    await withTestServer(async (api) => {
      const r = await api.get("/api/external/documents");
      expect(r.status).toBe(503);
      expect(r.body.error).toContain(".env");
      expect((await api.post("/api/external/documents/101/analyze", { type: "appel_de_fonds" })).status).toBe(503);
    });
  });

  it("liste les PDF de tous les classeurs, du plus récent au plus ancien", async () => {
    await withFakeSite(async (api) => {
      const r = await api.get("/api/external/documents");
      expect(r.status).toBe(200);
      expect(r.body.documents).toEqual([
        { id: "101", title: "APPELS DE FONDS 4EME TRIMESTRE", date: "2026-09-21", folder: "Appels", isNew: false },
        { id: "102", title: "APPELS DE FONDS 3EME TRIMESTRE", date: "2026-07-08", folder: "Appels", isNew: false },
        { id: "103", title: "Règlement", date: "2025-01-02", folder: "Divers", isNew: false },
      ]);
    });
  });

  it("télécharge un PDF et l'analyse", async () => {
    await withFakeSite(async (api) => {
      const r = await api.post("/api/external/documents/101/analyze", { type: "appel_de_fonds" });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ label: "APPELS DE FONDS 4EME TRIMESTRE", cents: 48540 });
    });
  });

  it("refuse un type inconnu (400), un identifiant invalide (400) et un document absent (502)", async () => {
    await withFakeSite(async (api) => {
      expect((await api.post("/api/external/documents/101/analyze", { type: "x" })).status).toBe(400);
      expect((await api.post("/api/external/documents/abc/analyze", { type: "appel_de_fonds" })).status).toBe(400);
      expect((await api.post("/api/external/documents/999/analyze", { type: "appel_de_fonds" })).status).toBe(502);
    });
  });

  it("signale des identifiants refusés par le site (502) sans les afficher", async () => {
    await withFakeSite(async (api) => {
      const r = await api.get("/api/external/documents");
      expect(r.status).toBe(502);
      expect(r.body.error).toContain("identifiants");
      expect(JSON.stringify(r.body)).not.toContain("mauvais");
    }, { user: FAKE_USER, password: "mauvais" });
  });

  it("signale un site injoignable (502)", async () => {
    await withTestServer(async (api) => {
      expect((await api.get("/api/external/documents")).status).toBe(502);
    }, undefined, { SYNDIC_SITE_URL: "http://localhost:1", SYNDIC_SITE_USER: "a", SYNDIC_SITE_PASSWORD: "b" });
  });

  it("importe tous les appels de fonds : date et libellé du document, sans doublon à la relance", async () => {
    await withFakeSite(async (api) => {
      const pid = await api.property("Copro");
      const url = `/api/properties/${pid}/external/import-fund-calls`;
      const first = await api.post(url);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        added: [
          { title: "APPELS DE FONDS 4EME TRIMESTRE", date: "2026-09-21", cents: 48540 },
          { title: "APPELS DE FONDS 3EME TRIMESTRE", date: "2026-07-08", cents: 48540 },
        ],
        alreadyThere: 0,
        ignored: 1, // « Règlement » n'est pas un appel de fonds
        failed: [],
      });
      const list = await api.entries(pid);
      expect(list.map((e: any) => [e.kind, e.category, e.date, e.label, e.cents]).sort()).toEqual([
        ["depense", "Appel de fonds", "2026-07-08", "APPELS DE FONDS 3EME TRIMESTRE", 48540],
        ["depense", "Appel de fonds", "2026-09-21", "APPELS DE FONDS 4EME TRIMESTRE", 48540],
      ]);

      const again = await api.post(url);
      expect(again.body).toMatchObject({ added: [], alreadyThere: 2, ignored: 1, failed: [] });
      expect(await api.entries(pid)).toHaveLength(2);
    });
  });

  it("refuse l'importation pour un logement inconnu (404) ou sans .env (503)", async () => {
    await withFakeSite(async (api) => {
      expect((await api.post("/api/properties/inconnu/external/import-fund-calls")).status).toBe(404);
    });
    await withTestServer(async (api) => {
      const pid = await api.property("Copro");
      expect((await api.post(`/api/properties/${pid}/external/import-fund-calls`)).status).toBe(503);
    });
  });

  it("sans .env, le suivi est inactif et le téléchargement groupé refusé (503)", async () => {
    await withTestServer(async (api) => {
      expect((await api.get("/api/external/status")).body).toEqual({ configured: false, lastCheck: null, newDocuments: [] });
      expect((await api.get("/api/external/documents/download-all")).status).toBe(503);
    });
  });

  it("vérifie au démarrage (référence : rien de nouveau), puis signale les nouveaux jusqu'à « vus »", async () => {
    await withFakeSite(async (api, site) => {
      // la vérification du démarrage tourne en arrière-plan : on attend son résultat
      let status = (await api.get("/api/external/status")).body;
      for (let i = 0; i < 50 && !status.lastCheck; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = (await api.get("/api/external/status")).body;
      }
      expect(status.configured).toBe(true);
      expect(status.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(status.newDocuments).toEqual([]);

      site.addDocument(105, "APPELS DE FONDS 1ER TRIMESTRE 2027", "2027-01-05");
      const list = (await api.get("/api/external/documents")).body.documents;
      expect(list.filter((d: any) => d.isNew).map((d: any) => d.id)).toEqual(["105"]);
      expect((await api.get("/api/external/status")).body.newDocuments).toEqual([
        { id: "105", title: "APPELS DE FONDS 1ER TRIMESTRE 2027", date: "2027-01-05", folder: "Appels" },
      ]);

      expect((await api.post("/api/external/seen")).status).toBe(204);
      expect((await api.get("/api/external/status")).body.newDocuments).toEqual([]);
      expect((await api.get("/api/external/documents")).body.documents.some((d: any) => d.isNew)).toBe(false);
    });
  });

  it("télécharge tous les documents dans une archive ZIP rangée par classeur", async () => {
    await withFakeSite(async (api) => {
      const res = await fetch(`${api.base}/api/external/documents/download-all`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="documents-\d{4}-\d{2}-\d{2}\.zip"$/);
      const files = readZip(Buffer.from(await res.arrayBuffer()));
      expect(files.map((f) => f.name)).toEqual([
        "Appels/2026-09-21 - APPELS DE FONDS 4EME TRIMESTRE.pdf",
        "Appels/2026-07-08 - APPELS DE FONDS 3EME TRIMESTRE.pdf",
        "Divers/2025-01-02 - Règlement.pdf",
      ]);
      expect(files.every((f) => f.crcOk && f.data.subarray(0, 5).toString() === "%PDF-")).toBe(true);
    });
  });

  it("lit toutes les pages d'un classeur (plus de 100 documents)", async () => {
    await withFakeSite(async (api, site) => {
      for (let i = 0; i < 150; i++) site.addDocument(1000 + i, `Document ${i}`, "2020-01-01");
      const list = (await api.get("/api/external/documents")).body.documents;
      expect(list).toHaveLength(3 + 150); // les 3 PDF du faux site + 150 ajoutés (l'image est ignorée)
    });
  });

  it("garde un document sans date (date vide, « sans date » dans l'archive) mais ne l'importe pas", async () => {
    await withFakeSite(async (api, site) => {
      site.addDocument(106, "APPEL DE FONDS SANS DATE", null);
      const list = (await api.get("/api/external/documents")).body.documents;
      expect(list.find((d: any) => d.id === "106")).toMatchObject({ date: "" });

      const pid = await api.property("Copro");
      const report = (await api.post(`/api/properties/${pid}/external/import-fund-calls`)).body;
      expect(report.failed).toEqual([{ title: "APPEL DE FONDS SANS DATE", error: expect.stringContaining("sans date") }]);
      expect(report.added).toHaveLength(2);
      expect(await api.entries(pid)).toHaveLength(2);

      const res = await fetch(`${api.base}/api/external/documents/download-all`);
      const names = readZip(Buffer.from(await res.arrayBuffer())).map((f) => f.name);
      expect(names).toContain("Appels/sans date - APPEL DE FONDS SANS DATE.pdf");
    });
  });

  it("ne réimporte pas un appel de fonds déjà ajouté à la main sous un autre libellé", async () => {
    await withFakeSite(async (api) => {
      const pid = await api.property("Copro");
      await api.post(`/api/properties/${pid}/documents/fund-call`, { label: "Mon libellé", date: "2026-09-21", cents: 48540 });
      const report = (await api.post(`/api/properties/${pid}/external/import-fund-calls`)).body;
      expect(report.alreadyThere).toBe(1);
      expect(report.added.map((a: any) => a.date)).toEqual(["2026-07-08"]);
      expect(await api.entries(pid)).toHaveLength(2);
    });
  });

  it("accepte une authentification qui répond par une redirection (le cookie est conservé)", async () => {
    await withFakeSite(async (api) => {
      const r = await api.get("/api/external/documents");
      expect(r.status).toBe(200);
      expect(r.body.documents).toHaveLength(3);
    }, undefined, { redirectLogin: true });
  });

  it("lit tout un classeur même si le site plafonne la taille de page", async () => {
    await withFakeSite(async (api, site) => {
      for (let i = 0; i < 120; i++) site.addDocument(2000 + i, `Document ${i}`, "2020-01-01");
      const list = (await api.get("/api/external/documents")).body.documents;
      expect(list).toHaveLength(3 + 120);
      expect(new Set(list.map((d: any) => d.id)).size).toBe(list.length);
    }, undefined, { maxPageSize: 50 });
  });

  it("importe deux appels de fonds du même jour et du même montant, et recrée celui qu'on a supprimé", async () => {
    await withFakeSite(async (api, site) => {
      site.addDocument(107, "APPEL DE FONDS TRAVAUX A", "2027-02-01");
      site.addDocument(108, "APPEL DE FONDS TRAVAUX B", "2027-02-01");
      const pid = await api.property("Copro");
      const url = `/api/properties/${pid}/external/import-fund-calls`;
      expect((await api.post(url)).body.added).toHaveLength(4);
      expect((await api.post(url)).body).toMatchObject({ added: [], alreadyThere: 4 });

      const sameDay = (await api.entries(pid)).filter((e: any) => e.date === "2027-02-01");
      expect(sameDay).toHaveLength(2);
      expect((await api.del(`/api/entries/${sameDay[0].id}`)).status).toBeLessThan(300);
      const again = (await api.post(url)).body;
      expect(again.added).toHaveLength(1);
      expect(again.alreadyThere).toBe(3);
      expect(await api.entries(pid)).toHaveLength(4);
    });
  });
});
