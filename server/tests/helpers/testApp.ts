import pino from "pino";
import request from "supertest";
import type { AiClient } from "../../src/ai/client";
import { loadPolicy } from "../../src/ai/policy";
import { createApp } from "../../src/app";
import { hashPassword } from "../../src/auth/passwords";
import { config } from "../../src/config/config";
import type { Store } from "../../src/db/mongo";
import { insertUserIfAbsent } from "../../src/db/users";
import type { AppDeps } from "../../src/routes/shared";

// Shared wiring for API tests: an app with test dependencies, a test admin
// account, and a supertest agent that is logged in (it keeps the cookie).

export const TODAY = "2026-10-09";
export const TEST_JWT_SECRET = "test-only-secret-not-used-anywhere-else";
export const ADMIN = { username: "Kashish", password: "a-long-test-password" };

export function testDeps(store: Store, aiClient: AiClient): AppDeps {
  return {
    store,
    config,
    policy: loadPolicy(),
    aiClient,
    aiTimeoutMs: 500,
    today: () => TODAY,
    auth: { jwtSecret: TEST_JWT_SECRET, secureCookies: false },
  };
}

export function buildApp(store: Store, aiClient: AiClient, options?: { clientDir?: string }) {
  return createApp(testDeps(store, aiClient), pino({ level: "silent" }), options);
}

// bcrypt at cost 12 is deliberately slow, so hash the test password once per run.
let adminHash: Promise<string> | undefined;
export async function createAdmin(store: Store): Promise<void> {
  adminHash ??= hashPassword(ADMIN.password);
  await insertUserIfAbsent(store.db, { username: ADMIN.username, passwordHash: await adminHash, role: "admin" });
}

export async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send(ADMIN);
  if (res.status !== 200) throw new Error(`Test login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
