import jwt from "jsonwebtoken";

// Session tokens: a signed JWT stored in an httpOnly cookie. The server keeps
// no session table; the signature proves the token was issued here, and the
// expiry limits how long a stolen cookie is useful.

export interface AuthUser {
  username: string;
  role: "admin";
}

export const SESSION_COOKIE = "er_session";
export const SESSION_HOURS = 8;
const ALGORITHM = "HS256";

export function signSessionToken(user: AuthUser, secret: string): string {
  return jwt.sign({ role: user.role }, secret, {
    algorithm: ALGORITHM,
    subject: user.username,
    expiresIn: `${SESSION_HOURS}h`,
  });
}

// Returns the user, or null for anything invalid: bad signature, expired,
// wrong algorithm (pinning the algorithm blocks "alg: none" tricks) or a
// payload that does not have the expected shape.
export function verifySessionToken(token: string, secret: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    if (typeof payload === "string" || typeof payload.sub !== "string" || payload.role !== "admin") return null;
    return { username: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}
