import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  applicationStatusSchema,
  applicationsQuery,
  applySchema,
  createJobSchema,
  idParam,
  jobListQuery,
  jobManageQuery,
  rejectSchema,
  slugRouteParam,
  updateJobSchema,
} from "./jobs.schemas";
import * as jobs from "./jobs.service";

export const jobsRouter = Router();

jobsRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await jobs.listPublic(jobListQuery.parse(req.query)));
  })
);

// ---- management (before "/:slug") ------------------------------------------------

jobsRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await jobs.listForManage(req.actor!, jobManageQuery.parse(req.query)));
  })
);

jobsRouter.get(
  "/manage/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await jobs.getForManage(req.actor!, idParam.parse(req.params).id));
  })
);

jobsRouter.get(
  "/manage/:id/applications",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await jobs.listApplications(req.actor!, idParam.parse(req.params).id, applicationsQuery.parse(req.query)));
  })
);

jobsRouter.patch(
  "/applications/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await jobs.setApplicationStatus(req.actor!, idParam.parse(req.params).id, applicationStatusSchema.parse(req.body).status, req.ip));
  })
);

jobsRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("job.submit", "job.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await jobs.createJob(req.actor!, createJobSchema.parse(req.body), req.ip));
  })
);

jobsRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await jobs.updateJob(req.actor!, idParam.parse(req.params).id, updateJobSchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"], ["submit", "submit"]] as const) {
  jobsRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await jobs.transitionJob(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

jobsRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await jobs.transitionJob(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

for (const [path, featured] of [["feature", true], ["unfeature", false]] as const) {
  jobsRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await jobs.setFeatured(req.actor!, idParam.parse(req.params).id, featured, req.ip));
    })
  );
}

jobsRouter.delete(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("job.delete"),
  asyncHandler(async (req, res) => {
    res.json(await jobs.deleteJob(req.actor!, idParam.parse(req.params).id, req.ip));
  })
);

// ---- applying ---------------------------------------------------------------------

jobsRouter.get(
  "/:id/application",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json({ application: await jobs.myApplication(req.actor!, idParam.parse(req.params).id) });
  })
);

jobsRouter.post(
  "/:id/apply",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.status(201).json(await jobs.apply(req.actor!, idParam.parse(req.params).id, applySchema.parse(req.body), req.ip));
  })
);

jobsRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await jobs.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
