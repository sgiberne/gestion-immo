import { describe, expect, it } from "vitest";
import { readZip } from "./fixtures/zip";
import { createZip, safeName } from "./zip";

describe("createZip", () => {
  it("range les fichiers avec leur contenu, leur nom (accents compris) et un CRC correct", () => {
    const files = [
      { name: "Appels/2026-09-21 - Appel de fonds.pdf", data: Buffer.from("%PDF-un") },
      { name: "Divers/Règlement.pdf", data: Buffer.from("%PDF-deux") },
    ];
    const read = readZip(createZip(files, new Date(2026, 8, 21, 10, 30, 0)));
    expect(read.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(read.map((f) => f.data.toString())).toEqual(["%PDF-un", "%PDF-deux"]);
    expect(read.every((f) => f.crcOk)).toBe(true);
  });

  it("produit une archive valide même sans fichier", () => {
    expect(readZip(createZip([]))).toEqual([]);
  });
});

describe("safeName", () => {
  it("remplace les séparateurs et caractères interdits", () => {
    expect(safeName('a/b\\c:d*e?"f<g>h|i')).toBe("a-b-c-d-e--f-g-h-i");
  });

  it("neutralise « . », « .. » et les points ou espaces en fin de nom (pas de sortie du dossier)", () => {
    expect(safeName("..")).toBe("document");
    expect(safeName(".")).toBe("document");
    expect(safeName("  ")).toBe("document");
    expect(safeName("Classeur. ")).toBe("Classeur");
    expect(safeName("../..")).toBe("..-");
  });

  it("garde un nom ordinaire tel quel", () => {
    expect(safeName("Règlement 2025")).toBe("Règlement 2025");
  });
});
