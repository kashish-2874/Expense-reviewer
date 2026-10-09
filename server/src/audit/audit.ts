import type { DB } from "../db/db";

// The single entry point for changing state. It runs the change and writes the
// audit event(s) in ONE transaction, so there is never a change without its
// audit record (or an audit record for a change that rolled back). The table
// itself is append-only, enforced by triggers in schema.sql.

export interface AuditEvent {
  claimId: number | null;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export function auditedChange<T>(db: DB, change: () => T, describe: (result: T) => AuditEvent | AuditEvent[]): T {
  const insert = db.prepare(
    "INSERT INTO audit_events (claim_id, actor, action, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const run = db.transaction(() => {
    const result = change();
    for (const e of [describe(result)].flat()) {
      insert.run(
        e.claimId,
        e.actor,
        e.action,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.reason ?? null,
      );
    }
    return result;
  });
  return run();
}
