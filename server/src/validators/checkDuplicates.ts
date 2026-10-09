import type { AppConfig } from "../config/config";
import type { CheckResult, ClaimInput, ExistingClaim } from "./types";

const CHECK = "duplicate";

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

// Jaccard similarity of the word sets: |A ∩ B| / |A ∪ B|, from 0 (no shared
// words) to 1 (same words). Simple and explainable; good enough for short text.
export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const union = new Set([...ta, ...tb]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / union.size;
}

const sameClaimant = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Compares a claim with the claims already stored. `existing` must not contain
// the claim itself. An exact match is an error; a same-day claim with a similar
// description is a warning. Both go to a human; neither rejects automatically.
export function checkDuplicates(claim: ClaimInput, existing: ExistingClaim[], config: AppConfig): CheckResult[] {
  const exactIds: number[] = [];
  const possible: { id: number; similarity: number }[] = [];

  for (const other of existing) {
    if (!sameClaimant(claim.claimant, other.claimant) || claim.date !== other.date) continue;

    const isExact =
      claim.amount === other.amount && claim.currency === other.currency && claim.category === other.category;
    if (isExact) {
      exactIds.push(other.id);
      continue;
    }

    const similarity = descriptionSimilarity(claim.description, other.description);
    if (similarity >= config.duplicate.descriptionSimilarityThreshold) {
      possible.push({ id: other.id, similarity: Math.round(similarity * 100) / 100 });
    }
  }

  const results: CheckResult[] = [];
  if (exactIds.length > 0) {
    results.push({
      checkName: CHECK,
      severity: "error",
      message: `Exact duplicate of claim(s) ${exactIds.join(", ")}: same claimant, date, amount, currency and category`,
      details: { kind: "exact", matchingClaimIds: exactIds, policySections: ["10.1", "10.2"] },
    });
  }
  if (possible.length > 0) {
    results.push({
      checkName: CHECK,
      severity: "warning",
      message: `Possible duplicate of claim(s) ${possible.map((p) => p.id).join(", ")}: same claimant and date with a similar description`,
      details: {
        kind: "possible",
        matchingClaimIds: possible.map((p) => p.id),
        similarities: possible,
        policySections: ["10.2"],
      },
    });
  }
  return results;
}
