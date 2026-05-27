import { getSqlite } from "./index";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

export function runMigrations() {
  const db = getSqlite();

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  if (!fs.existsSync(migrationsDir)) {
    console.log("No migrations directory found.");
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((r: any) => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping already applied migration: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`Applying migration: ${file}`);

    db.exec("BEGIN TRANSACTION");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
      console.log(`  ✓ ${file}`);
    } catch (err) {
      db.exec("ROLLBACK");
      console.error(`  ✗ ${file}:`, err);
      throw err;
    }
  }
}

// Run if called directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations();
  console.log("Migrations complete.");
}
