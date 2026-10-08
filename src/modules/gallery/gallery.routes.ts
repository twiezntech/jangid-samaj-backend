import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  albumListQuery,
  albumManageQuery,
  createAlbumSchema,
  idParam,
  rejectSchema,
  slugRouteParam,
  updateAlbumSchema,
} from "./gallery.schemas";
import * as gallery from "./gallery.service";

export const galleryRouter = Router();

galleryRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await gallery.listPublic(albumListQuery.parse(req.query)));
  })
);

galleryRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await gallery.listForManage(req.actor!, albumManageQuery.parse(req.query)));
  })
);

galleryRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await gallery.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

galleryRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("gallery.submit", "gallery.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await gallery.createAlbum(req.actor!, createAlbumSchema.parse(req.body), req.ip));
  })
);

galleryRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await gallery.updateAlbum(req.actor!, idParam.parse(req.params).id, updateAlbumSchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  galleryRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await gallery.transitionAlbum(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

galleryRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await gallery.transitionAlbum(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

for (const [path, featured] of [["feature", true], ["unfeature", false]] as const) {
  galleryRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await gallery.setFeatured(req.actor!, idParam.parse(req.params).id, featured, req.ip));
    })
  );
}

galleryRouter.delete(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("gallery.delete"),
  asyncHandler(async (req, res) => {
    res.json(await gallery.deleteAlbum(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

galleryRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await gallery.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
