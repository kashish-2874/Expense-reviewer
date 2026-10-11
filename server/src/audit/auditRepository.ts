import type { ClientSession, Db, ObjectId } from "mongodb";

// The ONLY code that touches the audit_events collection, and it can only
// insert and read. There is deliberately no update or delete function: the
// audit log is append-only. A test (tests/foundation.test.ts) checks that this
// module exports exactly these two functions and that no other source file
// uses the collection. In production, also give the app a database role
// without update/delete privileges on audit_events (see README).

const COLLECTION = "audit_events";

export interface AuditEventDoc {
  _id?: ObjectId;
  claimNumber: number | null;
  actor: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: Date;
}

export async function insertAuditEvent(
  db: Db,
  event: Omit<AuditEventDoc, "_id" | "createdAt">,
  session: ClientSession,
): Promise<void> {
  await db.collection<AuditEventDoc>(COLLECTION).insertOne({ ...event, createdAt: new Date() }, { session });
}

// Newest first, for one claim.
export async function findAuditEvents(db: Db, claimNumber: number): Promise<AuditEventDoc[]> {
  return db
    .collection<AuditEventDoc>(COLLECTION)
    .find({ claimNumber })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
}
