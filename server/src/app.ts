import { randomUUID } from "node:crypto";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { pinoHttp } from "pino-http";
import { errorHandler, notFound } from "./errors";
import type { Logger } from "./logger";
import { authRouter } from "./routes/auth";
import { claimsRouter } from "./routes/claims";
import { decisionsRouter } from "./routes/decisions";
import { metaRouter } from "./routes/meta";
import { reviewRouter } from "./routes/review";
import type { AppDeps } from "./routes/shared";

// Builds the Express app without starting a server, so tests can drive it
// with supertest against an in-memory database.

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

// `clientDir`: the built React app (client/dist). When set, the server also
// serves the UI, so production is a single process on a single port.
export function createApp(deps: AppDeps, logger: Logger, options: { clientDir?: string } = {}): express.Express {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      // Reuse a caller's X-Request-Id (e.g. from a proxy) when it looks sane.
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      // Lines logged inside a request carry only its id; the completion line
      // carries method/url/status. Headers are left out (they can hold secrets).
      quietReqLogger: true,
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser()); // fills req.cookies, where requireAuth finds the session token

  // Which routes are public and which need a login is decided in each router,
  // next to the route itself (see reviewerOnly).
  app.use("/api/auth", authRouter(deps));
  app.use("/api", metaRouter(deps));
  app.use("/api/claims", claimsRouter(deps));
  app.use("/api/claims", reviewRouter(deps));
  app.use("/api/claims", decisionsRouter(deps));
  app.use("/api", notFound); // unknown API paths get JSON, never the HTML app

  if (options.clientDir) {
    const clientDir = options.clientDir;
    app.use(express.static(clientDir));
    // The client routes in the browser (/login, /claims/9, ...), so every
    // non-API path gets index.html and the React app picks the page.
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
