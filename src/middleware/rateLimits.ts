import rateLimit from "express-rate-limit";

const message = { error: { message: "Too many requests. Please try again later.", code: "RATE_LIMITED" } };

/** Generous ceiling for anonymous read traffic; real load is meant to be absorbed by CDN/cache. */
export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  skip: () => process.env.NODE_ENV === "test",
});

/** Per-account ceiling for content writes / editorial actions. */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  keyGenerator: (req) => req.userId ?? req.ip ?? "anon",
  skip: () => process.env.NODE_ENV === "test",
});
