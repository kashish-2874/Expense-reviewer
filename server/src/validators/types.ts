// Shared shapes for the deterministic validators. These validators never call the
// AI and never touch the DB: callers pass in everything they need.

export type Severity = "info" | "warning" | "error";

export interface CheckResult {
  checkName: string;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClaimInput {
  claimant: string;
  date: string; // YYYY-MM-DD
  category: string;
  amount: number;
  currency: string;
  description: string;
  receiptAvailable: boolean;
}

export interface ExistingClaim extends ClaimInput {
  id: number;
}
