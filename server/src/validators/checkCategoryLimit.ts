import type { AppConfig } from "../config/config";
import { roundMoney, toBaseCurrency } from "./currency";
import type { CheckResult, ClaimInput } from "./types";

const CHECK = "category_limit";

// Compares the INR amount with the category's per-claim limit. Going over is a
// warning for the reviewer, never an automatic rejection: there can be valid
// reasons (e.g. prior approval) that only a human can weigh.
export function checkCategoryLimit(
  claim: Pick<ClaimInput, "amount" | "currency" | "category">,
  config: AppConfig,
): CheckResult[] {
  const category = config.categories[claim.category];
  const amountInBase = toBaseCurrency(claim.amount, claim.currency, config);
  if (!category || amountInBase === null) return []; // reported by validateFields

  if (amountInBase <= category.perClaimLimit) return [];

  return [
    {
      checkName: CHECK,
      severity: "warning",
      message: `${config.baseCurrency} ${amountInBase} exceeds the ${category.label} limit of ${category.perClaimLimit} per claim; needs reviewer attention`,
      details: {
        amountInBase,
        limit: category.perClaimLimit,
        excess: roundMoney(amountInBase - category.perClaimLimit),
        category: claim.category,
        policySection: category.policySection,
      },
    },
  ];
}
