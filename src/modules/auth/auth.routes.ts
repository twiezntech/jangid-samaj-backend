import { Request, Response, Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from "../../utils/cookies";
import { requireHuman } from "../../middleware/human";
import { verifyAccessToken } from "../../utils/jwt";
import { isMobileClient } from "../../utils/mobileClient";
import { forgotSchema, googleSchema, loginSchema, refreshTokenSchema, registerSchema, resendSchema, resetSchema, verifyEmailSchema } from "./auth.schemas";
import * as auth from "./auth.service";

const tooMany = { error: { message: "Too many requests. Please try again later." } };
const limiter = (max: number, windowMin = 15) =>
  rateLimit({ windowMs: windowMin * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: tooMany, skip: () => process.env.NODE_ENV === "test" });

const perIpLimit = limiter(30);
const perEmailLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany,
  skip: () => process.env.NODE_ENV === "test",
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
});

const meta = (req: Request) => ({ userAgent: req.headers["user-agent"], ip: req.ip });

type Session = { user: unknown; accessToken: string; refreshToken: string };

/** Website: tokens go into httpOnly cookies. Mobile app (X-Client: mobile): tokens go in the body, no cookies. */
function sendSession(req: Request, res: Response, { user, accessToken, refreshToken }: Session) {
  if (isMobileClient(req)) {
    res.set("Cache-Control", "no-store");
    return res.json({ user, accessToken, refreshToken });
  }
  setAuthCookies(res, accessToken, refreshToken);
  res.json({ user });
}

/** The refresh token comes from the cookie (website) or the JSON body (mobile app). */
const refreshTokenFrom = (req: Request): string | undefined => {
  if (!isMobileClient(req)) return req.cookies?.[REFRESH_COOKIE];
  const parsed = refreshTokenSchema.safeParse(req.body);
  return parsed.success ? parsed.data.refreshToken : undefined;
};

export const authRouter = Router();

authRouter.post(
  "/register",
  perIpLimit,
  requireHuman,
  asyncHandler(async (req, res) => {
    res.status(202).json(await auth.register(registerSchema.parse(req.body)));
  })
);

authRouter.post(
  "/verify-email",
  limiter(20),
  asyncHandler(async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    sendSession(req, res, await auth.verifyEmail(token, meta(req)));
  })
);

authRouter.post(
  "/resend-verification",
  limiter(10, 60),
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany,
    skip: () => process.env.NODE_ENV === "test",
    keyGenerator: (req) => `resend:${String(req.body?.email ?? "").toLowerCase()}`,
  }),
  requireHuman,
  asyncHandler(async (req, res) => {
    await auth.resendVerification(resendSchema.parse(req.body).email);
    res.json({ ok: true });
  })
);

authRouter.post(
  "/forgot-password",
  limiter(10, 60),
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany,
    skip: () => process.env.NODE_ENV === "test",
    keyGenerator: (req) => `forgot:${String(req.body?.email ?? "").toLowerCase()}`,
  }),
  requireHuman,
  asyncHandler(async (req, res) => {
    await auth.requestPasswordReset(forgotSchema.parse(req.body).email);
    res.json({ ok: true });
  })
);

authRouter.post(
  "/reset-password",
  limiter(20),
  asyncHandler(async (req, res) => {
    const { token, password } = resetSchema.parse(req.body);
    res.json(await auth.resetPassword(token, password));
  })
);

authRouter.post(
  "/login",
  perIpLimit,
  perEmailLimit,
  requireHuman,
  asyncHandler(async (req, res) => {
    sendSession(req, res, await auth.login(loginSchema.parse(req.body), meta(req)));
  })
);

authRouter.post(
  "/google",
  perIpLimit,
  asyncHandler(async (req, res) => {
    const { credential } = googleSchema.parse(req.body);
    sendSession(req, res, await auth.loginWithGoogle(credential, meta(req)));
  })
);

authRouter.post(
  "/refresh",
  limiter(120),
  asyncHandler(async (req, res) => {
    const token = refreshTokenFrom(req);
    if (!token) {
      clearAuthCookies(res);
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    try {
      sendSession(req, res, await auth.refreshSession(token, meta(req)));
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await auth.logout(refreshTokenFrom(req));
    clearAuthCookies(res);
    res.status(204).end();
  })
);

/**
 * Who am I, without ever answering 401: anonymous visitors get { user: null }, so the browser console
 * stays clean on every public page. `refreshable` tells the site a silent refresh is worth trying.
 */
authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    let user = null;
    const token = req.cookies?.[ACCESS_COOKIE];
    if (token) {
      try {
        user = await auth.getMe(verifyAccessToken(token).sub);
      } catch {
        /* expired or invalid: treated as signed out */
      }
    }
    res.set("Cache-Control", "no-store");
    res.json({ user, refreshable: !user && !!req.cookies?.[REFRESH_COOKIE] });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await auth.getMe(req.userId!) });
  })
);

