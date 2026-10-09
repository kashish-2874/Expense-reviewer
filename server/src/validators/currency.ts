import type { AppConfig } from "../config/config";

// Converts an amount to the base currency (INR) using the static rates in config.
// Returns null for an unknown currency so callers can skip money-based checks;
// validateFields reports the unknown currency itself.
export function toBaseCurrency(amount: number, currency: string, config: AppConfig): number | null {
  const rate = config.exchangeRates[currency];
  if (rate === undefined) return null;
  return roundMoney(amount * rate);
}

// Rounds to 2 decimals so floating-point noise (e.g. 0.1 * 3) never tips a
// boundary comparison like "amount > limit".
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
