import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  bulkGotraSchema,
  createGotraSchema,
  createRishiSchema,
  gotraListQuery,
  gotraManageQuery,
  idParam,
  updateGotraSchema,
  updateRishiSchema,
} from "./gotra.schemas";
import * as gotra from "./gotra.service";

export const gotraRouter = Router();

/** Everything below "manage" needs a signed-in staff member holding `gotra.manage`. */
const manage = [requireActor, requirePermission("gotra.manage")];
const write = [...manage, writeLimiter];

// ---- public (cached; contain no personal data) ----------------------------------------

gotraRouter.get(
  "/",
  publicCache(300),
  asyncHandler(async (req, res) => {
    res.json(await gotra.listPublic(gotraListQuery.parse(req.query)));
  })
);

gotraRouter.get(
  "/rishis",
  publicCache(300),
  asyncHandler(async (_req, res) => {
    res.json(await gotra.listPublicRishis());
  })
);

// ---- manage -----------------------------------------------------------------------------

gotraRouter.get(
  "/manage/list",
  ...manage,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await gotra.listForManage(gotraManageQuery.parse(req.query)));
  })
);

gotraRouter.get(
  "/manage/rishis",
  ...manage,
  noStore,
  asyncHandler(async (_req, res) => {
    res.json(await gotra.listRishisForManage());
  })
);

gotraRouter.post(
  "/",
  ...write,
  asyncHandler(async (req, res) => {
    res.status(201).json(await gotra.createGotra(req.actor!, createGotraSchema.parse(req.body), req.ip));
  })
);

// Must stay above "/:id" so "bulk" is not read as an id.
gotraRouter.patch(
  "/bulk",
  ...write,
  asyncHandler(async (req, res) => {
    res.json(await gotra.bulkUpdateGotras(req.actor!, bulkGotraSchema.parse(req.body), req.ip));
  })
);

gotraRouter.patch(
  "/:id",
  ...write,
  asyncHandler(async (req, res) => {
    res.json(await gotra.updateGotra(req.actor!, idParam.parse(req.params).id, updateGotraSchema.parse(req.body), req.ip));
  })
);

gotraRouter.delete(
  "/:id",
  ...write,
  asyncHandler(async (req, res) => {
    res.json(await gotra.deleteGotra(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

gotraRouter.post(
  "/rishis",
  ...write,
  asyncHandler(async (req, res) => {
    res.status(201).json(await gotra.createRishi(req.actor!, createRishiSchema.parse(req.body), req.ip));
  })
);

gotraRouter.patch(
  "/rishis/:id",
  ...write,
  asyncHandler(async (req, res) => {
    res.json(await gotra.updateRishi(req.actor!, idParam.parse(req.params).id, updateRishiSchema.parse(req.body), req.ip));
  })
);

gotraRouter.delete(
  "/rishis/:id",
  ...write,
  asyncHandler(async (req, res) => {
    res.json(await gotra.deleteRishi(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);
