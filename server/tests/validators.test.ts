import { describe, expect, it } from "vitest";
import { config } from "../src/config/config";
import {
  calculateTotals,
  checkCategoryLimit,
  checkDuplicates,
  checkReceipt,
  runAllValidators,
  validateFields,
  type ClaimInput,
  type ExistingClaim,
} from "../src/validators";
import { descriptionSimilarity } from "../src/validators/checkDuplicates";
import { isValidIsoDate } from "../src/validators/validateFields";

const TODAY = "2026-10-09";

function claim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claimant: "Asha Rao",
    date: "2026-10-01",
    category: "meals",
    amount: 900,
    currency: "INR",
    description: "Dinner with team during Pune site visit",
    receiptAvailable: true,
    ...overrides,
  };
}

const messages = (results: { message: string }[]) => results.map((r) => r.message);

describe("validateFields", () => {
  it("accepts a valid claim", () => {
    expect(validateFields(claim(), config, TODAY)).toEqual([]);
  });

  it("reports each missing required field", () => {
    const results = validateFields({ amount: 100 }, config, TODAY);
    const fields = results.map((r) => r.details?.field);
    expect(fields).toEqual(["claimant", "date", "category", "currency", "description", "receiptAvailable"]);
    expect(results.every((r) => r.severity === "error")).toBe(true);
  });

  it("treats whitespace-only text as missing", () => {
    expect(messages(validateFields(claim({ description: "   " }), config, TODAY))).toEqual([
      "Missing required field: description",
    ]);
  });

  it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])("rejects amount %s", (amount) => {
    expect(messages(validateFields(claim({ amount }), config, TODAY))).toEqual(["Amount must be greater than zero"]);
  });

  it("rejects an unknown currency and category", () => {
    const results = validateFields(claim({ currency: "JPY", category: "gym" }), config, TODAY);
    expect(messages(results)).toEqual(["Unsupported currency: JPY", "Unknown category: gym"]);
  });

  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-5", "05/10/2026", "2026-10-09T00:00"])(
    "rejects invalid date %s",
    (date) => {
      expect(isValidIsoDate(date)).toBe(false);
      expect(validateFields(claim({ date }), config, TODAY)[0]?.message).toMatch(/Invalid date/);
    },
  );

  it("accepts 29 February in a leap year", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects a future date but allows today", () => {
    expect(messages(validateFields(claim({ date: "2026-10-10" }), config, TODAY))).toEqual([
      "Date 2026-10-10 is in the future",
    ]);
    expect(validateFields(claim({ date: TODAY }), config, TODAY)).toEqual([]);
  });

  it("allows future dates when configured", () => {
    const lenient = { ...config, dateRules: { ...config.dateRules, allowFuture: true } };
    expect(validateFields(claim({ date: "2026-12-01" }), lenient, TODAY)).toEqual([]);
  });

  it("allows a date exactly maxAgeDays old and rejects one day older", () => {
    // 2026-07-11 is 90 days before 2026-10-09.
    expect(validateFields(claim({ date: "2026-07-11" }), config, TODAY)).toEqual([]);
    const tooOld = validateFields(claim({ date: "2026-07-10" }), config, TODAY);
    expect(tooOld).toHaveLength(1);
    expect(tooOld[0]?.details).toMatchObject({ ageDays: 91, policySection: "1.1" });
  });
});

describe("checkDuplicates", () => {
  const existing: ExistingClaim[] = [
    { ...claim(), id: 1 },
    { ...claim({ category: "travel_transport", amount: 450, description: "Taxi from the airport to hotel" }), id: 2 },
    { ...claim({ claimant: "Vikram", amount: 450, category: "travel_transport", description: "Taxi from the airport to hotel" }), id: 3 },
  ];

  it("flags an exact duplicate as an error with the matching id", () => {
    const results = checkDuplicates(claim({ description: "different words entirely" }), existing, config);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ severity: "error", details: { kind: "exact", matchingClaimIds: [1] } });
  });

  it("matches claimants case- and whitespace-insensitively", () => {
    const results = checkDuplicates(claim({ claimant: "  asha RAO " }), existing, config);
    expect(results[0]?.details?.matchingClaimIds).toEqual([1]);
  });

  it("flags a near-duplicate description on the same day as a warning", () => {
    // Different amount, so not exact; description differs only by "the".
    const near = claim({ category: "travel_transport", amount: 480, description: "Taxi from airport to hotel" });
    const results = checkDuplicates(near, existing, config);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ severity: "warning", details: { kind: "possible", matchingClaimIds: [2] } });
  });

  it("ignores similar descriptions on a different date or by another claimant", () => {
    const otherDay = claim({ date: "2026-10-02", category: "travel_transport", amount: 450, description: "Taxi from the airport to hotel" });
    expect(checkDuplicates(otherDay, existing, config)).toEqual([]);
  });

  it("ignores same-day claims with dissimilar descriptions", () => {
    const different = claim({ amount: 300, description: "Printer paper for office" });
    expect(checkDuplicates(different, existing, config)).toEqual([]);
  });

  it("computes Jaccard similarity on word sets", () => {
    expect(descriptionSimilarity("Taxi to hotel", "taxi TO hotel!")).toBe(1);
    expect(descriptionSimilarity("Taxi from airport to hotel", "Taxi from the airport to hotel")).toBeCloseTo(5 / 6);
    expect(descriptionSimilarity("lunch", "taxi")).toBe(0);
    expect(descriptionSimilarity("", "")).toBe(0);
  });
});

describe("checkReceipt", () => {
  it("returns nothing when a receipt is attached", () => {
    expect(checkReceipt(claim({ amount: 5000 }), config)).toEqual([]);
  });

  it("warns when the receipt is missing above the threshold, citing 9.1 and 9.3", () => {
    const results = checkReceipt(claim({ amount: 501, receiptAvailable: false }), config);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ severity: "warning", details: { policySections: ["9.1", "9.3"] } });
  });

  it("only notes (info) a missing receipt at exactly the threshold, citing 9.2", () => {
    const results = checkReceipt(claim({ amount: 500, receiptAvailable: false }), config);
    expect(results[0]).toMatchObject({ severity: "info", details: { policySections: ["9.2"] } });
  });

  it("converts currency before comparing (USD 10 = INR 830)", () => {
    const results = checkReceipt(claim({ amount: 10, currency: "USD", receiptAvailable: false }), config);
    expect(results[0]).toMatchObject({ severity: "warning", details: { amountInBase: 830 } });
  });

  it("skips an unknown currency (validateFields reports it)", () => {
    expect(checkReceipt(claim({ currency: "JPY", receiptAvailable: false }), config)).toEqual([]);
  });
});

describe("checkCategoryLimit", () => {
  it("allows an amount exactly at the limit", () => {
    expect(checkCategoryLimit(claim({ amount: 1500 }), config)).toEqual([]);
  });

  it("warns (never errors) just above the limit", () => {
    const results = checkCategoryLimit(claim({ amount: 1500.01 }), config);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      severity: "warning",
      details: { limit: 1500, excess: 0.01, policySection: "2" },
    });
  });

  it("converts to INR before comparing (USD 40 = INR 3320 > travel limit 3000)", () => {
    const results = checkCategoryLimit(claim({ category: "travel_transport", amount: 40, currency: "USD" }), config);
    expect(results[0]).toMatchObject({ details: { amountInBase: 3320, excess: 320 } });
  });

  it("skips unknown categories and currencies", () => {
    expect(checkCategoryLimit(claim({ category: "gym", amount: 99999 }), config)).toEqual([]);
    expect(checkCategoryLimit(claim({ currency: "JPY", amount: 99999 }), config)).toEqual([]);
  });
});

describe("calculateTotals", () => {
  it("sums per claimant and per category in INR", () => {
    const totals = calculateTotals(
      [
        claim({ amount: 900 }),
        claim({ claimant: " Asha Rao", category: "travel_transport", amount: 10, currency: "USD" }),
        claim({ claimant: "Vikram", amount: 0.1 }),
        claim({ claimant: "Vikram", amount: 0.2 }),
      ],
      config,
    );
    expect(totals).toEqual({
      baseCurrency: "INR",
      byClaimant: { "Asha Rao": 1730, Vikram: 0.3 },
      byCategory: { meals: 900.3, travel_transport: 830 },
      grandTotal: 1730.3,
      claimCount: 4,
      skippedClaimCount: 0,
    });
  });

  it("skips claims with an unknown currency and counts them", () => {
    const totals = calculateTotals([claim(), claim({ currency: "JPY" })], config);
    expect(totals.grandTotal).toBe(900);
    expect(totals.skippedClaimCount).toBe(1);
  });

  it("returns zeros for no claims", () => {
    expect(calculateTotals([], config)).toMatchObject({ grandTotal: 0, claimCount: 0, byClaimant: {} });
  });
});

describe("runAllValidators", () => {
  it("collects findings from every check at once", () => {
    const existing: ExistingClaim[] = [{ ...claim({ amount: 2000, receiptAvailable: false }), id: 7 }];
    const results = runAllValidators(claim({ amount: 2000, receiptAvailable: false }), existing, config, TODAY);
    expect(results.map((r) => `${r.checkName}:${r.severity}`)).toEqual([
      "duplicate:error",
      "receipt:warning",
      "category_limit:warning",
    ]);
  });
});
