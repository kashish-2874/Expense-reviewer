import { auditedChange } from "../audit/audit";
import type { AppConfig } from "../config/config";
import type { Store } from "../db/mongo";
import { findSameDayClaims, insertClaim, insertValidationResults } from "../db/repository";
import { runAllValidators, type ClaimInput } from "../validators";

// Stores a new claim with its validation results and audit event, all in one
// transaction. Shared by the API and the seed script so demo data goes through
// exactly the same checks as real submissions. Returns the claim number.
export function createClaim(store: Store, config: AppConfig, input: ClaimInput, today: string): Promise<number> {
  return auditedChange(
    store,
    async (session) => {
      // Duplicate candidates are read inside the transaction. Claim creation
      // also increments the shared claim counter, so two concurrent
      // submissions conflict and MongoDB retries one of them; the retry then
      // sees the other claim (see db/counters.ts).
      const existing = await findSameDayClaims(store.db, input.claimant, input.date, session);
      const results = runAllValidators(input, existing, config, today);
      const claimNumber = await insertClaim(store.db, input, session);
      await insertValidationResults(store.db, claimNumber, results, session);
      return claimNumber;
    },
    (claimNumber) => ({
      claimNumber,
      actor: input.claimant,
      action: "claim_created",
      after: { ...input, status: "submitted" },
    }),
  );
}
