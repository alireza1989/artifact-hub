import pino from "pino";

// Structured logs (PLAN §6 Runtime). Level via LOG_LEVEL; defaults to info in
// production, debug elsewhere. Import and bind context with `logger.child({...})`.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
});
