import type { Db } from "mongodb";
import { collections, type UserDoc } from "./collections";

// Data access for reviewer accounts. There is no signup and no user
// management: the only writer is the admin seed at startup.

export function findUserByUsername(db: Db, username: string): Promise<UserDoc | null> {
  return collections(db).users.findOne({ username });
}

// Inserts only if the username is free. Returns false when it already exists
// (including when a concurrent start created it first: the unique index on
// username turns that race into a duplicate-key error, code 11000).
export async function insertUserIfAbsent(db: Db, user: Omit<UserDoc, "_id" | "createdAt">): Promise<boolean> {
  try {
    const result = await collections(db).users.updateOne(
      { username: user.username },
      { $setOnInsert: { ...user, createdAt: new Date() } },
      { upsert: true },
    );
    return result.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}
