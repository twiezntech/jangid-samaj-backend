import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  createDirectorySchema,
  directoryListQuery,
  directoryManageQuery,
  idParam,
  rejectSchema,
  slugRouteParam,
  updateDirectorySchema,
} from "./directory.schemas";
import * as directory from "./directory.service";

export const directoryRouter = Router();

directoryRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await directory.listPublic(directoryListQuery.parse(req.query)));
  })
);

directoryRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await directory.listForManage(req.actor!, directoryManageQuery.parse(req.query)));
  })
);

directoryRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await directory.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

directoryRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("directory.submit", "directory.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await directory.createEntry(req.actor!, createDirectorySchema.parse(req.body), req.ip));
  })
);

directoryRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await directory.updateEntry(req.actor!, idParam.parse(req.params).id, updateDirectorySchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  directoryRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await directory.transitionEntry(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

directoryRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await directory.transitionEntry(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

directoryRouter.post(
  "/:id/verify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await directory.setVerification(req.actor!, idParam.parse(req.params).id, true, req.ip));
  })
);

directoryRouter.post(
  "/:id/unverify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await directory.setVerification(req.actor!, idParam.parse(req.params).id, false, req.ip));
  })
);

directoryRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await directory.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
