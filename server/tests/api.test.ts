import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AiClient } from "../src/ai/client";
import { loadPolicy } from "../src/ai/policy";
import { createApp } from "../src/app";
import { config } from "../src/config/config";
import { openDb, type DB } from "../src/db/db";

const TODAY = "2026-10-09";

// Fake AI that returns whatever the current test queued (or fails).
class FakeAi implements AiClient {
  readonly model = "fake-model";
  readonly isMock = true;
  queue: (string | Error)[] = [];
  async complete(): Promise<string> {
    const next = this.queue.shift() ?? new Error("AI down");
    if (next instanceof Error) throw next;
    return next;
  }
}

const aiOutput = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: "client_entertainment",
    confidence: 0.55,
    verdict: "needs_clarification",
    explanation: "Could be a team meal or client entertainment.",
    cited_sections: [{ section: "6.2", quote: "The client name and the business purpose must be stated in the description." }],
    questions_for_claimant: ["Was Rahul a client?"],
    ...overrides,
  });

const validClaim = {
  claimant: "Asha Rao",
  date: "2026-10-01",
  category: "meals",
  amount: 1200,
  currency: "INR",
  description: "Team dinner with Rahul after the offsite",
  receiptAvailable: true,
};

let db: DB;
let ai: FakeAi;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(":memory:");
  ai = new FakeAi();
  app = createApp(
    { db, config, policy: loadPolicy(), aiClient: ai, aiTimeoutMs: 500, today: () => TODAY },
    pino({ level: "silent" }),
  );
});

async function createClaim(overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/claims").send({ ...validClaim, ...overrides });
  expect(res.status).toBe(201);
  return res.body as { id: number; validationResults: { checkName: string; severity: string; details: Record<string, unknown> }[] };
}

const decide = (id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/claims/${id}/decision`).send({ reviewer: "Kashish", ...body });

describe("claims API", () => {
  it("creates a claim, runs validators and stores the results", async () => {
    const claim = await createClaim({ amount: 2000, receiptAvailable: false });
    expect(claim).toMatchObject({ status: "submitted", receiptAvailable: false, finalCategory: null });
    expect(claim.validationResults.map((r) => `${r.checkName}:${r.severity}`)).toEqual([
      "receipt:warning",
      "category_limit:warning",
    ]);
  });

  it("stores business-rule problems as flags instead of refusing the claim", async () => {
    const claim = await createClaim({ date: "2026-12-01" });
    expect(claim.validationResults[0]).toMatchObject({ checkName: "fields", severity: "error" });
  });

  it("rejects structurally invalid input with a consistent error body", async () => {
    const res = await request(app).post("/api/claims").send({ ...validClaim, amount: -5, claimant: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(["amount", "claimant"]);
  });

  it("rejects a malformed JSON body", async () => {
    const res = await request(app).post("/api/claims").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Request body is not valid JSON" });
  });

  it("detects exact and near duplicates through the API", async () => {
    const first = await createClaim();
    const exact = await createClaim({ claimant: "asha rao", description: "Dinner" });
    expect(exact.validationResults).toContainEqual(
      expect.objectContaining({ severity: "error", details: expect.objectContaining({ kind: "exact", matchingClaimIds: [first.id] }) }),
    );

    const near = await createClaim({ amount: 1150, description: "team dinner with Rahul after offsite" });
    const dup = near.validationResults.find((r) => r.checkName === "duplicate");
    expect(dup).toMatchObject({ severity: "warning", details: { kind: "possible" } });
    expect(dup?.details.matchingClaimIds).toContain(first.id);
  });

  it("lists claims with validation counts, latest AI flags and a status filter", async () => {
    const a = await createClaim({ amount: 2000, receiptAvailable: false });
    await createClaim({ claimant: "Vikram", description: "Printer paper", category: "office_supplies", amount: 300 });
    ai.queue.push(aiOutput());
    await request(app).post(`/api/claims/${a.id}/review`).send({});

    const all = await request(app).get("/api/claims");
    expect(all.body).toHaveLength(2);
    const listed = all.body.find((c: { id: number }) => c.id === a.id);
    expect(listed).toMatchObject({
      status: "under_review",
      validationCounts: { error: 0, warning: 2, info: 0 },
      latestAi: { status: "ok", uncertain: true, verdict: "needs_clarification" },
    });

    const filtered = await request(app).get("/api/claims?status=submitted");
    expect(filtered.body.map((c: { claimant: string }) => c.claimant)).toEqual(["Vikram"]);

    const bad = await request(app).get("/api/claims?status=paid");
    expect(bad.status).toBe(400);
  });

  it("returns 404 for an unknown claim and 400 for a bad id", async () => {
    expect((await request(app).get("/api/claims/999")).status).toBe(404);
    expect((await request(app).get("/api/claims/abc")).status).toBe(400);
    expect((await request(app).get("/api/nope")).body.error).toMatch(/Route not found/);
  });
});

describe("AI review API", () => {
  it("stores every run as a new row and moves the claim to under_review", async () => {
    const { id } = await createClaim();
    ai.queue.push(aiOutput(), aiOutput({ confidence: 0.9, category: "meals" }));

    const first = await request(app).post(`/api/claims/${id}/review`).send({ reviewer: "Kashish" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: "ok", uncertain: true, promptVersion: "v1", model: "fake-model" });
    expect(first.body.citedSections[0]).toMatchObject({ section: "6.2", verified: true });

    await request(app).post(`/api/claims/${id}/review`).send({});
    const detail = await request(app).get(`/api/claims/${id}`);
    expect(detail.body.status).toBe("under_review");
    expect(detail.body.aiReviews.map((r: { category: string }) => r.category)).toEqual(["meals", "client_entertainment"]);
  });

  it("stores an 'unavailable' review instead of failing when the AI is down", async () => {
    const { id } = await createClaim();
    const res = await request(app).post(`/api/claims/${id}/review`).send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "unavailable", explanation: "AI unavailable, manual review needed", error: "AI down" });

    // The reviewer can still decide manually.
    expect((await decide(id, { action: "approve" })).status).toBe(201);
  });
});

describe("decisions API", () => {
  it("approves a claim and refuses further decisions", async () => {
    const { id } = await createClaim();
    const res = await decide(id, { action: "approve" });
    expect(res.status).toBe(201);
    expect(res.body.claim.status).toBe("approved");

    const again = await decide(id, { action: "reject", reason: "changed my mind" });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already approved/);
    expect((await request(app).post(`/api/claims/${id}/review`).send({})).status).toBe(409);
  });

  it.each(["reject", "request_clarification"])("requires a reason to %s", async (action) => {
    const { id } = await createClaim();
    const res = await decide(id, { action, reason: "   " });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([expect.objectContaining({ path: "reason" })]);
    expect((await request(app).get(`/api/claims/${id}`)).body.status).toBe("submitted");
  });

  it("also enforces the reason rule in the database itself", () => {
    db.prepare("INSERT INTO claims (claimant, date, category, amount, currency, description, receipt_available) VALUES ('a','2026-10-01','meals',1,'INR','d',1)").run();
    expect(() =>
      db.prepare("INSERT INTO decisions (claim_id, reviewer, action) VALUES (1, 'x', 'reject')").run(),
    ).toThrow(/CHECK constraint/);
  });

  it("requires a reviewer name", async () => {
    const { id } = await createClaim();
    const res = await request(app).post(`/api/claims/${id}/decision`).send({ action: "approve", reviewer: " " });
    expect(res.status).toBe(400);
  });

  it("requires a reason to approve over a validation error", async () => {
    await createClaim();
    const { id } = await createClaim(); // exact duplicate -> error
    const res = await decide(id, { action: "approve" });
    expect(res.status).toBe(400);
    expect(res.body.details.validationErrors[0]).toMatch(/Exact duplicate/);
    expect((await decide(id, { action: "approve", reason: "Two separate dinners, receipts checked" })).status).toBe(201);
  });

  it("overrides the category with a reason, keeping the AI output untouched", async () => {
    const { id } = await createClaim({ amount: 5000 }); // over the meals limit (1500)
    ai.queue.push(aiOutput());
    const aiRes = await request(app).post(`/api/claims/${id}/review`).send({});

    expect((await decide(id, { action: "override_category", overrideCategory: "client_entertainment" })).status).toBe(400);
    expect((await decide(id, { action: "override_category", overrideCategory: "gym", reason: "x" })).status).toBe(400);

    const res = await decide(id, { action: "override_category", overrideCategory: "client_entertainment", reason: "Rahul is a client" });
    expect(res.status).toBe(201);
    expect(res.body.claim).toMatchObject({ category: "meals", finalCategory: "client_entertainment", status: "under_review" });

    const detail = (await request(app).get(`/api/claims/${id}`)).body;
    expect(detail.aiReviews[0]).toEqual(aiRes.body); // AI output unchanged
    expect(detail.validationResults.at(-1)).toMatchObject({
      checkName: "category_limit",
      severity: "info",
      message: "After override to Client Entertainment: within the per-claim limit",
    });
    expect(detail.auditEvents[0]).toMatchObject({
      action: "category_overridden",
      actor: "Kashish",
      reason: "Rahul is a client",
      before: { finalCategory: null, category: "meals" },
      after: { finalCategory: "client_entertainment" },
    });
  });

  it("refuses an override to the category the claim already has", async () => {
    const { id } = await createClaim();
    const res = await decide(id, { action: "override_category", overrideCategory: "meals", reason: "same" });
    expect(res.status).toBe(400);
  });
});

describe("history", () => {
  it("shows every step of the full flow, newest first", async () => {
    const { id } = await createClaim();
    ai.queue.push(aiOutput());
    await request(app).post(`/api/claims/${id}/review`).send({ reviewer: "Kashish" });
    await decide(id, { action: "request_clarification", reason: "Was Rahul a client?" });
    await decide(id, { action: "override_category", overrideCategory: "client_entertainment", reason: "Confirmed client" });
    await decide(id, { action: "approve" });

    const detail = (await request(app).get(`/api/claims/${id}`)).body;
    expect(detail.status).toBe("approved");
    expect(detail.auditEvents.map((e: { action: string; actor: string }) => `${e.action}/${e.actor}`)).toEqual([
      "decision_approve/Kashish",
      "category_overridden/Kashish",
      "decision_request_clarification/Kashish",
      "ai_review_run/Kashish",
      "claim_created/Asha Rao",
    ]);
    expect(detail.decisions.map((d: { action: string }) => d.action)).toEqual([
      "approve",
      "override_category",
      "request_clarification",
    ]);
    expect(detail.auditEvents[3].after).toMatchObject({ aiStatus: "ok", status: "under_review" });
  });

  it("rolls back the change when the audit write fails, and vice versa", async () => {
    const { id } = await createClaim();
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
    const res = await decide(id, { action: "approve" });
    expect(res.status).toBe(500);
    expect(res.body.details.requestId).toBeTruthy();
    db.exec("DROP TRIGGER fail_audit");
    expect((await request(app).get(`/api/claims/${id}`)).body.status).toBe("submitted");
  });
});

describe("totals and health", () => {
  it("totals non-rejected claims in INR using the final category", async () => {
    const a = await createClaim({ currency: "USD", amount: 10 }); // INR 830
    const b = await createClaim({ claimant: "Vikram", amount: 500, description: "Lunch" });
    await createClaim({ claimant: "Vikram", amount: 999, description: "Something else", date: "2026-10-02" });
    await decide(a.id, { action: "override_category", overrideCategory: "client_entertainment", reason: "client" });
    await decide(b.id, { action: "reject", reason: "personal" });

    const res = await request(app).get("/api/totals");
    expect(res.body).toMatchObject({
      baseCurrency: "INR",
      byClaimant: { "Asha Rao": 830, Vikram: 999 },
      byCategory: { client_entertainment: 830, meals: 999 },
      grandTotal: 1829,
      claimCount: 2,
    });
  });

  it("serves the built client when configured, but keeps JSON 404s for /api", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "client-"));
    writeFileSync(path.join(dir, "index.html"), "<html>app</html>");
    const withClient = createApp(
      { db, config, policy: loadPolicy(), aiClient: ai, aiTimeoutMs: 500, today: () => TODAY },
      pino({ level: "silent" }),
      { clientDir: dir },
    );
    expect((await request(withClient).get("/")).text).toBe("<html>app</html>");
    expect((await request(withClient).get("/some/page")).text).toBe("<html>app</html>");
    const api404 = await request(withClient).get("/api/nope");
    expect(api404.status).toBe(404);
    expect(api404.body.error).toMatch(/Route not found/);
  });

  it("exposes the form options from config", async () => {
    const res = await request(app).get("/api/config");
    expect(res.body.currencies).toEqual(["INR", "USD", "EUR", "GBP"]);
    expect(res.body.categories[0]).toEqual({ key: "meals", label: "Meals", perClaimLimit: 1500 });
  });

  it("reports health and echoes a request id", async () => {
    const res = await request(app).get("/api/health").set("x-request-id", "test-123");
    expect(res.body).toEqual({ status: "ok", db: "ok", ai: { mode: "mock", model: "fake-model" } });
    expect(res.headers["x-request-id"]).toBe("test-123");
  });
});
