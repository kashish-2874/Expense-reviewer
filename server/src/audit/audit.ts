import type { ClientSession } from "mongodb";
import type { Store } from "../db/mongo";
import { insertAuditEvent } from "./auditRepository";

// The single entry point for changing state. It runs the change and writes the
// audit event(s) in ONE MongoDB transaction, so there is never a change without
// its audit record, or an audit record for a change that was rolled back.

export interface AuditEvent {
  claimNumber: number | null;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export async function auditedChange<T>(
  store: Store,
  change: (session: ClientSession) => Promise<T>,
  describe: (result: T, session: ClientSession) => Promise<AuditEvent | AuditEvent[]> | AuditEvent | AuditEvent[],
): Promise<T> {
  const session = store.client.startSession();
  try {
    // withTransaction commits at the end, aborts on any thrown error (which is
    // re-thrown to the caller), and retries the whole callback on transient
    // conflicts. So the callback must only do database work, nothing else.
    return await session.withTransaction(async () => {
      const result = await change(session);
      for (const e of [await describe(result, session)].flat()) {
        await insertAuditEvent(
          store.db,
          {
            claimNumber: e.claimNumber,
            actor: e.actor,
            action: e.action,
            before: e.before ?? null,
            after: e.after ?? null,
            reason: e.reason ?? null,
          },
          session,
        );
      }
      return result;
    });
  } finally {
    await session.endSession();
  }
}
