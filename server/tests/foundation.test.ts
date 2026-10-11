import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { describe, expect, it } from "vitest";
import * as auditRepository from "../src/audit/auditRepository";
import { auditedChange } from "../src/audit/audit";
import { createClaim } from "../src/claims/createClaim";
import { config, configSchema } from "../src/config/config";
import { connectStore } from "../src/db/mongo";
import { countClaims, insertClaim } from "../src/db/repository";
import { setupDatabase } from "../src/db/setup";
import type { ClaimInput } from "../src/validators";
import { useTestDatabase } from "./helpers/testDatabase";

const TODAY = "2026-10-09";
const claim: ClaimInput = {
  claimant: "Asha",
  date: "2026-10-01",
  category: "meals",
  amount: 900,
  currency: "INR",
  description: "Lunch",
  receiptAvailable: true,
};

describe("config", () => {
  it("loads config.json with all seven categories", () => {
    expect(config.baseCurrency).toBe("INR");
    expect(Object.keys(config.categories)).toHaveLength(7);
    expect(config.categories.meals?.perClaimLimit).toBe(1500);
  });

  it("rejects a config whose base currency rate is not 1", () => {
    const broken = { ...config, exchangeRates: { ...config.exchangeRates, INR: 2 } };
    expect(configSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a negative category limit", () => {
    const broken = {
      ...config,
      categories: { meals: { label: "Meals", perClaimLimit: -1, policySection: "2" } },
    };
    expect(configSchema.safeParse(broken).success).toBe(false);
  });
});

describe("database setup", () => {
  const t = useTestDatabase();

  it("creates every collection with its indexes, and is safe to run again", async () => {
    await setupDatabase(t.store.db); // second run (the helper already ran it once)
    const names = (await t.store.db.listCollections().toArray()).map((c) => c.name).sort();
    expect(names).toEqual(["ai_reviews", "audit_events", "claims", "decisions", "users", "validation_results"]);

    const claimIndexes = await t.store.db.collection("claims").indexes();
    expect(claimIndexes.find((i) => i.key.claimNumber === 1)?.unique).toBe(true);
    expect(claimIndexes.map((i) => i.key)).toEqual(
      expect.arrayContaining([{ status: 1, createdAt: -1 }, { createdAt: -1 }]),
    );
    const userIndexes = await t.store.db.collection("users").indexes();
    expect(userIndexes.find((i) => i.key.username === 1)?.unique).toBe(true);
  });

  it("validators refuse bad enum values even when the API is bypassed", async () => {
    const { db } = t.store;
    const now = new Date();
    await expect(db.collection("claims").insertOne({ ...claim, claimNumber: 1, status: "paid", finalCategory: null, createdAt: now })).rejects.toThrow(
      /Document failed validation/,
    );
    await expect(
      db.collection("validation_results").insertOne({ claimNumber: 1, checkName: "x", severity: "fatal", message: "m", createdAt: now }),
    ).rejects.toThrow(/Document failed validation/);
    await expect(
      db.collection("decisions").insertOne({ claimNumber: 1, reviewer: "x", action: "delete_claim", createdAt: now }),
    ).rejects.toThrow(/Document failed validation/);
  });

  it("refuses to start against a standalone server (no transactions)", async () => {
    const standalone = await MongoMemoryServer.create();
    try {
      await expect(connectStore(standalone.getUri(), "x")).rejects.toThrow(/transactions are not supported/);
    } finally {
      await standalone.stop();
    }
  });
});

describe("claim numbers", () => {
  const t = useTestDatabase();

  it("gives concurrent creates unique, gap-free sequential numbers", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createClaim(t.store, config, { ...claim, claimant: `Person ${i}` }, TODAY)),
    );
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});

describe("transactions", () => {
  const t = useTestDatabase();

  it("does not persist the change when the audit insert fails", async () => {
    // An empty actor breaks the audit_events validator, so the audit insert
    // fails after the claim insert has already happened inside the transaction.
    await expect(
      auditedChange(
        t.store,
        (session) => insertClaim(t.store.db, claim, session),
        (claimNumber) => ({ claimNumber, actor: "", action: "claim_created" }),
      ),
    ).rejects.toThrow(/Document failed validation/);

    expect(await countClaims(t.store.db)).toBe(0);
    // The counter increment was rolled back too, so numbering has no gap.
    expect(await createClaim(t.store, config, claim, TODAY)).toBe(1);
  });
});

describe("append-only audit log", () => {
  const srcDir = path.join(__dirname, "../src");
  const sourceFiles = (readdirSync(srcDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.split(path.sep).join("/"));
  const read = (file: string) => readFileSync(path.join(srcDir, file), "utf8");
  const WRITE_CALLS = /\.(update\w*|delete\w*|replace\w*|findOneAnd\w*|bulkWrite|drop\w*)\s*\(/;

  it("exposes only insert and find functions", () => {
    expect(Object.keys(auditRepository).sort()).toEqual(["findAuditEvents", "insertAuditEvent"]);
  });

  it("is touched only by the audit repository (and by setup, for validators and indexes)", () => {
    const users = sourceFiles.filter((f) => read(f).includes("audit_events"));
    expect(users.sort()).toEqual(["audit/auditRepository.ts", "db/setup.ts"]);
  });

  it("has no update, delete or replace calls in the files that touch it", () => {
    for (const file of ["audit/auditRepository.ts", "db/setup.ts"]) {
      expect(read(file), file).not.toMatch(WRITE_CALLS);
    }
  });
});
