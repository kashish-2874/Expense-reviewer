import { z } from "zod";
import type { AiClient } from "../ai/client";
import type { PolicySection } from "../ai/policy";
import type { AppConfig } from "../config/config";
import type { DB } from "../db/db";
import { getClaim, type Claim } from "../db/repository";
import { HttpError, parseInput } from "../errors";

// Everything the routes need, passed in explicitly so tests can swap the DB,
// the AI client and the clock.
export interface AppDeps {
  db: DB;
  config: AppConfig;
  policy: PolicySection[];
  aiClient: AiClient;
  aiTimeoutMs: number;
  today: () => string; // YYYY-MM-DD in local time
}

const idSchema = z.coerce.number().int().positive();

export function parseClaimId(raw: unknown): number {
  return parseInput(idSchema, raw);
}

export function requireClaim(db: DB, id: number): Claim {
  const claim = getClaim(db, id);
  if (!claim) throw new HttpError(404, `Claim ${id} not found`);
  return claim;
}

// Reviewer names are free text (no auth in scope), but must not be blank.
export const reviewerName = z.string().trim().min(1, "Reviewer name is required").max(100);
