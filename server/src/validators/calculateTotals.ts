import type { AppConfig } from "../config/config";
import { roundMoney, toBaseCurrency } from "./currency";
import type { ClaimInput } from "./types";

export interface Totals {
  baseCurrency: string;
  byClaimant: Record<string, number>;
  byCategory: Record<string, number>;
  grandTotal: number;
  claimCount: number;
  // Claims left out because their currency has no configured rate.
  skippedClaimCount: number;
}

// Sums claims in the base currency. Which claims to include (e.g. leaving out
// rejected ones) and which category to use (e.g. a reviewer override) is the
// caller's decision; this function only does the arithmetic.
export function calculateTotals(
  claims: Pick<ClaimInput, "claimant" | "category" | "amount" | "currency">[],
  config: AppConfig,
): Totals {
  const byClaimant: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let grandTotal = 0;
  let skippedClaimCount = 0;

  for (const claim of claims) {
    const amount = toBaseCurrency(claim.amount, claim.currency, config);
    if (amount === null) {
      skippedClaimCount++;
      continue;
    }
    const claimant = claim.claimant.trim();
    byClaimant[claimant] = roundMoney((byClaimant[claimant] ?? 0) + amount);
    byCategory[claim.category] = roundMoney((byCategory[claim.category] ?? 0) + amount);
    grandTotal = roundMoney(grandTotal + amount);
  }

  return {
    baseCurrency: config.baseCurrency,
    byClaimant,
    byCategory,
    grandTotal,
    claimCount: claims.length - skippedClaimCount,
    skippedClaimCount,
  };
}
