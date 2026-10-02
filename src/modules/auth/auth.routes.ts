import { Request, Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from "../../utils/cookies";
import { requireHuman } from "../../middleware/human";
import { googleSchema, loginSchema, registerSchema, resendSchema, verifyEmailSchema } from "./auth.schemas";
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
    const { user, accessToken, refreshToken } = await auth.verifyEmail(token, meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user });
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
  "/login",
  perIpLimit,
  perEmailLimit,
  requireHuman,
  asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await auth.login(loginSchema.parse(req.body), meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user });
  })
);

authRouter.post(
  "/google",
  perIpLimit,
  asyncHandler(async (req, res) => {
    const { credential } = googleSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await auth.loginWithGoogle(credential, meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user });
  })
);

authRouter.post(
  "/refresh",
  limiter(120),
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      clearAuthCookies(res);
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    try {
      const { user, accessToken, refreshToken } = await auth.refreshSession(token, meta(req));
      setAuthCookies(res, accessToken, refreshToken);
      res.json({ user });
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    res.status(204).end();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await auth.getMe(req.userId!) });
  })
);

