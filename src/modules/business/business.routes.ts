import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore, publicCache } from "../../middleware/httpCache";
import { optionalActor, requireActor, requirePermission } from "../../middleware/auth";
import { requireHuman } from "../../middleware/human";
import { writeLimiter } from "../../middleware/rateLimits";
import {
  businessListQuery,
  businessManageQuery,
  categorySchema,
  createBusinessSchema,
  enquiryListQuery,
  enquirySchema,
  enquiryUpdateSchema,
  idParam,
  rejectSchema,
  slugRouteParam,
  updateBusinessSchema,
} from "./business.schemas";
import * as business from "./business.service";

export const businessRouter = Router();

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many enquiries. Please try again later.", code: "RATE_LIMITED" } },
  skip: () => process.env.NODE_ENV === "test",
});

// ---- public ----------------------------------------------------------------

businessRouter.get(
  "/",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await business.listPublic(businessListQuery.parse(req.query)));
  })
);

businessRouter.get(
  "/categories",
  publicCache(600),
  asyncHandler(async (_req, res) => {
    res.json(await business.listCategories());
  })
);

businessRouter.post(
  "/:id/enquiry",
  enquiryLimiter,
  optionalActor,
  requireHuman,
  asyncHandler(async (req, res) => {
    const input = enquirySchema.parse(req.body);
    const result = await business.createEnquiry(idParam.parse(req.params).id, input, req.actor?.id, req.ip);
    res.status(201).json({ ok: true, duplicate: result.duplicate });
  })
);

// ---- owner / member --------------------------------------------------------------

businessRouter.get(
  "/me/listings",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await business.myListings(req.actor!));
  })
);

businessRouter.get(
  "/me/enquiries",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await business.listEnquiries(req.actor!, enquiryListQuery.parse(req.query), { ownOnly: true }));
  })
);

businessRouter.get(
  "/edit/:id",
  requireActor,
  noStore,
  asyncHandler(async (req, res) => {
    res.json(await business.getForEdit(req.actor!, idParam.parse(req.params).id));
  })
);

businessRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("business.submit", "business.manage"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await business.createBusiness(req.actor!, createBusinessSchema.parse(req.body), req.ip));
  })
);

businessRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await business.updateBusiness(req.actor!, idParam.parse(req.params).id, updateBusinessSchema.parse(req.body), req.ip));
  })
);

for (const [path, action] of [["submit", "submit"], ["approve", "publish"], ["archive", "archive"], ["restore", "restore"]] as const) {
  businessRouter.post(
    `/:id/${path}`,
    requireActor,
    writeLimiter,
    asyncHandler(async (req, res) => {
      res.json(await business.transitionBusiness(req.actor!, idParam.parse(req.params).id, action, undefined, req.ip));
    })
  );
}

businessRouter.post(
  "/:id/reject",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await business.transitionBusiness(req.actor!, idParam.parse(req.params).id, "reject", rejectSchema.parse(req.body).reason, req.ip));
  })
);

businessRouter.post(
  "/:id/verify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await business.setVerification(req.actor!, idParam.parse(req.params).id, true, req.ip));
  })
);

businessRouter.post(
  "/:id/unverify",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await business.setVerification(req.actor!, idParam.parse(req.params).id, false, req.ip));
  })
);

// ---- management -----------------------------------------------------------------

businessRouter.get(
  "/manage/list",
  requireActor,
  noStore,
  requirePermission("business.manage"),
  asyncHandler(async (req, res) => {
    res.json(await business.listForManage(req.actor!, businessManageQuery.parse(req.query)));
  })
);

businessRouter.get(
  "/manage/enquiries",
  requireActor,
  noStore,
  requirePermission("business.manage"),
  asyncHandler(async (req, res) => {
    res.json(await business.listEnquiries(req.actor!, enquiryListQuery.parse(req.query)));
  })
);

businessRouter.patch(
  "/enquiries/:id",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(await business.updateEnquiry(req.actor!, idParam.parse(req.params).id, enquiryUpdateSchema.parse(req.body).status, req.ip));
  })
);

businessRouter.get(
  "/manage/categories",
  requireActor,
  noStore,
  requirePermission("taxonomy.manage", "business.manage"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.businessCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { slug: true, nameHi: true, nameEn: true, icon: true, sortOrder: true, isActive: true, _count: { select: { businesses: true } } },
    });
    res.json({ items: rows.map(({ _count, ...c }) => ({ ...c, count: _count.businesses })) });
  })
);

businessRouter.put(
  "/manage/categories",
  requireActor,
  writeLimiter,
  requirePermission("taxonomy.manage"),
  asyncHandler(async (req, res) => {
    res.json(await business.upsertCategory(req.actor!, categorySchema.parse(req.body), req.ip));
  })
);

// ---- public detail (keep last) --------------------------------------------------

businessRouter.get(
  "/:slug",
  publicCache(120),
  asyncHandler(async (req, res) => {
    res.json(await business.getPublicBySlug(slugRouteParam.parse(req.params).slug));
  })
);
