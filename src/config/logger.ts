import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.isProd ? "info" : env.nodeEnv === "test" ? "silent" : "debug"),
  // Never let credentials or tokens reach log storage.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "req.body.password", "req.body.token", "req.body.turnstileToken"],
    censor: "[redacted]",
  },
  ...(env.isProd ? {} : { transport: undefined }),
});
