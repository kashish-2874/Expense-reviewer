import { existsSync } from "node:fs";
import path from "node:path";
import { createAiClient } from "./ai/client";
import { loadPolicy } from "./ai/policy";
import { createApp } from "./app";
import { EXAMPLE_ADMIN_PASSWORD, resolveJwtSecret } from "./auth/config";
import { ensureAdminUser } from "./auth/seedAdmin";
import { localToday } from "./clock";
import { config } from "./config/config";
import { env } from "./config/env";
import { connectStore, type Store } from "./db/mongo";
import { setupDatabase } from "./db/setup";
import { logger } from "./logger";
import { seedIfEmpty } from "./seed/demoClaims";

// Process entry point: connects to MongoDB, prepares it, wires the real
// dependencies and starts listening.

async function main() {
  // Fails fast with a clear message if MongoDB is unreachable or cannot do transactions.
  const store = await connectStore(env.MONGODB_URI, env.MONGODB_DB);
  await setupDatabase(store.db);

  const seeded = await seedIfEmpty(store, config, localToday());
  logger.info({ seeded }, seeded > 0 ? "Database was empty: seeded demo claims" : "Database has claims: demo seed skipped");

  const jwtSecret = resolveJwtSecret(env.NODE_ENV, env.JWT_SECRET, logger);
  await setupAdminAccount(store);

  const aiClient = createAiClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL, logger);

  // Serve the built UI when it exists (production / Docker). In development the
  // Vite dev server serves the UI instead and proxies /api here.
  const clientDir = path.resolve(__dirname, "../../client/dist");
  const serveClient = existsSync(path.join(clientDir, "index.html"));

  const app = createApp(
    {
      store,
      config,
      policy: loadPolicy(),
      aiClient,
      aiTimeoutMs: env.AI_TIMEOUT_MS,
      today: () => localToday(),
      auth: { jwtSecret, secureCookies: env.NODE_ENV === "production" },
    },
    logger,
    { clientDir: serveClient ? clientDir : undefined },
  );

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, mongoDb: env.MONGODB_DB, aiModel: aiClient.model, aiMock: aiClient.isMock, servingClient: serveClient },
      "Server started",
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void store.client.close().then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Creates the admin from ADMIN_USERNAME / ADMIN_PASSWORD if it does not exist.
// Logs only the outcome and the username, never the password.
async function setupAdminAccount(store: Store) {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    logger.warn("ADMIN_USERNAME / ADMIN_PASSWORD not set: no admin account was created. Set them to be able to log in.");
    return;
  }
  if (env.NODE_ENV === "production" && password === EXAMPLE_ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is still the .env.example placeholder. Set a real password before starting in production.");
  }
  const outcome = await ensureAdminUser(store.db, username, password);
  logger.info(
    { username, outcome },
    outcome === "created" ? "Admin account created" : "Admin account already exists: left unchanged",
  );
}

main().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
