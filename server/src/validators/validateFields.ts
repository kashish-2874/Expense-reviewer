import type { AppConfig } from "../config/config";
import type { CheckResult, ClaimInput } from "./types";

const CHECK = "fields";
const DAY_MS = 24 * 60 * 60 * 1000;

// True only for a real calendar date in strict YYYY-MM-DD form. Date.UTC silently
// rolls 2026-02-30 over to 2026-03-02, so we round-trip and compare.
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// Whole days from `from` to `to`; both must already be valid ISO dates.
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function error(message: string, details?: Record<string, unknown>): CheckResult {
  return { checkName: CHECK, severity: "error", message, details };
}

// Checks required fields and their formats. `today` (YYYY-MM-DD) is passed in
// rather than read from the clock so the function stays pure and testable.
export function validateFields(claim: Partial<ClaimInput>, config: AppConfig, today: string): CheckResult[] {
  const results: CheckResult[] = [];

  for (const field of ["claimant", "date", "category", "currency", "description"] as const) {
    const value = claim[field];
    if (typeof value !== "string" || value.trim() === "") {
      results.push(error(`Missing required field: ${field}`, { field, policySection: "1.2" }));
    }
  }
  if (typeof claim.receiptAvailable !== "boolean") {
    results.push(error("Missing required field: receiptAvailable", { field: "receiptAvailable" }));
  }

  if (claim.amount === undefined) {
    results.push(error("Missing required field: amount", { field: "amount", policySection: "1.2" }));
  } else if (!Number.isFinite(claim.amount) || claim.amount <= 0) {
    results.push(error("Amount must be greater than zero", { field: "amount", value: claim.amount }));
  }

  if (claim.currency?.trim() && config.exchangeRates[claim.currency] === undefined) {
    results.push(
      error(`Unsupported currency: ${claim.currency}`, {
        field: "currency",
        supported: Object.keys(config.exchangeRates),
      }),
    );
  }

  if (claim.category?.trim() && config.categories[claim.category] === undefined) {
    results.push(
      error(`Unknown category: ${claim.category}`, {
        field: "category",
        allowed: Object.keys(config.categories),
      }),
    );
  }

  if (claim.date?.trim()) {
    if (!isValidIsoDate(claim.date)) {
      results.push(error(`Invalid date: ${claim.date} (expected a real YYYY-MM-DD date)`, { field: "date" }));
    } else {
      const ageDays = daysBetween(claim.date, today);
      if (ageDays < 0 && !config.dateRules.allowFuture) {
        results.push(error(`Date ${claim.date} is in the future`, { field: "date", today }));
      } else if (ageDays > config.dateRules.maxAgeDays) {
        results.push(
          error(`Date ${claim.date} is ${ageDays} days old (limit ${config.dateRules.maxAgeDays})`, {
            field: "date",
            ageDays,
            maxAgeDays: config.dateRules.maxAgeDays,
            policySection: "1.1",
          }),
        );
      }
    }
  }

  return results;
}
