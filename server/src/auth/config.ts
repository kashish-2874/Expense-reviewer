import { randomBytes } from "node:crypto";
import type { Logger } from "../logger";

// The placeholder values shipped in .env.example. Production must not use them.
export const EXAMPLE_JWT_SECRET = "change-me-to-a-long-random-string";
export const EXAMPLE_ADMIN_PASSWORD = "change-me-before-first-start";

// Anyone who knows the JWT secret can mint a valid session, so production
// refuses to start without a real one. In development a missing secret is
// replaced by a random one (sessions then end whenever the server restarts).
export function resolveJwtSecret(nodeEnv: string, secret: string | undefined, logger: Logger): string {
  const usable = secret && secret !== EXAMPLE_JWT_SECRET;
  if (nodeEnv === "production" && !usable) {
    throw new Error("JWT_SECRET must be set to a long random value in production (not the .env.example placeholder).");
  }
  if (!secret) {
    logger.warn("JWT_SECRET is not set: using a random secret for this run. Logins will not survive a restart.");
    return randomBytes(48).toString("hex");
  }
  if (!usable) logger.warn("JWT_SECRET is still the .env.example placeholder. Change it before deploying.");
  return secret;
}
