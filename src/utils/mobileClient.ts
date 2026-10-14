import { timingSafeEqual } from "crypto";
import { Request } from "express";
import { env } from "../config/env";

/** The native app sends `X-Client: mobile`: it gets tokens in the JSON body instead of httpOnly cookies. */
export const isMobileClient = (req: Request) => req.headers["x-client"] === "mobile";

/**
 * Mobile builds cannot solve a Cloudflare Turnstile challenge, so they send a shared app key instead.
 * The key ships inside the app, so it is a speed bump for scripts, not proof of identity: rate limits and
 * the honeypot still apply, and real attestation (Play Integrity / App Attest) should replace it later.
 * Disabled (always false) until MOBILE_APP_KEY is set.
 */
export function hasValidMobileAppKey(req: Request): boolean {
  const expected = env.mobileAppKey;
  const given = req.headers["x-app-key"];
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isTrustedMobileClient = (req: Request) => isMobileClient(req) && hasValidMobileAppKey(req);
