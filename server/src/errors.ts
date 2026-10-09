import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";

// Every error response has the same shape: { error: string, details?: unknown }.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// Parses input with a zod schema; a failure becomes a 400 listing each problem.
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function validationError(error: ZodError): HttpError {
  return new HttpError(
    400,
    "Validation failed",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl.split("?")[0]}`));
};

// Last middleware. Known errors map to their status; anything else is logged
// with the request ID and returned as a generic 500 so internals do not leak.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    req.log.info({ status: err.status, error: err.message, details: err.details }, "Request rejected");
    res.status(err.status).json({ error: err.message, ...(err.details !== undefined && { details: err.details }) });
    return;
  }
  // express.json() raises this for a malformed request body.
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  req.log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error", details: { requestId: req.id } });
};
