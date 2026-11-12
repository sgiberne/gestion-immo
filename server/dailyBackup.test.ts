import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase } from "./dailyBackup";

let dir: string;
let dbFile: string;
let backupDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "immo-backup-"));
  dbFile = path.join(dir, "immo.db");
  backupDir = path.join(dir, "backups");
  fs.mkdirSync(backupDir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const today = () => `immo-${new Date().toISOString().slice(0, 10)}.db`;

describe("backupDatabase", () => {
  it("ne fait rien si la base n'existe pas encore", () => {
    backupDatabase(dbFile, backupDir);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("copie la base une seule fois par jour", () => {
    fs.writeFileSync(dbFile, "v1");
    backupDatabase(dbFile, backupDir);
    fs.writeFileSync(dbFile, "v2");
    backupDatabase(dbFile, backupDir);
    expect(fs.readdirSync(backupDir)).toEqual([today()]);
    expect(fs.readFileSync(path.join(backupDir, today()), "utf8")).toBe("v1");
  });

  it("ne conserve que les 30 sauvegardes les plus récentes, et ignore les autres fichiers", () => {
    fs.writeFileSync(dbFile, "x");
    for (let i = 1; i <= 35; i++) fs.writeFileSync(path.join(backupDir, `immo-2020-01-${String(i).padStart(2, "0")}.db`), "old");
    fs.writeFileSync(path.join(backupDir, "notes.txt"), "garder");
    backupDatabase(dbFile, backupDir);
    const dbs = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db")).sort();
    expect(dbs).toHaveLength(30);
    expect(dbs).toContain(today());
    expect(dbs).not.toContain("immo-2020-01-01.db");
    expect(fs.existsSync(path.join(backupDir, "notes.txt"))).toBe(true);
  });
});
