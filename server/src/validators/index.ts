import type { AppConfig } from "../config/config";
import { checkCategoryLimit } from "./checkCategoryLimit";
import { checkDuplicates } from "./checkDuplicates";
import { checkReceipt } from "./checkReceipt";
import type { CheckResult, ClaimInput, ExistingClaim } from "./types";
import { validateFields } from "./validateFields";

export { calculateTotals } from "./calculateTotals";
export type { Totals } from "./calculateTotals";
export { toBaseCurrency } from "./currency";
export type { CheckResult, ClaimInput, ExistingClaim, Severity } from "./types";
export { checkCategoryLimit, checkDuplicates, checkReceipt, validateFields };

// Runs every per-claim check in a fixed order. Field errors come first; the
// money and duplicate checks still run so the reviewer sees every issue at once.
export function runAllValidators(
  claim: ClaimInput,
  existing: ExistingClaim[],
  config: AppConfig,
  today: string,
): CheckResult[] {
  return [
    ...validateFields(claim, config, today),
    ...checkDuplicates(claim, existing, config),
    ...checkReceipt(claim, config),
    ...checkCategoryLimit(claim, config),
  ];
}
