import "dotenv/config";
import { z } from "zod";

// Environment variables (secrets and deploy-specific settings). Kept separate from
// config.json because those are business rules, while these vary per machine.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().min(1).default("data/expense-review.db"),
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
