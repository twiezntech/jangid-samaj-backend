import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError";
import { verifyTurnstile } from "../utils/turnstile";

/**
 * Bot defence for public auth endpoints:
 *  1. honeypot field "website" — invisible to people, bots fill it; we answer with a fake success.
 *  2. Cloudflare Turnstile challenge token.
 */
export async function requireHuman(req: Request, res: Response, next: NextFunction) {
  if (typeof req.body?.website === "string" && req.body.website.length > 0) {
    return res.status(200).json({ needsVerification: true });
  }
  const ok = await verifyTurnstile(req.body?.turnstileToken, req.ip);
  if (!ok) return next(ApiError.badRequest("Human verification failed. Please try again.", undefined, "BOT_CHECK_FAILED"));
  next();
}
