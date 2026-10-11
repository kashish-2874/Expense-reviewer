import { localToday } from "./clock";
import { config } from "./config/config";
import { env } from "./config/env";
import { connectStore } from "./db/mongo";
import { countClaims } from "./db/repository";
import { setupDatabase } from "./db/setup";
import { seedDemoClaims } from "./seed/demoClaims";

// Loads the demo claims. Usage: npm run seed [-- --reset [--force]]
// The server also seeds automatically when the claims collection is empty, so
// this is mainly for --reset: drop the whole database (the only way to clear
// the append-only audit log) and seed again. --reset is refused in production
// unless --force is also given, so live data cannot be wiped by accident.

async function main() {
  const reset = process.argv.includes("--reset");
  const force = process.argv.includes("--force");
  if (reset && env.NODE_ENV === "production" && !force) {
    throw new Error("Refusing --reset with NODE_ENV=production. Add --force if you really want to wipe the database.");
  }

  const store = await connectStore(env.MONGODB_URI, env.MONGODB_DB);
  try {
    if (reset) {
      await store.db.dropDatabase();
      console.log(`Dropped database "${env.MONGODB_DB}"`);
    }
    await setupDatabase(store.db);

    const count = await countClaims(store.db);
    if (count > 0) {
      console.error(`Database "${env.MONGODB_DB}" already has ${count} claims. Run "npm run seed -- --reset" to start fresh.`);
      process.exitCode = 1;
      return;
    }

    for (const { id, scenario } of await seedDemoClaims(store, config, localToday())) {
      console.log(`#${String(id).padStart(2)}  ${scenario}`);
    }
    console.log(`Seeded "${env.MONGODB_DB}". AI reviews are not pre-run; use "Run AI review" in the UI.`);
  } finally {
    await store.client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
