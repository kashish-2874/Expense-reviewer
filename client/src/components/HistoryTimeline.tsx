import { categoryLabel, formatTimestamp, STATUS_LABELS, VERDICT_LABELS } from "../format";
import type { AppConfig, AuditEvent, ClaimStatus, Verdict } from "../types";
import { Empty } from "./ui";

// The audit log for one claim, newest first. Each event gets a plain-language
// summary; the raw before/after data is one click away for full detail.

function describe(e: AuditEvent, config: AppConfig): string {
  const after = e.after ?? {};
  const before = e.before ?? {};
  switch (e.action) {
    case "claim_created":
      return "Claim submitted";
    case "ai_review_run": {
      if (after.aiStatus !== "ok") return `AI review failed (${after.aiStatus}); manual review needed`;
      const verdict = after.verdict ? VERDICT_LABELS[after.verdict as Verdict] : "no verdict";
      const uncertain = after.uncertain ? ", uncertain" : "";
      return `AI review: ${categoryLabel(config, after.category as string)} (${verdict}${uncertain})`;
    }
    case "category_overridden":
      return `Category overridden: ${categoryLabel(config, (before.finalCategory ?? before.category) as string)} → ${categoryLabel(config, after.finalCategory as string)}`;
    case "decision_approve":
      return "Approved";
    case "decision_reject":
      return "Rejected";
    case "decision_request_clarification":
      return "Clarification requested";
    default:
      return e.action;
  }
}

export function HistoryTimeline({ events, config }: { events: AuditEvent[]; config: AppConfig }) {
  if (events.length === 0) return <Empty>No history yet.</Empty>;
  return (
    <ol className="timeline">
      {events.map((e) => {
        const status = e.after?.status as ClaimStatus | undefined;
        return (
          <li key={e.id} className={`timeline-item action-${e.action}`}>
            <div className="timeline-head">
              <strong>{describe(e, config)}</strong>
              <span className="muted small">
                {formatTimestamp(e.createdAt)} · {e.actor}
              </span>
            </div>
            {e.reason && <div className="timeline-reason">Reason: {e.reason}</div>}
            {status && e.before?.status !== status && (
              <div className="small muted">Status → {STATUS_LABELS[status] ?? status}</div>
            )}
            <details>
              <summary className="small">Details</summary>
              <pre>{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
