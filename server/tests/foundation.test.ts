import { describe, expect, it } from "vitest";
import { config, configSchema } from "../src/config/config";
import { openDb } from "../src/db/db";

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

describe("database", () => {
  function insertClaim(db: ReturnType<typeof openDb>): number {
    const info = db
      .prepare(
        `INSERT INTO claims (claimant, date, category, amount, currency, description, receipt_available)
         VALUES ('Asha', '2026-10-01', 'meals', 900, 'INR', 'Lunch', 1)`,
      )
      .run();
    return Number(info.lastInsertRowid);
  }

  it("applies the schema and is safe to apply twice", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(["ai_reviews", "audit_events", "claims", "decisions", "validation_results"]);
    expect(() => openDb(":memory:")).not.toThrow();
  });

  it("makes audit_events append-only", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO audit_events (actor, action) VALUES ('system', 'test')").run();
    expect(() => db.prepare("UPDATE audit_events SET actor = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
  });

  it("requires a reason for reject decisions at the DB level", () => {
    const db = openDb(":memory:");
    const claimId = insertClaim(db);
    const insert = db.prepare(
      "INSERT INTO decisions (claim_id, reviewer, action, reason) VALUES (?, 'Kashish', 'reject', ?)",
    );
    expect(() => insert.run(claimId, "   ")).toThrow(/CHECK constraint/);
    expect(() => insert.run(claimId, "Personal expense")).not.toThrow();
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO validation_results (claim_id, check_name, severity, message) VALUES (999, 'x', 'info', 'm')").run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
