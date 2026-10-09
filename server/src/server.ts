import { existsSync } from "node:fs";
import path from "node:path";
import { createAiClient } from "./ai/client";
import { loadPolicy } from "./ai/policy";
import { createApp } from "./app";
import { localToday } from "./clock";
import { config } from "./config/config";
import { env } from "./config/env";
import { openDb } from "./db/db";
import { logger } from "./logger";

// Process entry point: wires real dependencies and starts listening.

const db = openDb(env.DB_PATH);
const aiClient = createAiClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL, logger);

// Serve the built UI when it exists (production / Docker). In development the
// Vite dev server serves the UI instead and proxies /api here.
const clientDir = path.resolve(__dirname, "../../client/dist");
const serveClient = existsSync(path.join(clientDir, "index.html"));

const app = createApp(
  { db, config, policy: loadPolicy(), aiClient, aiTimeoutMs: env.AI_TIMEOUT_MS, today: () => localToday() },
  logger,
  { clientDir: serveClient ? clientDir : undefined },
);

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, dbPath: env.DB_PATH, aiModel: aiClient.model, aiMock: aiClient.isMock, servingClient: serveClient },
    "Server started",
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
