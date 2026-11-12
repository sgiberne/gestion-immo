import { HttpError } from "./validation";

/** Extrait le texte d'un PDF, une chaîne par ligne visuelle (regroupées par ordonnée), page après page. */
export async function extractPdfText(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const byY = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 3);
        const list = byY.get(y) ?? [];
        list.push({ x: item.transform[4], s: item.str });
        byY.set(y, list);
      }
      [...byY.entries()]
        .sort((a, b) => b[0] - a[0])
        .forEach(([, list]) => lines.push(list.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim()));
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

const norm = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s/g, " ").toUpperCase();

/** Premier montant (« 1 234,56 ») d'un texte, en centimes ; null s'il n'y en a pas. */
export function parseAmount(text: string): number | null {
  const m = /(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d)/.exec(text.replace(/\s/g, " "));
  if (!m) return null;
  return parseInt(m[1].replace(/[ .]/g, ""), 10) * 100 + parseInt(m[2], 10);
}

export type Analysis = { label: string; cents: number };

/** « Appel de fonds » : cherche « MONTANT A REGLER » et le montant associé, et le titre du document. */
export function analyzeFundCall(lines: string[]): Analysis {
  let cents: number | null = null;
  for (let i = 0; i < lines.length && cents === null; i++) {
    const n = norm(lines[i]);
    const at = n.search(/MONTANT\s+A\s+REGLER/);
    if (at < 0) continue;
    const after = lines[i].slice(at).replace(/^.*?REGLER|^.*?R[ée]gler/i, "");
    cents = parseAmount(after) ?? parseAmount(lines[i + 1] ?? "");
  }
  if (cents === null || cents <= 0) throw new HttpError(422, "Le terme « MONTANT A REGLER » et son montant sont introuvables dans ce PDF.");

  const title =
    lines.find((l) => /\b\d+\s*(?:er|ère|ere|e|ème|eme)?\s+appels?\s+de\s+fonds?\b/i.test(l)) ??
    lines.find((l) => /appels?\s+de\s+fonds?/i.test(l));
  const match = title && /\b\d+\s*(?:er|ère|ere|e|ème|eme)?\s+appels?\s+de\s+fonds?\b/i.exec(title);
  const label = (match ? match[0] : (title ?? "Appel de fonds")).trim().slice(0, 80);
  return { label, cents };
}

export const ANALYZERS: Record<string, (lines: string[]) => Analysis> = { appel_de_fonds: analyzeFundCall };
