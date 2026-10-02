import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { createEventSchema, eventListQuery, eventManageQuery, idParam, registerSchema, registrationsQuery, slugRouteParam, updateEventSchema } from "./events.schemas";
import * as events from "./events.service";

export const eventsRouter = Router();

/** Registration toggling is cheap to abuse (seat hoarding); keep it tight per account. */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "anon",
  message: { error: { message: "Too many attempts. Please try again later.", code: "RATE_LIMITED" } },
  skip: () => process.env.NODE_ENV === "test",
});

// ---- public ----------------------------------------------------------------

eventsRouter.get(
  "/",
  publicCache(60),
  asyncHandler(async (req, res) => {
    res.json(await events.listPublic(eventListQuery.parse(req.query)));
  })
);

// ---- member ----------------------------------------------------------------

eventsRouter.get(
  "/me/registrations",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await events.myRegistrations(req.actor!));
  })
);

eventsRouter.post(
  "/:id/register",
  requireActor,
  registrationLimiter,
  asyncHandler(async (req, res) => {
    res.status(201).json(await events.register(req.actor!, idParam.parse(req.params).id, registerSchema.parse(req.body), req.ip));
  })
);

eventsRouter.post(
  "/:id/register/cancel",
  requireActor,
  registrationLimiter,
  asyncHandler(async (req, res) => {
    res.json(await events.cancelRegistration(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

// ---- management (registered before "/:slug") ------------------------------------

eventsRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  requirePermission("event.manage"),
  asyncHandler(async (req, res) => {
    res.json(await events.listForManage(req.actor!, eventManageQuery.parse(req.query)));
  })
);

eventsRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  requirePermission("event.manage"),
  asyncHandler(async (req, res) => {
    res.json(await events.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

eventsRouter.get(
  "/manage/:id/registrations",
  requireActor,
  noStore,
  requirePermission("event.manage"),
  asyncHandler(async (req, res) => {
    const result = await events.listRegistrations(req.actor!, idParam.parse(req.params).id, registrationsQuery.parse(req.query));
    if ("csv" in result) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      return res.send(`﻿${result.csv}`); // BOM so Excel reads Hindi names correctly
    }
    res.json(result);
  })
);

eventsRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("event.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await events.createEvent(req.actor!, createEventSchema.parse(req.body), req.ip));
  })
);

eventsRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("event.manage"),
  asyncHandler(async (req, res) => {
    res.json(await events.updateEvent(req.actor!, idParam.parse(req.params).id, updateEventSchema.parse(req.body), req.ip));
  })
);

for (const action of ["publish", "unpublish", "archive", "restore"] as const) {
  eventsRouter.post(
    `/:id/${action}`,
    requireActor,
    writeLimiter,
    requirePermission("event.manage"),
    asyncHandler(async (req, res) => {
      res.json(await events.transitionEvent(req.actor!, idParam.parse(req.params).id, action, req.ip));
    })
  );
}

// ---- public detail (keep last) --------------------------------------------------

eventsRouter.get(
  "/:slug",
  publicCache(60),
  asyncHandler(async (req, res) => {
    res.json(await events.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
