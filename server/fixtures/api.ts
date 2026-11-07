// Client d'API et scénarios de test : fixtures qui parlent au vrai serveur lancé par testServer.ts.
import { afterAll, beforeAll, expect } from "vitest";
import { startTestServer, type TestServer } from "../testServer";
import { entryBody, ruleBody } from "./data";

export interface Res { status: number; body: any }

/** Petit client JSON de l'API, avec des raccourcis pour préparer des données. */
export class Api {
  constructor(public base = "") {}

  async call(method: string, url: string, body?: unknown): Promise<Res> {
    const res = await fetch(this.base + url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  /** Envoie un corps tel quel (non sérialisé) : pour tester du JSON mal formé. */
  async raw(method: string, url: string, body: string): Promise<Res> {
    const res = await fetch(this.base + url, { method, headers: { "content-type": "application/json" }, body });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  get = (url: string) => this.call("GET", url);
  post = (url: string, body?: unknown) => this.call("POST", url, body);
  put = (url: string, body?: unknown) => this.call("PUT", url, body);
  del = (url: string) => this.call("DELETE", url);

  /** Crée un logement (avec ses catégories par défaut) et renvoie son id. */
  async property(name = "Logement test"): Promise<string> {
    const r = await this.post("/api/properties", { name });
    expect(r.status).toBe(201);
    return r.body.id;
  }

  async categoryId(propertyId: string, name = "Loyer"): Promise<string> {
    const r = await this.get(`/api/properties/${propertyId}/categories`);
    return r.body.find((c: { name: string; id: string }) => c.name === name).id;
  }

  entries = async (propertyId: string): Promise<any[]> => (await this.get(`/api/properties/${propertyId}/entries`)).body;
  rules = async (propertyId: string): Promise<any[]> => (await this.get(`/api/properties/${propertyId}/recurrences`)).body;
  entryOn = async (propertyId: string, date: string): Promise<any> => (await this.entries(propertyId)).find((e) => e.date === date);

  /** Ajoute une opération (valeurs de `entryBody` par défaut) et renvoie son id. */
  async addEntry(propertyId: string, over: object = {}, category = "Loyer"): Promise<string> {
    const r = await this.post(`/api/properties/${propertyId}/entries`, entryBody(await this.categoryId(propertyId, category), over));
    expect(r.status).toBe(201);
    return r.body.id;
  }

  /** Ajoute une règle (valeurs de `ruleBody` par défaut) et renvoie son id. */
  async addRule(propertyId: string, over: object = {}, category = "Loyer"): Promise<string> {
    const r = await this.post(`/api/properties/${propertyId}/recurrences`, ruleBody(await this.categoryId(propertyId, category), over));
    expect(r.status).toBe(201);
    return r.body.id;
  }
}

/** Démarre un serveur pour tout le fichier de test (beforeAll/afterAll) et renvoie son client d'API. */
export function useTestServer(): Api {
  const api = new Api();
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer();
    api.base = srv.base;
  });
  afterAll(async () => {
    await srv.stop();
  });
  return api;
}

/** Serveur éphémère pour un seul test (base neuve, ou préparée par `seed`), arrêté et nettoyé ensuite. */
export async function withTestServer(fn: (api: Api) => Promise<void>, seed?: (dir: string) => void): Promise<void> {
  const srv = await startTestServer(seed);
  try {
    await fn(new Api(srv.base));
  } finally {
    await srv.stop();
  }
}

// --- Scénarios -----------------------------------------------------------------------------------------

/** Un logement avec la règle de loyer passée de `ruleBody` : 6 échéances déjà créées (voir PAST_RULE_DATES). */
export async function rentalWithPastRule(api: Api, name = "Location") {
  const pid = await api.property(name);
  const cat = await api.categoryId(pid);
  const ruleId = await api.addRule(pid);
  return { pid, cat, ruleId };
}
