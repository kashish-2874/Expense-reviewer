import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Finance configuration (limits, FX rates, thresholds). Validated at startup so a
// typo in config.json fails loudly instead of silently disabling a check.

const categorySchema = z.object({
  label: z.string().min(1),
  perClaimLimit: z.number().positive(),
  policySection: z.string().regex(/^\d+$/, "policySection must be a top-level section number"),
});

export const configSchema = z
  .object({
    baseCurrency: z.string().length(3),
    exchangeRates: z.record(z.string().length(3), z.number().positive()),
    receiptRequiredAbove: z.number().nonnegative(),
    dateRules: z.object({
      maxAgeDays: z.number().int().positive(),
      allowFuture: z.boolean(),
    }),
    confidenceThreshold: z.number().min(0).max(1),
    duplicate: z.object({
      descriptionSimilarityThreshold: z.number().min(0).max(1),
    }),
    categories: z
      .record(z.string().regex(/^[a-z_]+$/), categorySchema)
      .refine((c) => Object.keys(c).length > 0, "at least one category is required"),
  })
  // Amounts are converted to the base currency, so its rate must be exactly 1.
  .refine((c) => c.exchangeRates[c.baseCurrency] === 1, {
    message: "exchangeRates must contain the baseCurrency with rate 1",
    path: ["exchangeRates"],
  });

export type AppConfig = z.infer<typeof configSchema>;
export type CategoryConfig = z.infer<typeof categorySchema>;

export const DEFAULT_CONFIG_PATH = path.join(__dirname, "config.json");

export function loadConfig(filePath: string = DEFAULT_CONFIG_PATH): AppConfig {
  const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config at ${filePath}: ${result.error.message}`);
  }
  return result.data;
}

// Loaded once and shared; modules import this instead of re-reading the file.
export const config: AppConfig = loadConfig();
