import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteInstance: Database.Database | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "panelshelf.db");
  sqliteInstance = new Database(dbPath);
  sqliteInstance.pragma("journal_mode = WAL");
  sqliteInstance.pragma("foreign_keys = ON");

  dbInstance = drizzle(sqliteInstance, { schema });
  return dbInstance;
}

export function getSqlite() {
  if (!sqliteInstance) getDb();
  return sqliteInstance!;
}
