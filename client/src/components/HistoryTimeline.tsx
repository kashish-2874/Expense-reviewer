import { formatAuditEvent } from "../lib/formatAuditEvent";
import type { AiReview, AppConfig, AuditEvent } from "../types";
import { Empty } from "./ui";

// The audit log for one claim, newest first, in plain language. The raw
// before/after data stays available, collapsed, for anyone who needs it.

interface Props {
  events: AuditEvent[]; // already newest first (the API sorts them)
  config: AppConfig;
  aiReviews: AiReview[];
}

export function HistoryTimeline({ events, config, aiReviews }: Props) {
  if (events.length === 0) return <Empty>No history yet.</Empty>;
  return (
    <ol className="timeline">
      {events.map((e) => {
        const item = formatAuditEvent(e, { config, aiReviews });
        return (
          <li key={e.id} className={`timeline-item action-${e.action}`}>
            <div className="timeline-head">
              <strong>{item.title}</strong>
              <span className="muted small">
                {item.timestamp} · {item.actor}
              </span>
            </div>
            <div>{item.summary}</div>
            {item.reason && <div className="timeline-reason">Reason: {item.reason}</div>}
            <details>
              <summary className="small">Show raw data</summary>
              <pre>{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
