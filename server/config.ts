import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = process.env.DATA_DIR ?? path.join(root, "data");
export const backupDir = path.join(dataDir, "backups");
export const dbFile = path.join(dataDir, "immo.db");
export const distDir = path.join(root, "dist");
export const port = Number(process.env.PORT ?? 3000);
