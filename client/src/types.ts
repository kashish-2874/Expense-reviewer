// Shapes returned by the server API (see server/src/db/repository.ts).
// Claims are identified by their claim number; their sub-records by ObjectId strings.

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

// GET /api/claims
export interface ClaimPage {
  items: ClaimSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// POST /api/claims (public): only a receipt, never the claim's flags or AI output.
export interface ClaimReceipt {
  claimNumber: number;
  status: ClaimStatus;
}

export interface User {
  username: string;
  role: "admin";
}

export interface ValidationResult {
  id: string; // MongoDB ObjectId
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
  id: string; // MongoDB ObjectId
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
  id: string; // MongoDB ObjectId
  reviewer: string;
  action: DecisionAction;
  reason: string | null;
  overrideCategory: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string; // MongoDB ObjectId
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
