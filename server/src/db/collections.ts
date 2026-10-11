import type { Db, ObjectId } from "mongodb";
import type { AiReviewRecord } from "../ai/review";
import type { CheckResult } from "../validators";

// Document shapes stored in MongoDB, and typed accessors for each collection.
// Other collections refer to a claim by its human-friendly `claimNumber`.
// The audit log collection is deliberately NOT here: only
// audit/auditRepository.ts may touch it, so nothing else can update or delete
// audit history.

export const CLAIM_STATUSES = ["submitted", "under_review", "approved", "rejected", "clarification_requested"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const DECISION_ACTIONS = ["approve", "reject", "request_clarification", "override_category"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const SEVERITIES = ["info", "warning", "error"] as const;
export const USER_ROLES = ["admin"] as const;

export interface ClaimDoc {
  _id?: ObjectId;
  claimNumber: number;
  claimant: string;
  date: string; // YYYY-MM-DD, as submitted
  category: string;
  amount: number;
  currency: string;
  description: string;
  receiptAvailable: boolean;
  status: ClaimStatus;
  finalCategory: string | null;
  createdAt: Date;
}

export interface ValidationResultDoc {
  _id?: ObjectId;
  claimNumber: number;
  checkName: string;
  severity: CheckResult["severity"];
  message: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AiReviewDoc extends Omit<AiReviewRecord, "retrievedSectionIds"> {
  _id?: ObjectId;
  claimNumber: number;
  createdAt: Date;
}

export interface DecisionDoc {
  _id?: ObjectId;
  claimNumber: number;
  reviewer: string;
  action: DecisionAction;
  reason: string | null;
  overrideCategory: string | null;
  createdAt: Date;
}

export interface UserDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  role: (typeof USER_ROLES)[number];
  createdAt: Date;
}

export interface CounterDoc {
  _id: string; // counter name, e.g. "claimNumber"
  value: number;
}

export function collections(db: Db) {
  return {
    claims: db.collection<ClaimDoc>("claims"),
    validationResults: db.collection<ValidationResultDoc>("validation_results"),
    aiReviews: db.collection<AiReviewDoc>("ai_reviews"),
    decisions: db.collection<DecisionDoc>("decisions"),
    users: db.collection<UserDoc>("users"),
    counters: db.collection<CounterDoc>("counters"),
  };
}
