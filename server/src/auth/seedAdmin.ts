import type { Db } from "mongodb";
import { findUserByUsername, insertUserIfAbsent } from "../db/users";
import { hashPassword } from "./passwords";

// Creates the admin account from ADMIN_USERNAME / ADMIN_PASSWORD if no user
// with that username exists. It never overwrites an existing account, so
// changing ADMIN_PASSWORD later does NOT change the stored password, and
// restarting the server is always safe. The password is never logged.
export async function ensureAdminUser(db: Db, username: string, password: string): Promise<"created" | "skipped"> {
  // Cheap check first, so a normal restart does not spend time hashing.
  if (await findUserByUsername(db, username)) return "skipped";
  const created = await insertUserIfAbsent(db, { username, passwordHash: await hashPassword(password), role: "admin" });
  return created ? "created" : "skipped";
}
