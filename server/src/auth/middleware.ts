import type { RequestHandler } from "express";
import { HttpError } from "../errors";
import { SESSION_COOKIE, verifySessionToken, type AuthUser } from "./tokens";

// Lets handlers read the logged-in user as req.user (set by requireAuth).
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Rejects the request with 401 unless it carries a valid session cookie.
export function requireAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || token === "") return next(new HttpError(401, "Not logged in"));
    const user = verifySessionToken(token, jwtSecret);
    if (!user) return next(new HttpError(401, "Session expired or invalid. Please log in again."));
    req.user = user;
    next();
  };
}

// Rejects with 403 unless the logged-in user has one of the given roles.
// Must run after requireAuth. Only "admin" exists today, but routes declare
// the roles they allow so new roles can be added without rewriting them.
export function requireRole(...roles: AuthUser["role"][]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, "You do not have access to this action"));
    next();
  };
}

// The guard for every reviewer-area route.
export function reviewerOnly(jwtSecret: string): RequestHandler[] {
  return [requireAuth(jwtSecret), requireRole("admin")];
}
