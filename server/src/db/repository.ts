import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { AiReviewRecord } from "../ai/review";
import { findAuditEvents } from "../audit/auditRepository";
import type { CheckResult, ClaimInput, ExistingClaim } from "../validators";
import {
  collections,
  type ClaimDoc,
  type ClaimStatus,
  type DecisionAction,
  type DecisionDoc,
  type AiReviewDoc,
} from "./collections";
import { nextClaimNumber } from "./counters";

// All database access for claims and their records. Routes and services call
// these functions and never use the driver directly. Functions return plain
// API-shaped objects: claims are identified by `claimNumber` (exposed as `id`),
// other records by their ObjectId as a string.

export { CLAIM_STATUSES, DECISION_ACTIONS, type ClaimStatus, type DecisionAction } from "./collections";
export const FINAL_STATUSES: ClaimStatus[] = ["approved", "rejected"];

// Same text format the API has always returned ("YYYY-MM-DD HH:MM:SS", UTC),
// so the client did not need to change when the database did.
export function toApiTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// ---- claims ----------------------------------------------------------------

export interface Claim extends ClaimInput {
  id: number;
  status: ClaimStatus;
  finalCategory: string | null;
  createdAt: string;
}

const toClaim = (d: ClaimDoc): Claim => ({
  id: d.claimNumber,
  claimant: d.claimant,
  date: d.date,
  category: d.category,
  amount: d.amount,
  currency: d.currency,
  description: d.description,
  receiptAvailable: d.receiptAvailable,
  status: d.status,
  finalCategory: d.finalCategory,
  createdAt: toApiTimestamp(d.createdAt),
});

export async function insertClaim(db: Db, c: ClaimInput, session: ClientSession): Promise<number> {
  const claimNumber = await nextClaimNumber(db, session);
  await collections(db).claims.insertOne(
    { ...c, claimNumber, status: "submitted", finalCategory: null, createdAt: new Date() },
    { session },
  );
  return claimNumber;
}

export function countClaims(db: Db): Promise<number> {
  return collections(db).claims.countDocuments();
}

export async function getClaim(db: Db, id: number, session?: ClientSession): Promise<Claim | undefined> {
  const doc = await collections(db).claims.findOne({ claimNumber: id }, { session });
  return doc ? toClaim(doc) : undefined;
}

export async function updateClaimStatus(db: Db, id: number, status: ClaimStatus, session: ClientSession): Promise<void> {
  await collections(db).claims.updateOne({ claimNumber: id }, { $set: { status } }, { session });
}

export async function updateFinalCategory(db: Db, id: number, category: string, session: ClientSession): Promise<void> {
  await collections(db).claims.updateOne({ claimNumber: id }, { $set: { finalCategory: category } }, { session });
}

// Candidates for duplicate detection: same claimant (case-insensitive, via a
// collation) and same date.
export async function findSameDayClaims(db: Db, claimant: string, date: string, session: ClientSession): Promise<ExistingClaim[]> {
  const docs = await collections(db)
    .claims.find({ claimant: claimant.trim(), date }, { session, collation: { locale: "en", strength: 2 } })
    .toArray();
  return docs.map(toClaim);
}

export interface ClaimSummary extends Claim {
  validationCounts: { error: number; warning: number; info: number };
  latestAi: { status: string; verdict: string | null; category: string | null; uncertain: boolean | null } | null;
}

export interface ClaimPage {
  items: ClaimSummary[];
  page: number;
  limit: number;
  total: number; // claims matching the filter, across all pages
  totalPages: number;
}

// One page of claims, newest first. claimNumber breaks ties between claims
// created in the same millisecond, so the order (and therefore which claim is
// on which page) is always the same. skip/limit is simple and fine at this
// scale; very deep pages would want cursor pagination instead (see README).
// A page past the end simply has no items; the totals are still correct.
export async function listClaimsPage(
  db: Db,
  { status, page, limit }: { status?: ClaimStatus; page: number; limit: number },
): Promise<ClaimPage> {
  const filter = status ? { status } : {};
  const { claims } = collections(db);
  const [docs, total] = await Promise.all([
    claims
      .find(filter)
      .sort({ createdAt: -1, claimNumber: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    claims.countDocuments(filter),
  ]);
  return { items: await summarize(db, docs.map(toClaim)), page, limit, total, totalPages: Math.ceil(total / limit) };
}

// Adds validation counts and the latest AI result to a set of claims (one
// page) using two queries in total, not one per claim.
async function summarize(db: Db, claims: Claim[]): Promise<ClaimSummary[]> {
  if (claims.length === 0) return [];
  const numbers = claims.map((c) => c.id);
  const { validationResults, aiReviews } = collections(db);

  const counts = await validationResults
    .aggregate<{ _id: { claimNumber: number; severity: CheckResult["severity"] }; n: number }>([
      { $match: { claimNumber: { $in: numbers } } },
      { $group: { _id: { claimNumber: "$claimNumber", severity: "$severity" }, n: { $sum: 1 } } },
    ])
    .toArray();

  const latest = await aiReviews
    .aggregate<{ _id: number; status: string; verdict: string | null; category: string | null; uncertain: boolean | null }>([
      { $match: { claimNumber: { $in: numbers } } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$claimNumber",
          status: { $first: "$status" },
          verdict: { $first: "$verdict" },
          category: { $first: "$category" },
          uncertain: { $first: "$uncertain" },
        },
      },
    ])
    .toArray();
  const latestByClaim = new Map(latest.map(({ _id, ...ai }) => [_id, ai]));

  return claims.map((c) => {
    const validationCounts = { error: 0, warning: 0, info: 0 };
    for (const row of counts) if (row._id.claimNumber === c.id) validationCounts[row._id.severity] = row.n;
    return { ...c, validationCounts, latestAi: latestByClaim.get(c.id) ?? null };
  });
}

// Claims that count towards totals: everything except rejected claims, using
// the reviewer's category override when there is one.
export async function listClaimsForTotals(db: Db): Promise<Pick<ClaimInput, "claimant" | "category" | "amount" | "currency">[]> {
  const docs = await collections(db).claims.find({ status: { $ne: "rejected" } }).toArray();
  return docs.map((d) => ({ claimant: d.claimant, category: d.finalCategory ?? d.category, amount: d.amount, currency: d.currency }));
}

// ---- validation results ----------------------------------------------------

export interface StoredCheckResult extends CheckResult {
  id: string;
  createdAt: string;
}

export async function insertValidationResults(db: Db, claimNumber: number, results: CheckResult[], session: ClientSession): Promise<void> {
  if (results.length === 0) return;
  const createdAt = new Date();
  await collections(db).validationResults.insertMany(
    results.map((r) => ({ claimNumber, checkName: r.checkName, severity: r.severity, message: r.message, details: r.details ?? null, createdAt })),
    { session },
  );
}

// Oldest first, i.e. in the order the checks produced them.
export async function listValidationResults(db: Db, claimNumber: number, session?: ClientSession): Promise<StoredCheckResult[]> {
  const docs = await collections(db).validationResults.find({ claimNumber }, { session }).sort({ createdAt: 1, _id: 1 }).toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    checkName: d.checkName,
    severity: d.severity,
    message: d.message,
    ...(d.details && { details: d.details }),
    createdAt: toApiTimestamp(d.createdAt),
  }));
}

// ---- AI reviews ------------------------------------------------------------

export interface StoredAiReview extends Omit<AiReviewRecord, "retrievedSectionIds"> {
  id: string;
  claimId: number;
  createdAt: string;
}

const toAiReview = ({ _id, claimNumber, createdAt, ...rest }: AiReviewDoc & { _id: ObjectId }): StoredAiReview => ({
  ...rest,
  id: _id.toHexString(),
  claimId: claimNumber,
  createdAt: toApiTimestamp(createdAt),
});

// Always a new document: earlier AI runs are history and are never overwritten.
export async function insertAiReview(db: Db, claimNumber: number, r: AiReviewRecord, session: ClientSession): Promise<string> {
  const { retrievedSectionIds: _retrieved, ...record } = r; // kept in the audit event, not here
  const result = await collections(db).aiReviews.insertOne({ ...record, claimNumber, createdAt: new Date() }, { session });
  return result.insertedId.toHexString();
}

export async function getAiReview(db: Db, id: string): Promise<StoredAiReview | undefined> {
  const doc = await collections(db).aiReviews.findOne({ _id: new ObjectId(id) });
  return doc ? toAiReview(doc) : undefined;
}

export async function listAiReviews(db: Db, claimNumber: number): Promise<StoredAiReview[]> {
  const docs = await collections(db).aiReviews.find({ claimNumber }).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toAiReview);
}

// ---- decisions -------------------------------------------------------------

export interface Decision {
  id: string;
  claimId: number;
  reviewer: string;
  action: DecisionAction;
  reason: string | null;
  overrideCategory: string | null;
  createdAt: string;
}

export async function insertDecision(
  db: Db,
  d: Omit<DecisionDoc, "_id" | "createdAt">,
  session: ClientSession,
): Promise<string> {
  const result = await collections(db).decisions.insertOne({ ...d, createdAt: new Date() }, { session });
  return result.insertedId.toHexString();
}

export async function listDecisions(db: Db, claimNumber: number): Promise<Decision[]> {
  const docs = await collections(db).decisions.find({ claimNumber }).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    claimId: d.claimNumber,
    reviewer: d.reviewer,
    action: d.action,
    reason: d.reason,
    overrideCategory: d.overrideCategory,
    createdAt: toApiTimestamp(d.createdAt),
  }));
}

// ---- audit events (read side; writes go through audit/audit.ts) ------------

export interface StoredAuditEvent {
  id: string;
  claimId: number | null;
  actor: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export async function listAuditEvents(db: Db, claimNumber: number): Promise<StoredAuditEvent[]> {
  const docs = await findAuditEvents(db, claimNumber);
  return docs.map((d) => ({
    id: d._id!.toHexString(),
    claimId: d.claimNumber,
    actor: d.actor,
    action: d.action,
    before: d.before,
    after: d.after,
    reason: d.reason,
    createdAt: toApiTimestamp(d.createdAt),
  }));
}
