import { describe, expect, it } from "vitest";
import { escapeHtml, frDate, fmt, fmtSigned } from "./util";

// Intl insère des espaces insécables : on les normalise pour comparer.
const flat = (s: string) => s.replace(/[\s\u00a0\u202f]/g, " ");

describe("fmt / fmtSigned", () => {
  it("formate des centimes en euros", () => {
    expect(flat(fmt(123456))).toBe("1 234,56 €");
    expect(flat(fmt(5))).toBe("0,05 €");
    expect(flat(fmt(0))).toBe("0,00 €");
  });

  it("affiche le signe d'un solde, sauf pour zéro", () => {
    expect(flat(fmtSigned(1050))).toBe("+10,50 €");
    expect(flat(fmtSigned(-1050))).toMatch(/^[-−]10,50 €$/);
    expect(flat(fmtSigned(0))).toBe("0,00 €");
  });
});

describe("escapeHtml", () => {
  it("échappe les caractères HTML dangereux", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
  it("laisse un texte simple inchangé", () => {
    expect(escapeHtml("Loyer été")).toBe("Loyer été");
  });
});

describe("frDate", () => {
  it("convertit AAAA-MM-JJ en JJ/MM/AAAA", () => {
    expect(frDate("2026-03-07")).toBe("07/03/2026");
  });
});
