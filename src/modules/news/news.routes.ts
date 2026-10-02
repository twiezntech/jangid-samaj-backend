import { Request, Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { publicCache, noStore } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import type { WorkflowAction } from "../../lib/workflow";
import {
  createNewsSchema,
  idParam,
  manageListQuery,
  publicListQuery,
  rejectSchema,
  scheduleSchema,
  slugRouteParam,
  updateNewsSchema,
} from "./news.schemas";
import * as news from "./news.service";

export const newsRouter = Router();

// ---- public -------------------------------------------------------------

newsRouter.get(
  "/",
  publicCache(60),
  asyncHandler(async (req, res) => {
    res.json(await news.listPublic(publicListQuery.parse(req.query)));
  })
);

// ---- editorial (authenticated) -------------------------------------------
// Registered before "/:slug" so "manage" is never mistaken for a slug.

newsRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await news.listForManage(req.actor!, manageListQuery.parse(req.query)));
  })
);

newsRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await news.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

newsRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("news.create"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await news.createNews(req.actor!, createNewsSchema.parse(req.body), req.ip));
  })
);

newsRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await news.updateNews(req.actor!, idParam.parse(req.params).id, updateNewsSchema.parse(req.body), req.ip));
  })
);

const act = (action: WorkflowAction, parseBody?: (req: Request) => news.TransitionOptions) =>
  asyncHandler(async (req, res) => {
    const opts = parseBody ? parseBody(req) : {};
    res.json(await news.transitionNews(req.actor!, idParam.parse(req.params).id, action, opts, req.ip));
  });

for (const action of ["submit", "publish", "archive", "restore", "unpublish"] as const) {
  newsRouter.post(`/:id/${action}`, requireActor, writeLimiter, act(action));
}
newsRouter.post("/:id/schedule", requireActor, writeLimiter, act("schedule", (req) => ({ scheduledAt: scheduleSchema.parse(req.body).scheduledAt })));
newsRouter.post("/:id/reject", requireActor, writeLimiter, act("reject", (req) => ({ reason: rejectSchema.parse(req.body).reason })));

// ---- public detail (keep last) --------------------------------------------

newsRouter.get(
  "/:slug",
  publicCache(60),
  asyncHandler(async (req, res) => {
    res.json(await news.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
