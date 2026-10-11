import { Router, type CookieOptions } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { verifyPassword } from "../auth/passwords";
import { SESSION_COOKIE, SESSION_HOURS, signSessionToken } from "../auth/tokens";
import { findUserByUsername } from "../db/users";
import { HttpError, parseInput } from "../errors";
import type { AppDeps } from "./shared";

// Login, logout and "who am I" for the reviewer area. There is deliberately no
// signup endpoint: the single admin account is created from env at startup.

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(100),
  password: z.string().min(1, "Password is required").max(200),
});

// One message for both "no such user" and "wrong password", so the response
// never tells an attacker which usernames exist.
const INVALID_LOGIN = "Invalid username or password";

export function authRouter({ store, auth }: AppDeps): Router {
  const router = Router();

  // httpOnly: page scripts cannot read the token (limits XSS damage).
  // sameSite=lax: the browser does not send it on cross-site form posts (CSRF).
  // secure: HTTPS only, in production.
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: auth.secureCookies,
    path: "/",
  };

  router.post("/login", async (req, res) => {
    const { username, password } = parseInput(loginSchema, req.body);
    const user = await findUserByUsername(store.db, username);
    // Always runs bcrypt, even for unknown users, so timing is the same.
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) {
      req.log.info({ username }, "Login failed");
      throw new HttpError(401, INVALID_LOGIN);
    }

    const sessionUser = { username: user.username, role: user.role };
    res.cookie(SESSION_COOKIE, signSessionToken(sessionUser, auth.jwtSecret), {
      ...cookieOptions,
      maxAge: SESSION_HOURS * 60 * 60 * 1000,
    });
    req.log.info({ username }, "Login succeeded");
    res.json({ user: sessionUser });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    req.log.info("Logged out");
    res.status(204).end();
  });

  router.get("/me", requireAuth(auth.jwtSecret), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
