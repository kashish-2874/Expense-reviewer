import { describe, expect, it } from "vitest";
import { config } from "../src/config/config";
import { openDb } from "../src/db/db";
import { listValidationResults } from "../src/db/repository";
import { seedDemoClaims } from "../src/seed/demoClaims";

// Guards the demo: every seeded scenario must actually trigger the check it is
// meant to show, so a validator change cannot silently break the walkthrough.

const TODAY = "2026-10-09";

describe("demo seed data", () => {
  const db = openDb(":memory:");
  const seeded = seedDemoClaims(db, config, TODAY);
  const flags = (scenario: string) => {
    const claim = seeded.find((s) => s.scenario.startsWith(scenario));
    if (!claim) throw new Error(`No seeded scenario "${scenario}"`);
    return listValidationResults(db, claim.id).map((r) => `${r.checkName}:${r.severity}`);
  };

  it("seeds about a dozen claims, each with an audit event", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(12);
    const { n } = db.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'claim_created'").get() as { n: number };
    expect(n).toBe(seeded.length);
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
  ])("%s -> %j", (scenario, expected) => {
    expect(flags(scenario)).toEqual(expected);
  });
});
