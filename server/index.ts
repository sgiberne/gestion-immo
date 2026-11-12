// Point d'entrée : prépare les données, puis démarre le serveur. L'ordre est important.
import fs from "node:fs";
import { createApp } from "./app";
import { backupDir, dbFile, port } from "./config";
import { backupDatabase } from "./dailyBackup";
import { openDb } from "./db";
import { startExternalWatch } from "./externalWatch";
import { generateRecurrences } from "./recurrenceService";
import { migrate } from "./schema";

fs.mkdirSync(backupDir, { recursive: true });
backupDatabase(dbFile, backupDir); // avant l'ouverture : on copie la base telle qu'elle était
openDb(dbFile);
migrate();
generateRecurrences();
startExternalWatch();

createApp().listen(port, () => console.log(`Gestion immo : http://localhost:${port}  (base : ${dbFile})`));
