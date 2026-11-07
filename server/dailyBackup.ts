import fs from "node:fs";
import path from "node:path";

/** Sauvegarde automatique : une copie de la base par jour (30 dernières conservées).
 *  À appeler AVANT d'ouvrir la base, pour ne pas copier un fichier fraîchement créé et vide. */
export function backupDatabase(dbFile: string, backupDir: string): void {
  if (!fs.existsSync(dbFile)) return;
  const dest = path.join(backupDir, `immo-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(dest)) fs.copyFileSync(dbFile, dest);
  const old = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db")).sort().slice(0, -30);
  for (const f of old) fs.unlinkSync(path.join(backupDir, f));
}
