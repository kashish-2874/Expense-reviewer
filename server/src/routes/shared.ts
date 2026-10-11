import { z } from "zod";
import type { AiClient } from "../ai/client";
import type { PolicySection } from "../ai/policy";
import type { AppConfig } from "../config/config";
import type { Store } from "../db/mongo";
import { getClaim, type Claim } from "../db/repository";
import { HttpError, parseInput } from "../errors";
import type { ClientSession } from "mongodb";

// Everything the routes need, passed in explicitly so tests can swap the
// database, the AI client and the clock.
export interface AppDeps {
  store: Store;
  config: AppConfig;
  policy: PolicySection[];
  aiClient: AiClient;
  aiTimeoutMs: number;
  today: () => string; // YYYY-MM-DD in local time
  auth: {
    jwtSecret: string;
    secureCookies: boolean; // true in production (HTTPS only)
  };
}

const idSchema = z.coerce.number().int().positive();

export function parseClaimId(raw: unknown): number {
  return parseInput(idSchema, raw);
}

export async function requireClaim(store: Store, id: number, session?: ClientSession): Promise<Claim> {
  const claim = await getClaim(store.db, id, session);
  if (!claim) throw new HttpError(404, `Claim ${id} not found`);
  return claim;
}
