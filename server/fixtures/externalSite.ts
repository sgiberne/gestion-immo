// Faux extranet pour les tests : mêmes chemins que le vrai site, un seul compte, deux classeurs.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pdfWithLines } from "./data";

export const FAKE_USER = "copro";
export const FAKE_PASSWORD = "secret";
const COOKIE = "X14=session-de-test";

export const FAKE_DOCUMENTS = [
  { id: 101, title: "APPELS DE FONDS 4EME TRIMESTRE", date_commit: "2026-09-21T00:00:00+02:00", mime_type: "application/pdf", folder: 11 },
  { id: 102, title: "APPELS DE FONDS 3EME TRIMESTRE", date_commit: "2026-07-08T00:00:00+02:00", mime_type: "application/pdf", folder: 11 },
  { id: 103, title: "Règlement", date_commit: "2025-01-02T00:00:00+01:00", mime_type: "application/pdf", folder: 12 },
  { id: 104, title: "Photo", date_commit: "2026-10-01T00:00:00+02:00", mime_type: "image/png", folder: 12 },
];
const FOLDERS = [
  { id: 11, nom: "Appels" },
  { id: 12, nom: "Divers" },
  { id: 13, nom: "Vide" },
];

export interface FakeExtranet {
  url: string;
  /** Publie un nouveau PDF (dans le classeur « Appels ») pendant que le serveur tourne. */
  addDocument(id: number, title: string, date: string | null): void;
  stop(): Promise<void>;
}

interface FakeDoc { id: number; title: string; date_commit: string | null; mime_type: string; folder: number }

/**
 * `redirectLogin` : /authenticate répond par une redirection 302 (avec le cookie), comme certains sites.
 * `maxPageSize` : le site plafonne la taille de page, quoi que demande `itemCountPerPage`.
 */
export async function startFakeExtranet(options: { redirectLogin?: boolean; maxPageSize?: number } = {}): Promise<FakeExtranet> {
  const docs: FakeDoc[] = [...FAKE_DOCUMENTS];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/authenticate" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const b = JSON.parse(raw || "{}") as { login?: string; password?: string };
        if (b.login === FAKE_USER && b.password === FAKE_PASSWORD) {
          if (options.redirectLogin) {
            res.writeHead(302, { location: "/accueil", "set-cookie": `${COOKIE}; HttpOnly` });
            res.end();
          } else json(200, {}, { "set-cookie": `${COOKIE}; HttpOnly` });
        }
        else json(401, { error: "refusé" });
      });
      return;
    }
    if (req.headers.cookie !== COOKIE) return json(401, {});
    const base = "/api/extranet/coproprietaire/documents/classeur";
    if (url.pathname === base) {
      const all = FOLDERS.map((f) => ({ ...f, fileCount: docs.filter((d) => d.folder === f.id).length }));
      return json(200, { allClasseurs: Object.fromEntries(all.map((f) => [f.id, f])) });
    }
    if (url.pathname.startsWith(`${base}/`)) {
      const folder = Number(url.pathname.slice(base.length + 1));
      const size = Math.min(Number(url.searchParams.get("itemCountPerPage") ?? 100), options.maxPageSize ?? Infinity);
      const page = Number(url.searchParams.get("currentPageNumber") ?? 1);
      const Documents = docs.filter((d) => d.folder === folder)
        .slice((page - 1) * size, page * size)
        .map((d) => ({ ...d, file_name: `${d.id}.PDF` }));
      return json(200, { data: { Documents } });
    }
    const dl = /^\/api\/extranet\/documents\/download\/(\d+)$/.exec(url.pathname);
    if (dl) {
      const doc = docs.find((d) => d.id === Number(dl[1]));
      if (!doc) return json(404, {});
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(pdfWithLines([doc.title, "MONTANT A REGLER : 485,40 EUR"]));
      return;
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    addDocument: (id, title, date) =>
      void docs.push({ id, title, date_commit: date && `${date}T00:00:00+01:00`, mime_type: "application/pdf", folder: 11 }),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
