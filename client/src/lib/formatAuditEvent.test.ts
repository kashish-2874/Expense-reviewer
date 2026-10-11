import { describe, expect, it } from "vitest";
import type { AiReview, AppConfig, AuditEvent } from "../types";
import { formatAuditEvent } from "./formatAuditEvent";

// Run by the server's vitest (see server/vitest.config.mts), so the client
// needs no test dependency of its own.

const config: AppConfig = {
  baseCurrency: "INR",
  currencies: ["INR", "USD"],
  receiptRequiredAbove: 500,
  categories: [
    { key: "meals", label: "Meals", perClaimLimit: 1500 },
    { key: "travel_transport", label: "Travel and Transport", perClaimLimit: 3000 },
    { key: "client_entertainment", label: "Client Entertainment", perClaimLimit: 6000 },
  ],
};

// 14:25 UTC is 7:55 PM in India; the time zone is pinned so the test is stable anywhere.
const ctx = { config, timeZone: "Asia/Kolkata" };

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return { id: "65f0c0ffee0000000000aa01", actor: "Kashish", action: "", before: null, after: null, reason: null, createdAt: "2026-10-10 14:25:00", ...overrides };
}

describe("formatAuditEvent", () => {
  it("describes a submitted claim with human labels and formats", () => {
    const result = formatAuditEvent(
      event({
        action: "claim_created",
        actor: "Asha Rao",
        after: { claimant: "Asha Rao", date: "2026-10-07", category: "travel_transport", amount: 800, currency: "INR", receiptAvailable: false, status: "submitted" },
      }),
      ctx,
    );
    expect(result).toEqual({
      title: "Claim submitted",
      summary: "Claim submitted by Asha Rao. Travel and Transport, ₹800, no receipt, dated 7 Oct 2026.",
      actor: "Asha Rao",
      timestamp: "10 Oct 2026, 7:55 PM",
    });
  });

  it("shows foreign amounts by currency code and keeps decimals", () => {
    const usd = formatAuditEvent(event({ action: "claim_created", after: { amount: 45.5, currency: "USD", receiptAvailable: true } }), ctx);
    expect(usd.summary).toBe("Claim submitted by Kashish. USD 45.5, receipt attached.");
    const inr = formatAuditEvent(event({ action: "claim_created", after: { amount: 12500, currency: "INR" } }), ctx);
    expect(inr.summary).toContain("₹12,500");
  });

  it("skips missing submission fields instead of printing 'undefined'", () => {
    const result = formatAuditEvent(event({ action: "claim_created", actor: "Asha Rao", after: { category: "meals" } }), ctx);
    expect(result.summary).toBe("Claim submitted by Asha Rao. Meals.");
    const empty = formatAuditEvent(event({ action: "claim_created", actor: "Asha Rao" }), ctx);
    expect(empty.summary).toBe("Claim submitted by Asha Rao.");
  });

  it("describes a successful AI run, taking the confidence from the stored review", () => {
    const aiReviews = [{ id: "65f0c0ffee0000000000aa07", confidence: 0.62 } as AiReview];
    const result = formatAuditEvent(
      event({ action: "ai_review_run", actor: "system", after: { aiReviewId: "65f0c0ffee0000000000aa07", aiStatus: "ok", category: "meals", uncertain: true, verdict: "needs_review" } }),
      { ...ctx, aiReviews },
    );
    expect(result.title).toBe("AI review");
    expect(result.summary).toBe("AI review ran: Meals, confidence 62%, uncertain, needs review.");
  });

  it("leaves out the confidence when the review is not available", () => {
    const result = formatAuditEvent(
      event({ action: "ai_review_run", after: { aiReviewId: "65f0c0ffee0000000000aa99", aiStatus: "ok", category: "travel_transport", uncertain: false, verdict: "comply" } }),
      ctx,
    );
    expect(result.summary).toBe("AI review ran: Travel and Transport, appears to comply.");
  });

  it.each([
    ["unavailable", "AI review unavailable. Manual review needed."],
    ["invalid_output", "AI review returned unusable output. Manual review needed."],
  ])("describes a failed AI run (%s)", (aiStatus, summary) => {
    const result = formatAuditEvent(event({ action: "ai_review_run", after: { aiStatus } }), ctx);
    expect(result).toMatchObject({ title: "AI review failed", summary });
  });

  it.each([
    ["decision_approve", "Approved", "under_review", "approved", "Status changed from Under review to Approved by Kashish."],
    ["decision_reject", "Rejected", "submitted", "rejected", "Status changed from Submitted to Rejected by Kashish."],
    ["decision_request_clarification", "Clarification requested", "under_review", "clarification_requested", "Status changed from Under review to Clarification requested by Kashish."],
  ])("describes %s", (action, title, from, to, summary) => {
    const result = formatAuditEvent(event({ action, before: { status: from }, after: { status: to }, reason: "  Checked receipts  " }), ctx);
    expect(result).toMatchObject({ title, summary, actor: "Kashish", reason: "Checked receipts" });
  });

  it("handles a null `before` on a decision", () => {
    const result = formatAuditEvent(event({ action: "decision_reject", before: null, after: { status: "rejected" } }), ctx);
    expect(result.summary).toBe("Status changed to Rejected by Kashish.");
  });

  it("describes a category override with its reason", () => {
    const result = formatAuditEvent(
      event({
        action: "category_overridden",
        before: { status: "under_review", finalCategory: null, category: "meals" },
        after: { status: "under_review", finalCategory: "client_entertainment", decisionId: 3 },
        reason: "Rahul is a client",
      }),
      ctx,
    );
    expect(result).toMatchObject({
      title: "Category overridden",
      summary: "Category changed from Meals to Client Entertainment.",
      reason: "Rahul is a client",
    });
  });

  it("uses an earlier override as the starting category of a second override", () => {
    const result = formatAuditEvent(
      event({ action: "category_overridden", before: { category: "meals", finalCategory: "client_entertainment" }, after: { finalCategory: "travel_transport" } }),
      ctx,
    );
    expect(result.summary).toBe("Category changed from Client Entertainment to Travel and Transport.");
  });

  it("falls back to a safe generic line for an unknown action", () => {
    expect(formatAuditEvent(event({ action: "claim_archived" }), ctx)).toMatchObject({
      title: "Claim archived",
      summary: "Claim archived recorded by Kashish.",
    });
    expect(formatAuditEvent(event({ action: "" }), ctx).title).toBe("Activity");
  });

  it("never shows raw category keys, even for categories missing from config", () => {
    const result = formatAuditEvent(event({ action: "claim_created", after: { category: "home_office_equipment" } }), ctx);
    expect(result.summary).toBe("Claim submitted by Kashish. Home office equipment.");
    expect(result.summary).not.toContain("_");
  });

  it("survives wrong types and bad timestamps without throwing", () => {
    const result = formatAuditEvent(
      event({ action: "decision_approve", actor: "", before: { status: 42 }, after: { status: null }, createdAt: "not a date", reason: "   " }),
      ctx,
    );
    expect(result).toEqual({
      title: "Approved",
      summary: "Decision recorded by Unknown.",
      actor: "Unknown",
      timestamp: "not a date",
    });
  });
});
