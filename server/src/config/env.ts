import "dotenv/config";
import { z } from "zod";

// Environment variables (secrets and deploy-specific settings). Kept separate from
// config.json because those are business rules, while these vary per machine.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Must point at a replica set (Atlas, or a local one): transactions need it.
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required (see .env.example)"),
  MONGODB_DB: z.string().min(1).default("expense_review"),
  // Checked at startup by auth/config.ts (required in production).
  JWT_SECRET: z.string().optional(),
  // The admin account is created from these if it does not exist yet.
  ADMIN_USERNAME: z.string().trim().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Optional: without a key the app uses a clearly labelled mock AI so it still demos.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env: Env = parsed.data;
