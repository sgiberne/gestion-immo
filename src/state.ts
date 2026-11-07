import { api } from "./api";
import type { Property } from "./types";

const KEY = "gestion-immo:property";

export const state = { properties: [] as Property[], currentId: "" };

export const current = (): Property => state.properties.find((p) => p.id === state.currentId)!;

export async function loadProperties(): Promise<void> {
  state.properties = await api<Property[]>("/api/properties");
  if (!state.properties.some((p) => p.id === state.currentId)) {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignoré */ }
    state.currentId = (state.properties.find((p) => p.id === saved) ?? state.properties[0]).id;
  }
}

export function setCurrent(id: string): void {
  state.currentId = id;
  try { localStorage.setItem(KEY, id); } catch { /* ignoré */ }
}
