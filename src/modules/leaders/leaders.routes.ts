import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { createLeaderSchema, idParam, leaderListQuery, leaderManageQuery, rejectSchema, slugRouteParam, updateLeaderSchema } from "./leaders.schemas";
import * as leaders from "./leaders.service";

export const leadersRouter = Router();

leadersRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await leaders.listPublic(leaderListQuery.parse(req.query)));
  })
);

leadersRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await leaders.listForManage(req.actor!, leaderManageQuery.parse(req.query)));
  })
);

leadersRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await leaders.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

leadersRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("leader.submit", "leader.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await leaders.createLeader(req.actor!, createLeaderSchema.parse(req.body), req.ip));
  })
);

leadersRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await leaders.updateLeader(req.actor!, idParam.parse(req.params).id, updateLeaderSchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  leadersRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await leaders.transitionLeader(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

leadersRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await leaders.transitionLeader(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

leadersRouter.post(
  "/:id/verify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await leaders.setVerification(req.actor!, idParam.parse(req.params).id, true, req.ip));
  })
);

leadersRouter.post(
  "/:id/unverify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await leaders.setVerification(req.actor!, idParam.parse(req.params).id, false, req.ip));
  })
);

leadersRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await leaders.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
