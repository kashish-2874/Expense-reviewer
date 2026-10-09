import { auditedChange } from "../audit/audit";
import type { AppConfig } from "../config/config";
import type { DB } from "../db/db";
import { findSameDayClaims, insertClaim, insertValidationResults } from "../db/repository";
import { runAllValidators, type ClaimInput } from "../validators";

// Stores a new claim with its validation results and audit event, all in one
// transaction. Shared by the API and the seed script so demo data goes through
// exactly the same checks as real submissions.
export function createClaim(db: DB, config: AppConfig, input: ClaimInput, today: string): number {
  return auditedChange(
    db,
    () => {
      // Duplicate candidates are read inside the transaction so two identical
      // submissions cannot both miss each other.
      const existing = findSameDayClaims(db, input.claimant, input.date);
      const results = runAllValidators(input, existing, config, today);
      const claimId = insertClaim(db, input);
      insertValidationResults(db, claimId, results);
      return claimId;
    },
    (claimId) => ({
      claimId,
      actor: input.claimant,
      action: "claim_created",
      after: { ...input, status: "submitted" },
    }),
  );
}
