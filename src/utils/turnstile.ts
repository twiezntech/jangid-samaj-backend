import { env } from "../config/env";

/** Verifies a Cloudflare Turnstile token. Skipped in development when no secret is configured. */
export async function verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
  if (!env.turnstileSecret) return !env.isProd;
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({ secret: env.turnstileSecret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
