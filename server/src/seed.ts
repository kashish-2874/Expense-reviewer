import { existsSync, rmSync } from "node:fs";
import { localToday } from "./clock";
import { config } from "./config/config";
import { env } from "./config/env";
import { openDb } from "./db/db";
import { seedDemoClaims } from "./seed/demoClaims";

// Loads the demo claims. Usage: npm run seed [-- --reset]
// --reset deletes the database file first. That is the only way to clear it,
// because the audit log is append-only by design.

const reset = process.argv.includes("--reset");

if (reset && env.DB_PATH !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(env.DB_PATH + suffix)) rmSync(env.DB_PATH + suffix);
  }
  console.log(`Deleted ${env.DB_PATH}`);
}

const db = openDb(env.DB_PATH);
const { count } = db.prepare("SELECT count(*) AS count FROM claims").get() as { count: number };
if (count > 0) {
  console.error(`${env.DB_PATH} already has ${count} claims. Run "npm run seed -- --reset" to start fresh.`);
  process.exit(1);
}

for (const { id, scenario } of seedDemoClaims(db, config, localToday())) {
  console.log(`#${String(id).padStart(2)}  ${scenario}`);
}
db.close();
console.log(`Seeded ${env.DB_PATH}. AI reviews are not pre-run; use "Run AI review" in the UI.`);
