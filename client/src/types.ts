// Shapes returned by the server API (see server/src/db/repository.ts).

export type ClaimStatus = "submitted" | "under_review" | "approved" | "rejected" | "clarification_requested";
export type Severity = "info" | "warning" | "error";
export type Verdict = "comply" | "needs_clarification" | "needs_review";
export type DecisionAction = "approve" | "reject" | "request_clarification" | "override_category";

export interface ClaimInput {
  claimant: string;
  date: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  receiptAvailable: boolean;
}

export interface Claim extends ClaimInput {
  id: number;
  status: ClaimStatus;
  finalCategory: string | null;
  createdAt: string;
}

export interface ClaimSummary extends Claim {
  validationCounts: Record<Severity, number>;
  latestAi: { status: string; verdict: Verdict | null; category: string | null; uncertain: boolean | null } | null;
}

export interface ValidationResult {
  id: number;
  checkName: string;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface Citation {
  section: string;
  quote: string;
  verified: boolean;
  reason?: string;
}

export interface AiReview {
  id: number;
  status: "ok" | "unavailable" | "invalid_output";
  category: string | null;
  confidence: number | null;
  uncertain: boolean | null;
  verdict: Verdict | null;
  explanation: string | null;
  citedSections: Citation[];
  questions: string[];
  model: string;
  promptVersion: string;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

export interface Decision {
  id: number;
  reviewer: string;
  action: DecisionAction;
  reason: string | null;
  overrideCategory: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface ClaimDetail extends Claim {
  validationResults: ValidationResult[];
  aiReviews: AiReview[]; // newest first
  decisions: Decision[]; // newest first
  auditEvents: AuditEvent[]; // newest first
}

export interface Totals {
  baseCurrency: string;
  byClaimant: Record<string, number>;
  byCategory: Record<string, number>;
  grandTotal: number;
  claimCount: number;
  skippedClaimCount: number;
}

export interface AppConfig {
  baseCurrency: string;
  currencies: string[];
  receiptRequiredAbove: number;
  categories: { key: string; label: string; perClaimLimit: number }[];
}
