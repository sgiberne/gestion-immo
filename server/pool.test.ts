import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapPool", () => {
  it("garde l'ordre des résultats et respecte la limite de tâches simultanées", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6], 2, async (n) => {
      peak = Math.max(peak, ++running);
      await pause(n);
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60]);
    expect(peak).toBe(2);
  });

  it("accepte une liste vide", async () => {
    expect(await mapPool([], 4, async (n: number) => n)).toEqual([]);
  });

  it("propage la première erreur et ne lance plus de nouvel élément", async () => {
    const started: number[] = [];
    await expect(mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await pause(1);
      if (n === 2) throw new Error("boum");
      return n;
    })).rejects.toThrow("boum");
    expect(started.length).toBeLessThan(6);
  });
});
