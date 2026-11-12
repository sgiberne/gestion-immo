import { describe, expect, it } from "vitest";
import { readZip } from "./fixtures/zip";
import { createZip } from "./zip";

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
