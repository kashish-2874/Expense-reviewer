import { STATUS_LABELS, VERDICT_LABELS } from "../format";
import type { AiReview, AppConfig, AuditEvent } from "../types";

// Turns one audit event into plain language for the history timeline.
// Pure function (no React, no clock), so it is easy to unit test. It never
// throws: audit data is stored as JSON, so every field is treated as possibly
// missing or of the wrong type.

export interface FormattedAuditEvent {
  title: string; // short heading, e.g. "Approved"
  summary: string; // one sentence describing only what changed
  actor: string;
  reason?: string;
  timestamp: string; // e.g. "10 Oct 2026, 7:55 PM"
}

export interface FormatContext {
  config?: AppConfig; // category labels
  aiReviews?: AiReview[]; // looked up by id, because AI audit events do not store the confidence
  timeZone?: string; // defaults to the browser's; tests pin it
}

type Data = Record<string, unknown>;

export function formatAuditEvent(event: AuditEvent, ctx: FormatContext = {}): FormattedAuditEvent {
  const before: Data = event.before ?? {};
  const after: Data = event.after ?? {};
  const actor = text(event.actor) ?? "Unknown";
  const reason = text(event.reason);

  return {
    ...describe(event.action, before, after, actor, ctx),
    actor,
    ...(reason && { reason }),
    timestamp: formatTimestamp(event.createdAt, ctx.timeZone),
  };
}

function describe(action: string, before: Data, after: Data, actor: string, ctx: FormatContext) {
  switch (action) {
    case "claim_created":
      return { title: "Claim submitted", summary: describeSubmission(after, actor, ctx) };

    case "ai_review_run":
      return describeAiRun(after, ctx);

    case "decision_approve":
      return { title: "Approved", summary: describeStatusChange(before, after, actor) };
    case "decision_reject":
      return { title: "Rejected", summary: describeStatusChange(before, after, actor) };
    case "decision_request_clarification":
      return { title: "Clarification requested", summary: describeStatusChange(before, after, actor) };

    case "category_overridden": {
      // The effective category before the change is the earlier override, if any.
      const from = text(before.finalCategory) ?? text(before.category);
      const to = categoryLabel(text(after.finalCategory), ctx.config);
      return {
        title: "Category overridden",
        summary: from ? `Category changed from ${categoryLabel(from, ctx.config)} to ${to}.` : `Category changed to ${to}.`,
      };
    }

    default: {
      // An action this version does not know about: say something safe and generic.
      const title = text(action) ? humanize(action) : "Activity";
      return { title, summary: `${title} recorded by ${actor}.` };
    }
  }
}

// "Claim submitted by Asha Rao. Travel and Transport, ₹800, no receipt, dated 7 Oct 2026."
function describeSubmission(after: Data, actor: string, ctx: FormatContext): string {
  const receipt = after.receiptAvailable === true ? "receipt attached" : after.receiptAvailable === false ? "no receipt" : undefined;
  const date = text(after.date);
  const details = [
    text(after.category) && categoryLabel(text(after.category), ctx.config),
    formatMoney(after.amount, text(after.currency)),
    receipt,
    date && `dated ${formatDate(date)}`,
  ].filter(Boolean);

  const first = `Claim submitted by ${text(after.claimant) ?? actor}.`;
  return details.length > 0 ? `${first} ${details.join(", ")}.` : first;
}

// "AI review ran: Meals, confidence 62%, uncertain, needs review."
function describeAiRun(after: Data, ctx: FormatContext) {
  if (after.aiStatus === "unavailable") {
    return { title: "AI review failed", summary: "AI review unavailable. Manual review needed." };
  }
  if (after.aiStatus === "invalid_output") {
    return { title: "AI review failed", summary: "AI review returned unusable output. Manual review needed." };
  }

  const review = ctx.aiReviews?.find((r) => r.id === after.aiReviewId);
  const verdict = text(after.verdict);
  const parts = [
    text(after.category) && categoryLabel(text(after.category), ctx.config),
    typeof review?.confidence === "number" && `confidence ${Math.round(review.confidence * 100)}%`,
    after.uncertain === true && "uncertain",
    verdict && (VERDICT_LABELS[verdict as keyof typeof VERDICT_LABELS] ?? humanize(verdict)).toLowerCase(),
  ].filter(Boolean);

  return { title: "AI review", summary: parts.length > 0 ? `AI review ran: ${parts.join(", ")}.` : "AI review ran." };
}

// "Status changed from Submitted to Approved by Kashish."
function describeStatusChange(before: Data, after: Data, actor: string): string {
  const from = text(before.status);
  const to = text(after.status);
  if (from && to) return `Status changed from ${statusLabel(from)} to ${statusLabel(to)} by ${actor}.`;
  if (to) return `Status changed to ${statusLabel(to)} by ${actor}.`;
  return `Decision recorded by ${actor}.`;
}

// ---- small formatting helpers -------------------------------------------------

// A trimmed non-empty string, or undefined for anything else (null, numbers, "").
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

// "travel_transport" -> "Travel transport". Used only when no proper label exists,
// so a raw key never reaches the screen.
function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function categoryLabel(key: string | undefined, config?: AppConfig): string {
  if (!key) return "an unknown category";
  if (key === "unclear") return "Unclear";
  return config?.categories.find((c) => c.key === key)?.label ?? humanize(key);
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? humanize(status);
}

// INR as "₹1,200", other currencies by code: "USD 45".
function formatMoney(amount: unknown, currency: string | undefined): string | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount);
  if (!currency || currency === "INR") return `₹${number}`;
  return `${currency} ${number}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-07" -> "7 Oct 2026". Parsed by hand so no time zone can shift the day.
function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = match && MONTHS[Number(match[2]) - 1];
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : isoDate;
}

// The API sends UTC as "YYYY-MM-DD HH:MM:SS" -> "10 Oct 2026, 7:55 PM" in local time.
function formatTimestamp(apiUtc: string, timeZone?: string): string {
  const date = new Date(`${String(apiUtc).replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return text(apiUtc) ?? "Unknown time";

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}
