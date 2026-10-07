import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  achievementListQuery,
  achievementManageQuery,
  createAchievementSchema,
  idParam,
  rejectSchema,
  slugRouteParam,
  updateAchievementSchema,
} from "./achievements.schemas";
import * as achievements from "./achievements.service";

export const achievementsRouter = Router();

achievementsRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await achievements.listPublic(achievementListQuery.parse(req.query)));
  })
);

achievementsRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await achievements.listForManage(req.actor!, achievementManageQuery.parse(req.query)));
  })
);

achievementsRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await achievements.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

achievementsRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("achievement.submit", "achievement.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await achievements.createAchievement(req.actor!, createAchievementSchema.parse(req.body), req.ip));
  })
);

achievementsRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await achievements.updateAchievement(req.actor!, idParam.parse(req.params).id, updateAchievementSchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  achievementsRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await achievements.transitionAchievement(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

achievementsRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await achievements.transitionAchievement(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

for (const [path, featured] of [["feature", true], ["unfeature", false]] as const) {
  achievementsRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await achievements.setFeatured(req.actor!, idParam.parse(req.params).id, featured, req.ip));
    })
  );
}

achievementsRouter.delete(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("achievement.delete"),
  asyncHandler(async (req, res) => {
    res.json(await achievements.deleteAchievement(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

achievementsRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await achievements.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
