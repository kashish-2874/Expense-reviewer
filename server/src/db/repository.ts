import type { AiReviewRecord } from "../ai/review";
import type { CheckResult, ClaimInput, ExistingClaim } from "../validators";
import type { DB } from "./db";

// All SQL lives here. Functions map snake_case rows to camelCase objects and
// contain no business rules; routes decide what is allowed.

export const CLAIM_STATUSES = ["submitted", "under_review", "approved", "rejected", "clarification_requested"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const FINAL_STATUSES: ClaimStatus[] = ["approved", "rejected"];

export interface Claim extends ClaimInput {
  id: number;
  status: ClaimStatus;
  finalCategory: string | null;
  createdAt: string;
}

interface ClaimRow {
  id: number;
  claimant: string;
  date: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  receipt_available: number;
  status: ClaimStatus;
  final_category: string | null;
  created_at: string;
}

const toClaim = (r: ClaimRow): Claim => ({
  id: r.id,
  claimant: r.claimant,
  date: r.date,
  category: r.category,
  amount: r.amount,
  currency: r.currency,
  description: r.description,
  receiptAvailable: r.receipt_available === 1,
  status: r.status,
  finalCategory: r.final_category,
  createdAt: r.created_at,
});

const parseJson = <T>(value: string | null, fallback: T): T => (value ? (JSON.parse(value) as T) : fallback);

// ---- claims ----------------------------------------------------------------

export function insertClaim(db: DB, c: ClaimInput): number {
  const info = db
    .prepare(
      `INSERT INTO claims (claimant, date, category, amount, currency, description, receipt_available)
       VALUES (@claimant, @date, @category, @amount, @currency, @description, @receipt)`,
    )
    .run({ ...c, receipt: c.receiptAvailable ? 1 : 0 });
  return Number(info.lastInsertRowid);
}

export function getClaim(db: DB, id: number): Claim | undefined {
  const row = db.prepare("SELECT * FROM claims WHERE id = ?").get(id) as ClaimRow | undefined;
  return row && toClaim(row);
}

export function updateClaimStatus(db: DB, id: number, status: ClaimStatus): void {
  db.prepare("UPDATE claims SET status = ? WHERE id = ?").run(status, id);
}

export function updateFinalCategory(db: DB, id: number, category: string): void {
  db.prepare("UPDATE claims SET final_category = ? WHERE id = ?").run(category, id);
}

// Candidates for duplicate detection: same claimant (case-insensitive) and date.
export function findSameDayClaims(db: DB, claimant: string, date: string, excludeId?: number): ExistingClaim[] {
  const rows = db
    .prepare("SELECT * FROM claims WHERE lower(trim(claimant)) = lower(trim(?)) AND date = ? AND id != ?")
    .all(claimant, date, excludeId ?? -1) as ClaimRow[];
  return rows.map(toClaim);
}

export interface ClaimSummary extends Claim {
  validationCounts: { error: number; warning: number; info: number };
  latestAi: { status: string; verdict: string | null; category: string | null; uncertain: boolean | null } | null;
}

export function listClaims(db: DB, status?: ClaimStatus): ClaimSummary[] {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT count(*) FROM validation_results v WHERE v.claim_id = c.id AND v.severity = 'error')   AS v_error,
         (SELECT count(*) FROM validation_results v WHERE v.claim_id = c.id AND v.severity = 'warning') AS v_warning,
         (SELECT count(*) FROM validation_results v WHERE v.claim_id = c.id AND v.severity = 'info')    AS v_info,
         a.status AS ai_status, a.verdict AS ai_verdict, a.category AS ai_category, a.uncertain AS ai_uncertain
       FROM claims c
       LEFT JOIN ai_reviews a ON a.id = (SELECT max(id) FROM ai_reviews WHERE claim_id = c.id)
       WHERE (@status IS NULL OR c.status = @status)
       ORDER BY c.id DESC`,
    )
    .all({ status: status ?? null }) as (ClaimRow & {
    v_error: number;
    v_warning: number;
    v_info: number;
    ai_status: string | null;
    ai_verdict: string | null;
    ai_category: string | null;
    ai_uncertain: number | null;
  })[];

  return rows.map((r) => ({
    ...toClaim(r),
    validationCounts: { error: r.v_error, warning: r.v_warning, info: r.v_info },
    latestAi: r.ai_status
      ? {
          status: r.ai_status,
          verdict: r.ai_verdict,
          category: r.ai_category,
          uncertain: r.ai_uncertain === null ? null : r.ai_uncertain === 1,
        }
      : null,
  }));
}

// Claims that count towards totals: everything except rejected claims, using
// the reviewer's category override when there is one.
export function listClaimsForTotals(db: DB): Pick<ClaimInput, "claimant" | "category" | "amount" | "currency">[] {
  return db
    .prepare(
      `SELECT claimant, coalesce(final_category, category) AS category, amount, currency
       FROM claims WHERE status != 'rejected'`,
    )
    .all() as Pick<ClaimInput, "claimant" | "category" | "amount" | "currency">[];
}

// ---- validation results ----------------------------------------------------

export interface StoredCheckResult extends CheckResult {
  id: number;
  createdAt: string;
}

export function insertValidationResults(db: DB, claimId: number, results: CheckResult[]): void {
  const stmt = db.prepare(
    "INSERT INTO validation_results (claim_id, check_name, severity, message, details_json) VALUES (?, ?, ?, ?, ?)",
  );
  for (const r of results) {
    stmt.run(claimId, r.checkName, r.severity, r.message, r.details ? JSON.stringify(r.details) : null);
  }
}

export function listValidationResults(db: DB, claimId: number): StoredCheckResult[] {
  const rows = db
    .prepare("SELECT * FROM validation_results WHERE claim_id = ? ORDER BY id")
    .all(claimId) as {
    id: number;
    check_name: string;
    severity: CheckResult["severity"];
    message: string;
    details_json: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    checkName: r.check_name,
    severity: r.severity,
    message: r.message,
    details: parseJson(r.details_json, undefined),
    createdAt: r.created_at,
  }));
}

// ---- AI reviews ------------------------------------------------------------

export interface StoredAiReview extends Omit<AiReviewRecord, "retrievedSectionIds"> {
  id: number;
  claimId: number;
  createdAt: string;
}

interface AiReviewRow {
  id: number;
  claim_id: number;
  status: AiReviewRecord["status"];
  category: string | null;
  confidence: number | null;
  uncertain: number | null;
  verdict: AiReviewRecord["verdict"];
  explanation: string | null;
  cited_sections_json: string | null;
  questions_json: string | null;
  model: string;
  prompt_version: string;
  latency_ms: number;
  error: string | null;
  created_at: string;
}

const toAiReview = (r: AiReviewRow): StoredAiReview => ({
  id: r.id,
  claimId: r.claim_id,
  status: r.status,
  category: r.category,
  confidence: r.confidence,
  uncertain: r.uncertain === null ? null : r.uncertain === 1,
  verdict: r.verdict,
  explanation: r.explanation,
  citedSections: parseJson(r.cited_sections_json, []),
  questions: parseJson(r.questions_json, []),
  model: r.model,
  promptVersion: r.prompt_version,
  latencyMs: r.latency_ms,
  error: r.error,
  createdAt: r.created_at,
});

// Always a new row: earlier AI runs are history and are never overwritten.
export function insertAiReview(db: DB, claimId: number, r: AiReviewRecord): number {
  const info = db
    .prepare(
      `INSERT INTO ai_reviews (claim_id, status, category, confidence, uncertain, verdict, explanation,
         cited_sections_json, questions_json, model, prompt_version, latency_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      claimId,
      r.status,
      r.category,
      r.confidence,
      r.uncertain === null ? null : r.uncertain ? 1 : 0,
      r.verdict,
      r.explanation,
      JSON.stringify(r.citedSections),
      JSON.stringify(r.questions),
      r.model,
      r.promptVersion,
      r.latencyMs,
      r.error,
    );
  return Number(info.lastInsertRowid);
}

export function getAiReview(db: DB, id: number): StoredAiReview | undefined {
  const row = db.prepare("SELECT * FROM ai_reviews WHERE id = ?").get(id) as AiReviewRow | undefined;
  return row && toAiReview(row);
}

export function listAiReviews(db: DB, claimId: number): StoredAiReview[] {
  const rows = db.prepare("SELECT * FROM ai_reviews WHERE claim_id = ? ORDER BY id DESC").all(claimId) as AiReviewRow[];
  return rows.map(toAiReview);
}

// ---- decisions -------------------------------------------------------------

export const DECISION_ACTIONS = ["approve", "reject", "request_clarification", "override_category"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export interface Decision {
  id: number;
  claimId: number;
  reviewer: string;
  action: DecisionAction;
  reason: string | null;
  overrideCategory: string | null;
  createdAt: string;
}

export function insertDecision(db: DB, d: Omit<Decision, "id" | "createdAt">): number {
  const info = db
    .prepare("INSERT INTO decisions (claim_id, reviewer, action, reason, override_category) VALUES (?, ?, ?, ?, ?)")
    .run(d.claimId, d.reviewer, d.action, d.reason, d.overrideCategory);
  return Number(info.lastInsertRowid);
}

export function listDecisions(db: DB, claimId: number): Decision[] {
  const rows = db.prepare("SELECT * FROM decisions WHERE claim_id = ? ORDER BY id DESC").all(claimId) as {
    id: number;
    claim_id: number;
    reviewer: string;
    action: DecisionAction;
    reason: string | null;
    override_category: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    claimId: r.claim_id,
    reviewer: r.reviewer,
    action: r.action,
    reason: r.reason,
    overrideCategory: r.override_category,
    createdAt: r.created_at,
  }));
}

// ---- audit events (read side; writes go through audit/audit.ts) ------------

export interface StoredAuditEvent {
  id: number;
  claimId: number | null;
  actor: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export function listAuditEvents(db: DB, claimId: number): StoredAuditEvent[] {
  const rows = db.prepare("SELECT * FROM audit_events WHERE claim_id = ? ORDER BY id DESC").all(claimId) as {
    id: number;
    claim_id: number | null;
    actor: string;
    action: string;
    before_json: string | null;
    after_json: string | null;
    reason: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    claimId: r.claim_id,
    actor: r.actor,
    action: r.action,
    before: parseJson(r.before_json, null),
    after: parseJson(r.after_json, null),
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
