import bcrypt from "bcryptjs";

// Password hashing with bcrypt. Cost 12 takes roughly a quarter of a second
// per hash or check: unnoticeable for one login, but it makes guessing
// passwords from a stolen hash very slow.
const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

// Hash of a random value nobody knows, computed once at startup. Checking an
// unknown username against it costs the same time as checking a real one, so
// response times do not reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}`, COST);

// `hash` is undefined when the username does not exist.
export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== undefined && matches;
}
