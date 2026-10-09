import pino from "pino";
import { describe, expect, it } from "vitest";
import { verifyCitations } from "../src/ai/citations";
import { MockAiClient, type AiClient, type AiRequest } from "../src/ai/client";
import { loadPolicy, parsePolicy } from "../src/ai/policy";
import { buildPrompt, PROMPT_VERSION } from "../src/ai/prompt";
import { retrieveSections } from "../src/ai/retrieval";
import { runAiReview, UNAVAILABLE_MESSAGE } from "../src/ai/review";
import { config } from "../src/config/config";
import type { ClaimInput } from "../src/validators";

const policy = loadPolicy();
const silent = pino({ level: "silent" });

// Fake client that plays back a scripted list of responses (text or errors).
class ScriptedClient implements AiClient {
  readonly model = "scripted-test-model";
  readonly isMock = true;
  calls: AiRequest[] = [];
  constructor(private readonly script: (string | Error | "hang")[]) {}
  complete(request: AiRequest): Promise<string> {
    this.calls.push(request);
    const next = this.script[this.calls.length - 1];
    if (next === undefined) return Promise.reject(new Error("no scripted response left"));
    if (next === "hang") return new Promise(() => {});
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

function claim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimant: "Asha Rao",
    date: "2026-10-01",
    category: "meals",
    amount: 1200,
    currency: "INR",
    description: "Dinner during client site visit in Pune",
    receiptAvailable: true,
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    category: "meals",
    confidence: 0.92,
    verdict: "comply",
    explanation: "A business meal while travelling, within the per-claim limit.",
    cited_sections: [{ section: "2.1", quote: "Business meals while travelling are reimbursable up to INR 1,500 per claim." }],
    questions_for_claimant: [],
    ...overrides,
  });
}

function review(client: AiClient, c: ClaimInput = claim(), timeoutMs = 1000) {
  return runAiReview(c, { client, policy, config, logger: silent, timeoutMs });
}

describe("parsePolicy", () => {
  it("parses every numbered clause with its group title", () => {
    expect(policy).toHaveLength(28);
    expect(policy[0]).toEqual({
      id: "1.1",
      group: "1",
      title: "General Rules",
      text: "Claims must be submitted within 90 days of the expense date.",
    });
    expect(policy.find((s) => s.id === "10.2")?.title).toBe("Duplicate and Suspicious Claims");
  });

  it("ignores clauses that do not belong to the current heading", () => {
    expect(parsePolicy("## 2. Meals\n2.1 ok\n3.1 stray\n").map((s) => s.id)).toEqual(["2.1"]);
  });
});

describe("retrieveSections", () => {
  const ids = (c: Partial<ClaimInput>) =>
    retrieveSections({ ...claim(), ...c }, policy, config).map((s) => s.id);

  it.each([
    [{ category: "travel_transport", description: "Uber from airport to client office" }, "3.2"],
    [{ category: "lodging", description: "Hotel stay in Bengaluru, 2 nights" }, "4.1"],
    [{ category: "software", description: "Annual Figma subscription for design work" }, "5.1"],
    [{ category: "training", description: "Udemy course on React for my project" }, "8.1"],
    [{ category: "client_entertainment", description: "Dinner with Infosys client to discuss renewal" }, "6.1"],
    [{ category: "office_supplies", description: "Printer paper and pens" }, "7.1"],
  ])("finds the expected clause for %o", (c, expected) => {
    expect(ids(c)).toContain(expected);
  });

  it("still finds the right clause when the claimed category is wrong", () => {
    expect(ids({ category: "meals", description: "Hotel stay in Mumbai for 3 nights" })).toContain("4.1");
  });

  it.each(["meals", "client_entertainment"])(
    "surfaces both meals and client entertainment for an ambiguous team dinner claimed as %s",
    (category) => {
      const result = ids({ category, description: "team dinner with Rahul after the offsite" });
      expect(result).toEqual(expect.arrayContaining(["2.2", "6.1"]));
    },
  );

  it("always adds 1.4 and adds the receipt rules only when the receipt is missing", () => {
    expect(ids({ receiptAvailable: true })).toContain("1.4");
    expect(ids({ receiptAvailable: true })).not.toContain("9.3");
    expect(ids({ receiptAvailable: false })).toEqual(expect.arrayContaining(["1.4", "9.1", "9.2", "9.3"]));
  });

  it("returns sections in policy order", () => {
    const result = ids({ receiptAvailable: false });
    const sorted = [...result].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
    expect(result).toEqual(sorted);
  });
});

describe("buildPrompt", () => {
  it("includes the claim, the converted amount, the sections and the category keys", () => {
    const sections = retrieveSections(claim(), policy, config);
    const { system, user } = buildPrompt(claim({ amount: 20, currency: "USD" }), sections, config);
    expect(system).toMatch(/Use ONLY the policy sections provided/);
    expect(user).toContain("amount: 20 USD (= INR 1660)");
    expect(user).toContain("[2.1] (Meals) Business meals while travelling");
    expect(user).toContain("- client_entertainment: Client Entertainment");
    expect(user).toMatch(/<claim>[\s\S]*Dinner during client site visit[\s\S]*<\/claim>/);
    expect(PROMPT_VERSION).toBe("v1");
  });
});

describe("verifyCitations", () => {
  it("accepts a quote despite case, spacing and curly quotes", () => {
    const [c] = verifyCitations([{ section: "2.3", quote: "“ALCOHOL   is not reimbursable”" }], policy);
    expect(c?.verified).toBe(true);
  });

  it("rejects a section that does not exist", () => {
    const [c] = verifyCitations([{ section: "11.2", quote: "anything" }], policy);
    expect(c).toMatchObject({ verified: false, reason: "Section 11.2 does not exist in the policy" });
  });

  it("rejects a quote that is not in the cited section (even if it is elsewhere)", () => {
    const [c] = verifyCitations([{ section: "2.1", quote: "Alcohol is not reimbursable" }], policy);
    expect(c).toMatchObject({ verified: false, reason: "Quote not found in section 2.1" });
  });

  it("rejects an empty quote", () => {
    expect(verifyCitations([{ section: "2.1", quote: " ... " }], policy)[0]?.verified).toBe(false);
  });
});

describe("runAiReview", () => {
  it("returns a verified, confident finding for a valid response", async () => {
    const client = new ScriptedClient([output()]);
    const result = await review(client);
    expect(result).toMatchObject({
      status: "ok",
      category: "meals",
      confidence: 0.92,
      uncertain: false,
      verdict: "comply",
      model: "scripted-test-model",
      promptVersion: "v1",
      error: null,
    });
    expect(result.citedSections).toEqual([expect.objectContaining({ section: "2.1", verified: true })]);
    expect(result.retrievedSectionIds).toContain("2.1");
    expect(client.calls).toHaveLength(1);
  });

  it("accepts JSON wrapped in a ```json fence", async () => {
    const result = await review(new ScriptedClient(["```json\n" + output() + "\n```"]));
    expect(result.status).toBe("ok");
  });

  it("retries once on malformed JSON, then gives up with invalid_output", async () => {
    const client = new ScriptedClient(["{not json", "Sure! Here is the review: {"]);
    const result = await review(client);
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({
      status: "invalid_output",
      verdict: null,
      category: null,
      explanation: UNAVAILABLE_MESSAGE,
      error: "Model output is not valid JSON",
    });
  });

  it("treats schema violations as invalid_output", async () => {
    const client = new ScriptedClient([output({ category: "gym" }), output({ confidence: 1.5 })]);
    const result = await review(client);
    expect(result.status).toBe("invalid_output");
    expect(result.error).toMatch(/schema validation/);
  });

  it("succeeds when the retry succeeds", async () => {
    const client = new ScriptedClient([new Error("529 overloaded"), output()]);
    const result = await review(client);
    expect(client.calls).toHaveLength(2);
    expect(result.status).toBe("ok");
  });

  it("returns unavailable when the retry also fails", async () => {
    const client = new ScriptedClient([new Error("connection reset"), new Error("connection reset")]);
    const result = await review(client);
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: "unavailable", error: "connection reset", explanation: UNAVAILABLE_MESSAGE });
  });

  it("times out a hanging call and retries", async () => {
    const client = new ScriptedClient(["hang", "hang"]);
    const result = await review(client, claim(), 20);
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: "unavailable", error: "AI call timed out after 20 ms" });
  });

  it("flags a fabricated section and downgrades the verdict to needs_review", async () => {
    const client = new ScriptedClient([
      output({ cited_sections: [{ section: "11.2", quote: "Team dinners are always reimbursable." }] }),
    ]);
    const result = await review(client);
    expect(result.status).toBe("ok");
    expect(result.verdict).toBe("needs_review");
    expect(result.citedSections[0]).toMatchObject({ section: "11.2", verified: false });
    expect(result.explanation).toMatch(/verdict changed from "comply" to "needs_review".*unverified citation/);
  });

  it("flags a quote that is not in the cited section", async () => {
    const client = new ScriptedClient([
      output({ cited_sections: [{ section: "2.1", quote: "up to INR 5,000 per claim" }] }),
    ]);
    const result = await review(client);
    expect(result.verdict).toBe("needs_review");
    expect(result.citedSections[0]?.verified).toBe(false);
  });

  it("keeps verified citations alongside an unverified one", async () => {
    const client = new ScriptedClient([
      output({
        cited_sections: [
          { section: "2.1", quote: "reimbursable up to INR 1,500 per claim" },
          { section: "2.9", quote: "made up" },
        ],
      }),
    ]);
    const result = await review(client);
    expect(result.citedSections.map((c) => c.verified)).toEqual([true, false]);
    expect(result.verdict).toBe("needs_review");
  });

  it("sends a finding with no citations to review", async () => {
    const result = await review(new ScriptedClient([output({ cited_sections: [] })]));
    expect(result.verdict).toBe("needs_review");
    expect(result.explanation).toMatch(/no policy citation/);
  });

  it("marks low confidence as uncertain (threshold is exclusive)", async () => {
    expect((await review(new ScriptedClient([output({ confidence: 0.69 })]))).uncertain).toBe(true);
    expect((await review(new ScriptedClient([output({ confidence: 0.7 })]))).uncertain).toBe(false);
  });

  it("marks an 'unclear' category as uncertain even at high confidence", async () => {
    const result = await review(new ScriptedClient([output({ category: "unclear", confidence: 0.95 })]));
    expect(result.uncertain).toBe(true);
  });

  it("passes questions for the claimant through", async () => {
    const result = await review(
      new ScriptedClient([
        output({ verdict: "needs_clarification", questions_for_claimant: ["Which client attended?"] }),
      ]),
    );
    expect(result.questions).toEqual(["Which client attended?"]);
  });
});

describe("MockAiClient", () => {
  it("produces a labelled, uncertain placeholder review with a verified citation", async () => {
    const result = await review(new MockAiClient());
    expect(result.status).toBe("ok");
    expect(result.model).toMatch(/mock/);
    expect(result.uncertain).toBe(true);
    expect(result.verdict).toBe("needs_review");
    expect(result.explanation).toMatch(/^\[MOCK AI\]/);
    expect(result.citedSections.every((c) => c.verified)).toBe(true);
  });
});
