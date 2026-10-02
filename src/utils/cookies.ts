import { CookieOptions, Response } from "express";
import { env } from "../config/env";

export const ACCESS_COOKIE = "js_at";
export const REFRESH_COOKIE = "js_rt";

const base: CookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: "lax",
  domain: env.cookieDomain,
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: "/", maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: "/api/v1/auth",
    maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: "/api/v1/auth" });
}
