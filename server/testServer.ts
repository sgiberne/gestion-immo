// Démarre le vrai serveur (server/index.ts) dans un processus séparé, avec une base temporaire,
// pour les tests d'intégration de l'API.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export interface TestServer {
  base: string;
  dir: string;
  stop(): Promise<void>;
}

/**
 * `seed` permet de préparer le dossier de données (ex. une ancienne base) avant le démarrage ;
 * `env` ajoute des variables d'environnement. Le site externe est désactivé par défaut (valeurs vides,
 * qui l'emportent sur le vrai fichier .env).
 */
export async function startTestServer(seed?: (dir: string) => void, env: Record<string, string> = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immo-test-"));
  seed?.(dir);
  const port = await freePort();
  let output = "";
  let exited = false;
  const proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      SYNDIC_SITE_URL: "",
      SYNDIC_SITE_USER: "",
      SYNDIC_SITE_PASSWORD: "",
      ...env,
      PORT: String(port),
      DATA_DIR: dir,
    },
  });
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  proc.once("exit", () => (exited = true));

  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (exited) throw new Error(`Le serveur s'est arrêté au démarrage :\n${output}`);
    try {
      if ((await fetch(`${base}/api/properties`)).ok) break;
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(`Le serveur n'a pas démarré à temps :\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base,
    dir,
    async stop() {
      proc.kill();
      await new Promise<void>((resolve) => (exited ? resolve() : proc.once("exit", () => resolve())));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
