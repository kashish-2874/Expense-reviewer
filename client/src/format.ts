import type { AppConfig, ClaimStatus, Verdict } from "./types";

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`; // unknown currency code
  }
}

// SQLite stores datetime('now') as UTC "YYYY-MM-DD HH:MM:SS" without a zone.
export function formatTimestamp(sqliteUtc: string): string {
  const d = new Date(`${sqliteUtc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? sqliteUtc : d.toLocaleString();
}

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  clarification_requested: "Clarification requested",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  comply: "Appears to comply",
  needs_clarification: "Needs clarification",
  needs_review: "Needs review",
};

export function categoryLabel(config: AppConfig | undefined, key: string | null): string {
  if (!key) return "—";
  if (key === "unclear") return "Unclear";
  return config?.categories.find((c) => c.key === key)?.label ?? key;
}
