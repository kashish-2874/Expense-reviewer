import pino from "pino";
import { env } from "./config/env";

// One structured JSON logger for the whole server. Modules create child loggers
// (e.g. logger.child({ claimId })) so every line carries its context.
export const logger = pino({ level: env.LOG_LEVEL });

export type Logger = pino.Logger;
