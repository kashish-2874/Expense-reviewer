import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Opens the SQLite database and applies schema.sql. Every statement in the schema
// uses IF NOT EXISTS, so re-applying it on each startup is safe.

export type DB = Database.Database;

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export function openDb(dbPath: string): DB {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  // SQLite ignores REFERENCES clauses unless this is switched on per connection.
  db.pragma("foreign_keys = ON");
  // WAL lets reads continue while a write is in progress.
  if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}
