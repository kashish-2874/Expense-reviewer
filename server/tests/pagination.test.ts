import { MongoClient } from "mongodb";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { MockAiClient } from "../src/ai/client";
import { createClaim } from "../src/claims/createClaim";
import { config } from "../src/config/config";
import { collections } from "../src/db/collections";
import { listClaimsPage } from "../src/db/repository";
import { TODAY, buildApp, createAdmin, loggedInAgent } from "./helpers/testApp";
import { useTestDatabase } from "./helpers/testDatabase";

// GET /api/claims?page=&limit=&status= returns { items, page, limit, total, totalPages }.

const t = useTestDatabase();
let agent: Awaited<ReturnType<typeof loggedInAgent>>;

const TOTAL = 23; // 3 pages of 10: 10 + 10 + 3

beforeEach(async () => {
  for (let i = 1; i <= TOTAL; i++) {
    // Different claimants and dates, so no duplicate flags get in the way.
    await createClaim(
      t.store,
      config,
      { claimant: `Person ${i}`, date: "2026-10-01", category: "meals", amount: 100 + i, currency: "INR", description: `Lunch ${i}`, receiptAvailable: true },
      TODAY,
    );
  }
  const app = buildApp(t.store, new MockAiClient());
  await createAdmin(t.store);
  agent = await loggedInAgent(app);
});

const ids = (body: { items: { id: number }[] }) => body.items.map((c) => c.id);
const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i); // descending

describe("claims list pagination", () => {
  it("defaults to page 1 with 10 claims, newest first", async () => {
    const res = await agent.get("/api/claims");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: TOTAL, totalPages: 3 });
    expect(ids(res.body)).toEqual(range(23, 14));
    // Each item still carries the reviewer's summary fields.
    expect(res.body.items[0]).toMatchObject({ status: "submitted", latestAi: null, validationCounts: { error: 0, warning: 0, info: 0 } });
  });

  it("honours a custom limit", async () => {
    const res = await agent.get("/api/claims?limit=25");
    expect(res.body).toMatchObject({ page: 1, limit: 25, total: TOTAL, totalPages: 1 });
    expect(res.body.items).toHaveLength(TOTAL);
  });

  it("returns a partial last page", async () => {
    const res = await agent.get("/api/claims?page=3");
    expect(ids(res.body)).toEqual([3, 2, 1]);
    expect(res.body).toMatchObject({ page: 3, total: TOTAL, totalPages: 3 });
  });

  it("returns an empty page beyond the end, with correct totals", async () => {
    const res = await agent.get("/api/claims?page=4");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 4, limit: 10, total: TOTAL, totalPages: 3 });
  });

  it("combines the status filter with pagination; totals reflect the filter", async () => {
    // Test-only shortcut: mark claims 1-7 approved directly.
    await collections(t.store.db).claims.updateMany({ claimNumber: { $lte: 7 } }, { $set: { status: "approved" } });

    const first = await agent.get("/api/claims?status=approved&limit=5");
    expect(first.body).toMatchObject({ page: 1, limit: 5, total: 7, totalPages: 2 });
    expect(ids(first.body)).toEqual([7, 6, 5, 4, 3]);

    const second = await agent.get("/api/claims?status=approved&limit=5&page=2");
    expect(ids(second.body)).toEqual([2, 1]);

    const submitted = await agent.get("/api/claims?status=submitted&limit=50");
    expect(submitted.body).toMatchObject({ total: 16, totalPages: 1 });
    expect(ids(submitted.body)).toEqual(range(23, 8));
  });

  it.each([
    ["limit=51", "limit"],
    ["limit=0", "limit"],
    ["page=0", "page"],
    ["page=abc", "page"],
    ["limit=2.5", "limit"],
    ["status=paid", "status"],
  ])("rejects %s with a 400 naming the field", async (query, field) => {
    const res = await agent.get(`/api/claims?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toEqual([expect.objectContaining({ path: field })]);
  });

  it("uses the same small number of queries whatever the page size (no query per claim)", async () => {
    // A second client that reports every command it sends to MongoDB.
    const client = await MongoClient.connect(inject("mongoUri"), { monitorCommands: true });
    try {
      const db = client.db(t.store.db.databaseName);
      const commandsFor = async (limit: number) => {
        const seen: string[] = [];
        const listener = (e: { commandName: string }) => seen.push(e.commandName);
        client.on("commandStarted", listener);
        const page = await listClaimsPage(db, { page: 1, limit });
        client.off("commandStarted", listener);
        return { items: page.items.length, commands: seen.sort() };
      };

      const small = await commandsFor(5);
      const large = await commandsFor(TOTAL);
      expect(small.items).toBe(5);
      expect(large.items).toBe(TOTAL);
      // page + total + validation counts + latest AI = 4, for 5 claims or 23.
      expect(large.commands).toEqual(small.commands);
      expect(small.commands).toEqual(["aggregate", "aggregate", "aggregate", "find"]);
    } finally {
      await client.close();
    }
  });

  it("keeps a stable order when claims share the same createdAt", async () => {
    // Force a tie on the primary sort key; claimNumber must break it.
    await collections(t.store.db).claims.updateMany({}, { $set: { createdAt: new Date("2026-10-09T10:00:00Z") } });

    const pages = [];
    for (let page = 1; page <= 5; page++) pages.push(...ids((await agent.get(`/api/claims?limit=5&page=${page}`)).body));
    expect(pages).toEqual(range(23, 1)); // every claim exactly once, in claimNumber order

    // And the same request twice gives the same page.
    const again = ids((await agent.get("/api/claims?limit=5&page=3")).body);
    expect(again).toEqual(range(13, 9));
  });
});
