import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { paginationQuery } from "../../lib/pagination";
import {
  codeParam,
  createProfileSchema,
  idParam,
  interestSchema,
  interestsQuery,
  manageQuery,
  rejectSchema,
  respondSchema,
  searchQuery,
  updateProfileSchema,
} from "./matrimony.schemas";
import * as m from "./matrimony.service";

/**
 * Every matrimony route is private: signed-in, verified members only, never cached.
 * Profiles are personal data, so nothing here is public or indexable.
 */
export const matrimonyRouter = Router();
matrimonyRouter.use(requireActor, noStore);

const toggle = z.object({ on: z.boolean() }).strict();
const hiddenBody = z.object({ hidden: z.boolean() }).strict();

matrimonyRouter.get("/search", asyncHandler(async (req, res) => res.json(await m.search(req.actor!, searchQuery.parse(req.query)))));

// ---- my profile -----------------------------------------------------------------

matrimonyRouter.get("/me", asyncHandler(async (req, res) => res.json(await m.getMine(req.actor!))));
matrimonyRouter.post("/me", writeLimiter, asyncHandler(async (req, res) => res.status(201).json(await m.createProfile(req.actor!, createProfileSchema.parse(req.body), req.ip))));
matrimonyRouter.patch("/me", writeLimiter, asyncHandler(async (req, res) => res.json(await m.updateMine(req.actor!, updateProfileSchema.parse(req.body), req.ip))));
matrimonyRouter.post("/me/hide", writeLimiter, asyncHandler(async (req, res) => res.json(await m.setHidden(req.actor!, hiddenBody.parse(req.body).hidden, req.ip))));
matrimonyRouter.delete("/me", writeLimiter, asyncHandler(async (req, res) => res.json(await m.deleteMine(req.actor!, req.ip))));

// ---- interests, shortlist, block ---------------------------------------------------

matrimonyRouter.get("/interests", asyncHandler(async (req, res) => res.json(await m.listInterests(req.actor!, interestsQuery.parse(req.query)))));
matrimonyRouter.post(
  "/interests/:id/respond",
  writeLimiter,
  asyncHandler(async (req, res) => res.json(await m.respondInterest(req.actor!, idParam.parse(req.params).id, respondSchema.parse(req.body).accept, req.ip)))
);
matrimonyRouter.get("/shortlist", asyncHandler(async (req, res) => res.json(await m.listShortlist(req.actor!, paginationQuery.parse(req.query)))));

matrimonyRouter.post(
  "/profiles/:code/interest",
  writeLimiter,
  asyncHandler(async (req, res) => res.status(201).json(await m.sendInterest(req.actor!, codeParam.parse(req.params).code, interestSchema.parse(req.body).message, req.ip)))
);
matrimonyRouter.post("/profiles/:code/withdraw", writeLimiter, asyncHandler(async (req, res) => res.json(await m.withdrawInterest(req.actor!, codeParam.parse(req.params).code, req.ip))));
matrimonyRouter.post("/profiles/:code/shortlist", writeLimiter, asyncHandler(async (req, res) => res.json(await m.setShortlist(req.actor!, codeParam.parse(req.params).code, toggle.parse(req.body).on))));
matrimonyRouter.post("/profiles/:code/block", writeLimiter, asyncHandler(async (req, res) => res.json(await m.setBlock(req.actor!, codeParam.parse(req.params).code, toggle.parse(req.body).on, req.ip))));
matrimonyRouter.get("/profiles/:code", asyncHandler(async (req, res) => res.json(await m.getByCode(req.actor!, codeParam.parse(req.params).code))));

// ---- moderation ---------------------------------------------------------------------

const manage = requirePermission("matrimony.manage");
matrimonyRouter.get("/manage/stats", manage, asyncHandler(async (req, res) => res.json(await m.stats(req.actor!))));
matrimonyRouter.get("/manage/list", manage, asyncHandler(async (req, res) => res.json(await m.listForManage(req.actor!, manageQuery.parse(req.query)))));
matrimonyRouter.get("/manage/:id", manage, asyncHandler(async (req, res) => res.json(await m.getForManage(req.actor!, idParam.parse(req.params).id))));
for (const [path, action] of [["approve", "publish"], ["archive", "archive"], ["restore", "restore"]] as const) {
  matrimonyRouter.post(`/manage/:id/${path}`, manage, writeLimiter, asyncHandler(async (req, res) => res.json(await m.moderate(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip))));
}
matrimonyRouter.post(
  "/manage/:id/reject",
  manage,
  writeLimiter,
  asyncHandler(async (req, res) => res.json(await m.moderate(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip)))
);
for (const [path, verified] of [["verify", true], ["unverify", false]] as const) {
  matrimonyRouter.post(`/manage/:id/${path}`, manage, writeLimiter, asyncHandler(async (req, res) => res.json(await m.setVerification(req.actor!, idParam.parse(req.params).id, verified, req.ip))));
}
