import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  createObituarySchema,
  idParam,
  obituaryListQuery,
  obituaryManageQuery,
  rejectSchema,
  slugRouteParam,
  tributeListQuery,
  tributeManageQuery,
  tributeSchema,
  updateObituarySchema,
} from "./obituaries.schemas";
import * as obituaries from "./obituaries.service";

export const obituariesRouter = Router();

obituariesRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await obituaries.listPublic(obituaryListQuery.parse(req.query)));
  })
);

// ---- management (registered before "/:slug") ------------------------------------

obituariesRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.listForManage(req.actor!, obituaryManageQuery.parse(req.query)));
  })
);

obituariesRouter.get(
  "/manage/tributes",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.listTributesForManage(req.actor!, tributeManageQuery.parse(req.query)));
  })
);

obituariesRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

obituariesRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("obituary.submit", "obituary.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await obituaries.createObituary(req.actor!, createObituarySchema.parse(req.body), req.ip));
  })
);

// ---- tribute moderation ------------------------------------------------------------

for (const [path, to] of [["approve", "PUBLISHED"], ["hide", "HIDDEN"]] as const) {
  obituariesRouter.post(
    `/tributes/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await obituaries.moderateTribute(req.actor!, idParam.parse(req.params).id, to, req.ip));
    })
  );
}

obituariesRouter.delete(
  "/tributes/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.deleteTribute(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

// ---- notice workflow ---------------------------------------------------------------

obituariesRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.updateObituary(req.actor!, idParam.parse(req.params).id, updateObituarySchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  obituariesRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await obituaries.transitionObituary(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

obituariesRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.transitionObituary(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

obituariesRouter.delete(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("obituary.delete"),
  asyncHandler(async (req, res) => {
    res.json(await obituaries.deleteObituary(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

// ---- a member's own tribute ----------------------------------------------------------

obituariesRouter.get(
  "/:id/tributes/mine",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json({ tribute: await obituaries.myTribute(req.actor!, idParam.parse(req.params).id) });
  })
);

obituariesRouter.post(
  "/:id/tributes",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.status(201).json(await obituaries.postTribute(req.actor!, idParam.parse(req.params).id, tributeSchema.parse(req.body), req.ip));
  })
);

obituariesRouter.delete(
  "/:id/tributes/mine",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await obituaries.deleteMyTribute(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

// ---- public detail -------------------------------------------------------------------

obituariesRouter.get(
  "/:slug/tributes",
  publicCache(60),
  asyncHandler(async (req, res) => {
    res.json(await obituaries.listTributes(slugRouteParam.parse(req.params).slug, tributeListQuery.parse(req.query)));
  })
);

obituariesRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await obituaries.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
