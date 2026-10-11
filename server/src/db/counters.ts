import type { ClientSession, Db } from "mongodb";
import { collections } from "./collections";

// Hands out the next claim number (1, 2, 3, ...) so the UI can keep showing
// "#9" instead of a 24-character ObjectId. $inc on a single document is
// atomic, so concurrent callers never receive the same number.
//
// It runs inside the claim-creation transaction, which has two useful effects:
// if the transaction aborts the increment is rolled back (no gaps), and two
// transactions that both increment the counter conflict, so MongoDB retries
// one of them. That makes claim creation effectively serial, which is what
// lets duplicate detection see a claim submitted a moment earlier.
export async function nextClaimNumber(db: Db, session: ClientSession): Promise<number> {
  const counter = await collections(db).counters.findOneAndUpdate(
    { _id: "claimNumber" },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after", session },
  );
  if (!counter) throw new Error("Claim number counter could not be incremented");
  return counter.value;
}
