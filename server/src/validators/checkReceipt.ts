import type { AppConfig } from "../config/config";
import { toBaseCurrency } from "./currency";
import type { CheckResult, ClaimInput } from "./types";

const CHECK = "receipt";

// Policy section 9: a receipt is required above the threshold (in INR). The
// threshold is compared after conversion, so a USD 10 claim (INR 830) needs one.
export function checkReceipt(
  claim: Pick<ClaimInput, "amount" | "currency" | "receiptAvailable">,
  config: AppConfig,
): CheckResult[] {
  if (claim.receiptAvailable) return [];

  const amountInBase = toBaseCurrency(claim.amount, claim.currency, config);
  if (amountInBase === null) return []; // unknown currency is reported by validateFields

  const threshold = config.receiptRequiredAbove;
  const details = { amountInBase, threshold, baseCurrency: config.baseCurrency };

  if (amountInBase > threshold) {
    return [
      {
        checkName: CHECK,
        severity: "warning",
        message: `Missing receipt for ${config.baseCurrency} ${amountInBase} (receipts required above ${threshold}); needs an explanation and reviewer approval`,
        details: { ...details, policySections: ["9.1", "9.3"] },
      },
    ];
  }
  return [
    {
      checkName: CHECK,
      severity: "info",
      message: `No receipt; allowed at or below ${config.baseCurrency} ${threshold} with a short explanation`,
      details: { ...details, policySections: ["9.2"] },
    },
  ];
}
