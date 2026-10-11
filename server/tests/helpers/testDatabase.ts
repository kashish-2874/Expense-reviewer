import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, inject } from "vitest";
import { connectStore, type Store } from "../../src/db/mongo";
import { setupDatabase } from "../../src/db/setup";

// Gives every test a fresh, fully set-up database (validators + indexes) on
// the shared in-memory replica set, and drops it afterwards. Usage:
//   const t = useTestDatabase();
//   it("...", async () => { await something(t.store) });
export function useTestDatabase(): { store: Store } {
  const ref = {} as { store: Store };
  let base: Store;

  beforeAll(async () => {
    base = await connectStore(inject("mongoUri"), "unused");
  });
  beforeEach(async () => {
    const db = base.client.db(`test_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
    await setupDatabase(db);
    ref.store = { client: base.client, db };
  });
  afterEach(async () => {
    await ref.store.db.dropDatabase();
  });
  afterAll(async () => {
    await base.client.close();
  });

  return ref;
}
