// Accès au site externe (extranet du syndic) : connexion, liste des PDF, téléchargement.
// Les identifiants viennent uniquement de l'environnement (.env) ; ils ne vont jamais au navigateur.
import { HttpError } from "./validation";

export interface ExternalDocument {
  id: string;
  title: string;
  /** AAAA-MM-JJ, ou "" si le site n'en donne pas. */
  date: string;
  /** Nom du classeur qui contient le document. */
  folder: string;
}

export interface Session { base: string; cookie: string }

const TIMEOUT_MS = 20_000;

/** Les trois variables du site externe sont-elles renseignées ? */
export function isExternalConfigured(): boolean {
  const { SYNDIC_SITE_URL: url, SYNDIC_SITE_USER: login, SYNDIC_SITE_PASSWORD: password } = process.env;
  return !!(url && login && password);
}

function settings(): { base: string; login: string; password: string } {
  const { SYNDIC_SITE_URL: url, SYNDIC_SITE_USER: login, SYNDIC_SITE_PASSWORD: password } = process.env;
  if (!url || !login || !password) {
    throw new HttpError(503, "Site externe non configuré : renseignez SYNDIC_SITE_URL, SYNDIC_SITE_USER et SYNDIC_SITE_PASSWORD dans le fichier .env, puis relancez le serveur.");
  }
  return { base: url.replace(/\/+$/, ""), login, password };
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, "Le site externe ne répond pas.");
  }
}

/** Se connecte et renvoie le cookie de session à présenter aux requêtes suivantes. */
export async function connect(): Promise<Session> {
  const { base, login, password } = settings();
  const res = await send(`${base}/authenticate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password }),
    // une redirection ferait perdre le cookie de session : on le lit sur la réponse d'origine
    redirect: "manual",
  });
  await res.body?.cancel();
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (res.status === 401 || res.status === 403 || (res.status < 400 && !cookie)) {
    throw new HttpError(502, "Le site externe a refusé les identifiants du fichier .env.");
  }
  if (res.status >= 400) throw new HttpError(502, `Connexion au site externe impossible (code ${res.status}).`);
  return { base, cookie };
}

async function getFrom(s: Session, path: string): Promise<Response> {
  const res = await send(s.base + path, { headers: { cookie: s.cookie } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(502, `Le site externe a refusé la requête (code ${res.status}).`);
  }
  return res;
}

interface FolderInfo { id: number; nom: string; fileCount: number }
interface DocumentInfo { id: number; title: string; file_name: string; mime_type: string; date_commit?: string | null }

const SORT = "sortColumn=date_commit&sortOrder=DESC";
const PAGE_SIZE = 100;
/** Garde-fou contre un site qui répondrait indéfiniment de nouveaux documents. */
const MAX_PAGES = 50;

/** AAAA-MM-JJ tiré de la date du site, ou "" si elle manque ou n'est pas lisible. */
const isoDay = (raw: unknown): string => {
  const day = typeof raw === "string" ? raw.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
};

/**
 * Tous les documents d'un classeur. On ne se fie pas à la taille de page réellement appliquée par le site :
 * on lit les pages jusqu'à avoir les `expected` documents annoncés par le classeur, ou jusqu'à une page qui
 * n'apporte rien de nouveau (page vide, ou site qui ignorerait le numéro de page).
 */
async function folderDocuments(s: Session, folderId: number, expected: number): Promise<DocumentInfo[]> {
  const byId = new Map<number, DocumentInfo>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getFrom(
      s, `/api/extranet/coproprietaire/documents/classeur/${folderId}?${SORT}&itemCountPerPage=${PAGE_SIZE}&currentPageNumber=${page}`);
    const batch = ((await res.json()) as { data?: { Documents?: DocumentInfo[] } }).data?.Documents ?? [];
    const before = byId.size;
    for (const d of batch) byId.set(d.id, d);
    if (byId.size === before || byId.size >= expected) break; // plus rien de nouveau, ou tout le classeur est lu
  }
  return [...byId.values()];
}

/** Tous les PDF de tous les classeurs, du plus récent au plus ancien (date vide en dernier). */
export async function listExternalDocuments(existing?: Session): Promise<ExternalDocument[]> {
  const session = existing ?? await connect();
  const root = (await (await getFrom(session, `/api/extranet/coproprietaire/documents/classeur?${SORT}`)).json()) as {
    allClasseurs?: Record<string, FolderInfo>;
  };
  const folders = Object.values(root.allClasseurs ?? {}).filter((f) => f.fileCount > 0);
  const lists = await Promise.all(
    folders.map(async (f) =>
      (await folderDocuments(session, f.id, f.fileCount))
        .filter((d) => d.mime_type === "application/pdf")
        .map((d): ExternalDocument => ({
          id: String(d.id),
          title: d.title || d.file_name,
          date: isoDay(d.date_commit),
          folder: f.nom,
        }))),
  );
  return lists.flat().sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

/** Télécharge un PDF du site externe. */
export async function downloadExternalDocument(id: string, s?: Session): Promise<Buffer> {
  if (!/^\d+$/.test(id)) throw new HttpError(400, "Identifiant de document invalide.");
  s ??= await connect();
  const buffer = Buffer.from(await (await getFrom(s, `/api/extranet/documents/download/${id}`)).arrayBuffer());
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(502, "Le site externe n'a pas renvoyé un PDF.");
  return buffer;
}
