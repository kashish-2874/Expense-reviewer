import { Writable } from "node:stream";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import pino from "pino";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAiClient } from "../src/ai/client";
import { createApp } from "../src/app";
import { EXAMPLE_JWT_SECRET, resolveJwtSecret } from "../src/auth/config";
import { requireRole } from "../src/auth/middleware";
import { ensureAdminUser } from "../src/auth/seedAdmin";
import { SESSION_COOKIE } from "../src/auth/tokens";
import { HttpError } from "../src/errors";
import { ADMIN, TEST_JWT_SECRET, buildApp, createAdmin, loggedInAgent, testDeps } from "./helpers/testApp";
import { useTestDatabase } from "./helpers/testDatabase";

const t = useTestDatabase();
const silent = pino({ level: "silent" });

const claim = {
  claimant: "Asha Rao",
  date: "2026-10-01",
  category: "meals",
  amount: 1200,
  currency: "INR",
  description: "Dinner during Pune site visit",
  receiptAvailable: true,
};

let app: ReturnType<typeof buildApp>;
beforeEach(async () => {
  app = buildApp(t.store, new MockAiClient());
  await createAdmin(t.store);
});

const sessionCookie = (res: request.Response): string | undefined =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`));

describe("login", () => {
  it("sets an httpOnly, sameSite=lax, 8-hour session cookie and returns the user", async () => {
    const res = await request(app).post("/api/auth/login").send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { username: "Kashish", role: "admin" } });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=28800/);
    expect(cookie).not.toMatch(/Secure/); // only in production
  });

  it("gives the same generic 401 for a wrong password and an unknown user", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ ...ADMIN, password: "nope" });
    const unknown = await request(app).post("/api/auth/login").send({ username: "nobody", password: "nope" });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid username or password" });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "Kashish" });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([expect.objectContaining({ path: "password" })]);
  });

  it("reports the current user via /me", async () => {
    const agent = await loggedInAgent(app);
    expect((await agent.get("/api/auth/me")).body).toEqual({ user: { username: "Kashish", role: "admin" } });
  });
});

describe("route protection", () => {
  it.each([
    ["get", "/api/claims"],
    ["get", "/api/claims/1"],
    ["post", "/api/claims/1/review"],
    ["post", "/api/claims/1/decision"],
    ["get", "/api/totals"],
    ["get", "/api/auth/me"],
  ] as const)("%s %s needs a login (401)", async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not logged in" });
  });

  it("lets the public submit a claim and returns only a receipt", async () => {
    const res = await request(app).post("/api/claims").send(claim);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ claimNumber: 1, status: "submitted" }); // no flags, no AI output, no claim data
  });

  it("keeps health and form config public", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/config")).status).toBe(200);
  });

  it("refuses roles that are not allowed (403)", () => {
    const next = vi.fn();
    const req = { user: { username: "x", role: "claimant" } } as unknown as Request;
    requireRole("admin")(req, {} as Response, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(HttpError);
    expect((next.mock.calls[0]?.[0] as HttpError).status).toBe(403);
  });
});

describe("reviewer identity comes from the session", () => {
  it("records the logged-in user as the decision maker, ignoring a reviewer in the body", async () => {
    const agent = await loggedInAgent(app);
    const { claimNumber } = (await request(app).post("/api/claims").send(claim)).body;
    await agent.post(`/api/claims/${claimNumber}/review`).send({ reviewer: "Mallory" });
    const res = await agent.post(`/api/claims/${claimNumber}/decision`).send({ action: "approve", reviewer: "Mallory" });
    expect(res.status).toBe(201);

    const detail = (await agent.get(`/api/claims/${claimNumber}`)).body;
    expect(detail.decisions[0].reviewer).toBe("Kashish");
    expect(detail.auditEvents.map((e: { action: string; actor: string }) => `${e.action}/${e.actor}`)).toEqual([
      "decision_approve/Kashish",
      "ai_review_run/Kashish",
      "claim_created/Asha Rao",
    ]);
  });
});

describe("sessions", () => {
  it("logout clears the cookie, so the agent loses access", async () => {
    const agent = await loggedInAgent(app);
    expect((await agent.get("/api/claims")).status).toBe(200);
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get("/api/claims")).status).toBe(401);
  });

  const withToken = (token: string) => request(app).get("/api/claims").set("Cookie", `${SESSION_COOKIE}=${token}`);

  it("rejects a tampered token", async () => {
    const login = await request(app).post("/api/auth/login").send(ADMIN);
    const token = sessionCookie(login)!.split(";")[0]!.split("=")[1]!;
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), sub: "someone-else" })).toString(
      "base64url",
    );
    expect((await withToken(`${header}.${forged}.${signature}`)).status).toBe(401);
  });

  it("rejects an expired token, one signed with another secret, and alg=none", async () => {
    const expired = jwt.sign({ role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, TEST_JWT_SECRET, { subject: "Kashish" });
    const otherSecret = jwt.sign({ role: "admin" }, "some-other-secret", { subject: "Kashish", expiresIn: "1h" });
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: "Kashish", role: "admin" }),
    ).toString("base64url")}.`;
    for (const token of [expired, otherSecret, unsigned]) {
      const res = await withToken(token);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Session expired or invalid/);
    }
  });
});

describe("admin seeding", () => {
  it("is idempotent and never overwrites an existing password", async () => {
    // createAdmin (beforeEach) already made "Kashish"; seeding again with a different password is skipped.
    expect(await ensureAdminUser(t.store.db, ADMIN.username, "a-different-password")).toBe("skipped");
    expect((await request(app).post("/api/auth/login").send(ADMIN)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ ...ADMIN, password: "a-different-password" })).status).toBe(401);

    expect(await ensureAdminUser(t.store.db, "second-admin", "pw-for-second")).toBe("created");
    expect(await ensureAdminUser(t.store.db, "second-admin", "pw-for-second")).toBe("skipped");
  });
});

describe("JWT secret at startup", () => {
  it("refuses a missing or placeholder secret in production", () => {
    expect(() => resolveJwtSecret("production", undefined, silent)).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret("production", EXAMPLE_JWT_SECRET, silent)).toThrow(/JWT_SECRET/);
    expect(resolveJwtSecret("production", "a-real-long-secret", silent)).toBe("a-real-long-secret");
  });

  it("uses a random secret in development when none is set", () => {
    expect(resolveJwtSecret("development", undefined, silent)).toMatch(/^[0-9a-f]{96}$/);
  });
});

describe("logging", () => {
  it("never writes passwords, tokens or cookies to the logs", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logged = createApp(testDeps(t.store, new MockAiClient()), pino({ level: "info" }, sink));

    const ok = await request(logged).post("/api/auth/login").send(ADMIN);
    const token = sessionCookie(ok)!.split(";")[0]!.split("=")[1]!;
    await request(logged).post("/api/auth/login").send({ ...ADMIN, password: "wrong-password-123" });
    await request(logged).get("/api/claims").set("Cookie", `${SESSION_COOKIE}=${token}`);

    const all = lines.join("\n");
    expect(all).toContain("Login succeeded");
    expect(all).toContain("Login failed");
    expect(all).toContain('"username":"Kashish"');
    for (const secret of [ADMIN.password, "wrong-password-123", token, SESSION_COOKIE]) {
      expect(all).not.toContain(secret);
    }
  });
});
