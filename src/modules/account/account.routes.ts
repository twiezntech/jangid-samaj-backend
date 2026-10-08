import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore } from "../../middleware/httpCache";
import { requireActor } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { REFRESH_COOKIE, clearAuthCookies } from "../../utils/cookies";
import {
  changePasswordSchema,
  deleteAccountSchema,
  idParam,
  notificationsQuery,
  savedListQuery,
  savedSchema,
  savedStatusQuery,
  updateProfileSchema,
} from "./account.schemas";
import * as account from "./account.service";

/** Password checks are brute-forceable; keep them slow. */
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please try again later." } },
  keyGenerator: (req) => req.userId ?? req.ip ?? "anon",
  skip: () => process.env.NODE_ENV === "test",
});

export const accountRouter = Router();
accountRouter.use(requireActor, noStore);

accountRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    res.json(await account.getProfile(req.actor!.id));
  })
);

accountRouter.patch(
  "/profile",
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await account.updateProfile(req.actor!.id, updateProfileSchema.parse(req.body), req.ip));
  })
);

accountRouter.post(
  "/password",
  passwordLimiter,
  asyncHandler(async (req, res) => {
    res.json(await account.changePassword(req.actor!.id, changePasswordSchema.parse(req.body), req.cookies?.[REFRESH_COOKIE], req.ip));
  })
);

accountRouter.post(
  "/delete",
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const { password } = deleteAccountSchema.parse(req.body);
    const out = await account.deleteAccount(req.actor!.id, password, req.ip);
    clearAuthCookies(res);
    res.json(out);
  })
);

// ---- saved items ----------------------------------------------------------------

accountRouter.get(
  "/saved",
  asyncHandler(async (req, res) => {
    res.json(await account.listSaved(req.actor!.id, savedListQuery.parse(req.query)));
  })
);

accountRouter.get(
  "/saved/status",
  asyncHandler(async (req, res) => {
    const { type, slug } = savedStatusQuery.parse(req.query);
    res.json(await account.isSaved(req.actor!.id, type, slug));
  })
);

accountRouter.post(
  "/saved",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { type, slug } = savedSchema.parse(req.body);
    res.status(201).json(await account.save(req.actor!.id, type, slug));
  })
);

accountRouter.post(
  "/saved/remove",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { type, slug } = savedSchema.parse(req.body);
    res.json(await account.unsave(req.actor!.id, type, slug));
  })
);

// ---- notifications ------------------------------------------------------------------

accountRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    res.json(await account.listNotifications(req.actor!.id, notificationsQuery.parse(req.query)));
  })
);

accountRouter.get(
  "/notifications/unread",
  asyncHandler(async (req, res) => {
    res.json(await account.unreadCount(req.actor!.id));
  })
);

accountRouter.post(
  "/notifications/read",
  asyncHandler(async (req, res) => {
    res.json(await account.markRead(req.actor!.id));
  })
);

accountRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    res.json(await account.markRead(req.actor!.id, idParam.parse(req.params).id));
  })
);
