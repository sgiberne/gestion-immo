import { afterEach, describe, expect, it, vi } from "vitest";
import { occurrenceDates, STEP, todayLocal } from "./recurrence";

const monthly = (start: string, day: number, until: string, from: string | null = null) =>
  occurrenceDates(start, STEP.monthly, day, null, from, until);

describe("occurrenceDates — mensuelle", () => {
  it("génère une échéance par mois, bornes incluses", () => {
    expect(monthly("2026-01-01", 5, "2026-04-30")).toEqual(["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"]);
  });

  it("ramène un jour inexistant au dernier jour du mois", () => {
    expect(monthly("2026-01-31", 31, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("tient compte des années bissextiles", () => {
    expect(monthly("2024-01-31", 31, "2024-03-31")).toContain("2024-02-29");
    expect(monthly("2025-01-31", 31, "2025-03-31")).toContain("2025-02-28");
  });

  it("ignore l'échéance du mois de départ si elle précède la date de début", () => {
    expect(monthly("2026-01-20", 5, "2026-03-31")).toEqual(["2026-02-05", "2026-03-05"]);
  });

  it("inclut la date limite « until » et exclut le jour d'avant", () => {
    expect(monthly("2026-01-01", 5, "2026-02-05")).toEqual(["2026-01-05", "2026-02-05"]);
    expect(monthly("2026-01-01", 5, "2026-02-04")).toEqual(["2026-01-05"]);
  });

  it("exclut la date « from » (déjà traitée) et garde les suivantes", () => {
    expect(monthly("2026-01-01", 5, "2026-03-31", "2026-02-05")).toEqual(["2026-03-05"]);
  });

  it("ne renvoie rien si la limite précède la date de début", () => {
    expect(monthly("2026-06-01", 5, "2026-05-31")).toEqual([]);
  });

  it("traverse le changement d'année", () => {
    expect(monthly("2026-11-01", 1, "2027-02-28")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });
});

describe("occurrenceDates — trimestrielle", () => {
  it("génère une échéance tous les 3 mois à partir du mois de début", () => {
    expect(occurrenceDates("2026-01-01", STEP.quarterly, 1, null, null, "2026-12-31")).toEqual([
      "2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01",
    ]);
  });

  it("traverse le changement d'année", () => {
    expect(occurrenceDates("2026-11-10", STEP.quarterly, 10, null, null, "2027-06-30")).toEqual([
      "2026-11-10", "2027-02-10", "2027-05-10",
    ]);
  });
});

describe("occurrenceDates — annuelle", () => {
  it("utilise le mois choisi, indépendamment du mois de la date de début", () => {
    expect(occurrenceDates("2026-01-01", STEP.yearly, 15, 10, null, "2028-12-31")).toEqual([
      "2026-10-15", "2027-10-15", "2028-10-15",
    ]);
  });

  it("commence l'année suivante si la date de l'année de départ est déjà passée", () => {
    expect(occurrenceDates("2026-11-01", STEP.yearly, 15, 3, null, "2028-12-31")).toEqual(["2027-03-15", "2028-03-15"]);
  });

  it("sans mois explicite, reprend le mois de la date de début", () => {
    expect(occurrenceDates("2025-03-10", STEP.yearly, 10, null, null, "2026-12-31")).toEqual(["2025-03-10", "2026-03-10"]);
  });

  it("ramène le 29 février au 28 les années non bissextiles", () => {
    expect(occurrenceDates("2026-01-01", STEP.yearly, 29, 2, null, "2029-12-31")).toEqual([
      "2026-02-28", "2027-02-28", "2028-02-29", "2029-02-28",
    ]);
  });
});

describe("todayLocal", () => {
  afterEach(() => vi.useRealTimers());

  it("renvoie la date locale au format AAAA-MM-JJ (pas la date UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59)); // 5 janvier, 23h59 heure locale
    expect(todayLocal()).toBe("2026-01-05");
    vi.setSystemTime(new Date(2026, 11, 31, 0, 1));
    expect(todayLocal()).toBe("2026-12-31");
  });
});
