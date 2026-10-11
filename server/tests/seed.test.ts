import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config/config";
import { countClaims, listAuditEvents, listValidationResults } from "../src/db/repository";
import { seedDemoClaims, seedIfEmpty } from "../src/seed/demoClaims";
import { useTestDatabase } from "./helpers/testDatabase";

// Guards the demo: every seeded scenario must actually trigger the check it is
// meant to show, so a validator change cannot silently break the walkthrough.

const TODAY = "2026-10-09";
const t = useTestDatabase();

describe("demo seed data", () => {
  let seeded: { id: number; scenario: string }[];
  beforeEach(async () => {
    seeded = await seedDemoClaims(t.store, config, TODAY);
  });

  const flags = async (scenario: string) => {
    const claim = seeded.find((s) => s.scenario.startsWith(scenario));
    if (!claim) throw new Error(`No seeded scenario "${scenario}"`);
    return (await listValidationResults(t.store.db, claim.id)).map((r) => `${r.checkName}:${r.severity}`);
  };

  it("seeds about a dozen claims, numbered 1..n, each with an audit event", async () => {
    expect(seeded.length).toBeGreaterThanOrEqual(12);
    expect(seeded.map((s) => s.id)).toEqual(seeded.map((_, i) => i + 1));
    for (const { id } of seeded) {
      expect((await listAuditEvents(t.store.db, id)).map((e) => e.action)).toEqual(["claim_created"]);
    }
  });

  it.each([
    ["clean claim", []],
    ["exact duplicate", ["duplicate:error"]],
    ["near duplicate", ["duplicate:warning"]],
    ["missing receipt above", ["receipt:warning"]],
    ["missing receipt below", ["receipt:info"]],
    ["over-limit travel", ["category_limit:warning"]],
    ["USD claim", []],
    ["ambiguous", ["category_limit:warning"]],
    ["client entertainment", []],
    ["lodging missing nights", ["category_limit:warning"]],
    ["future date", ["fields:error"]],
    ["too old", ["fields:error"]],
  ])("%s -> %j", async (scenario, expected) => {
    expect(await flags(scenario)).toEqual(expected);
  });

  it("auto-seeds only an empty database", async () => {
    // beforeEach already seeded this database, so startup seeding must skip it.
    expect(await seedIfEmpty(t.store, config, TODAY)).toBe(0);
    expect(await countClaims(t.store.db)).toBe(seeded.length);
  });
});

describe("seedIfEmpty on an empty database", () => {
  it("seeds the demo claims", async () => {
    const count = await seedIfEmpty(t.store, config, TODAY);
    expect(count).toBeGreaterThanOrEqual(12);
    expect(await countClaims(t.store.db)).toBe(count);
  });
});
