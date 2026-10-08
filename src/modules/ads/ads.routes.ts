import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { noStore } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { audit } from "../../lib/audit";
import { paginationQuery, toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { httpsUrl, imageUrl, locationPath } from "../../lib/validators";
import { findLocation, resolveLocation } from "../locations/location.service";

const PLACEMENTS = ["HOME_TOP", "HOME_FEED", "SIDEBAR", "ARTICLE_INLINE", "LIST_TOP"] as const;

const fields = {
  name: z.string().trim().min(2).max(120),
  advertiser: z.string().trim().min(2).max(120),
  placement: z.enum(PLACEMENTS),
  imageUrl,
  linkUrl: httpsUrl,
  altText: z.string().trim().min(2).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().optional(),
  weight: z.number().int().min(1).max(100).optional(),
  locationPath: locationPath.nullable().optional(),
};
const createSchema = z.object(fields).strict().refine((v) => v.endsAt > v.startsAt, { message: "End must be after start", path: ["endsAt"] });
const updateSchema = z.object(fields).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update");
const serveQuery = z.object({ placement: z.enum(PLACEMENTS), location: locationPath.optional(), count: z.coerce.number().int().min(1).max(4).default(1) });
const manageQuery = paginationQuery.extend({ placement: z.enum(PLACEMENTS).optional(), state: z.enum(["live", "scheduled", "ended", "paused"]).optional() });
const idParam = z.object({ id: z.string().trim().min(10).max(40) });

const publicAd = { id: true, placement: true, imageUrl: true, altText: true, advertiser: true } satisfies Prisma.AdSelect;

/** Weighted random pick without replacement, so a slot rotates between campaigns. */
function pick<T extends { weight: number }>(rows: T[], n: number) {
  const pool = [...rows];
  const out: T[] = [];
  while (pool.length && out.length < n) {
    let r = Math.random() * pool.reduce((s, a) => s + a.weight, 0);
    const i = pool.findIndex((a) => (r -= a.weight) <= 0);
    out.push(...pool.splice(i < 0 ? 0 : i, 1));
  }
  return out;
}

const countLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });

export const adsRouter = Router();

/** Ads for one slot. Location-targeted campaigns only show inside their area; untargeted ones everywhere. */
adsRouter.get(
  "/",
  noStore,
  asyncHandler(async (req, res) => {
    const q = serveQuery.parse(req.query);
    const loc = q.location ? await findLocation(q.location) : null;
    const chain = loc ? q.location!.split("/").map((_, i, a) => a.slice(0, i + 1).join("/")) : [];
    const areaIds = chain.length ? (await prisma.location.findMany({ where: { path: { in: chain } }, select: { id: true } })).map((l) => l.id) : [];
    const now = new Date();
    const rows = await prisma.ad.findMany({
      where: { placement: q.placement, isActive: true, startsAt: { lte: now }, endsAt: { gt: now }, OR: [{ locationId: null }, ...(areaIds.length ? [{ locationId: { in: areaIds } }] : [])] },
      select: { ...publicAd, weight: true },
      take: 50,
    });
    res.json({ items: pick(rows, q.count).map(({ weight, ...a }) => (void weight, a)) });
  })
);

adsRouter.post(
  "/:id/impression",
  countLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await prisma.ad.updateMany({ where: { id, isActive: true }, data: { impressions: { increment: 1 } } });
    res.status(204).end();
  })
);

/** Counted redirect. A plain GET link so it works without JavaScript and opens the advertiser directly. */
adsRouter.get(
  "/:id/click",
  countLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const ad = await prisma.ad.findUnique({ where: { id }, select: { linkUrl: true } });
    if (!ad) throw ApiError.notFound("Ad not found");
    await prisma.ad.update({ where: { id }, data: { clicks: { increment: 1 } } });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, ad.linkUrl);
  })
);

// ---- management --------------------------------------------------------------------

const manage = [requireActor, requirePermission("ad.manage"), noStore];

const manageSelect = {
  id: true,
  name: true,
  advertiser: true,
  placement: true,
  imageUrl: true,
  linkUrl: true,
  altText: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  weight: true,
  impressions: true,
  clicks: true,
  updatedAt: true,
  location: { select: { path: true, nameHi: true, nameEn: true } },
} satisfies Prisma.AdSelect;

function stateWhere(state: string | undefined): Prisma.AdWhereInput {
  const now = new Date();
  if (state === "live") return { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } };
  if (state === "scheduled") return { isActive: true, startsAt: { gt: now } };
  if (state === "ended") return { endsAt: { lte: now } };
  if (state === "paused") return { isActive: false, endsAt: { gt: now } };
  return {};
}

adsRouter.get(
  "/manage/list",
  ...manage,
  asyncHandler(async (req, res) => {
    const p = manageQuery.parse(req.query);
    const where: Prisma.AdWhereInput = { ...(p.placement ? { placement: p.placement } : {}), ...stateWhere(p.state) };
    const [rows, total, totals] = await Promise.all([
      prisma.ad.findMany({ where, select: manageSelect, orderBy: [{ endsAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
      prisma.ad.count({ where }),
      prisma.ad.aggregate({ _sum: { impressions: true, clicks: true } }),
    ]);
    res.json({ ...toPage(rows, total, p.page, p.limit), totals: { impressions: totals._sum.impressions ?? 0, clicks: totals._sum.clicks ?? 0 } });
  })
);

adsRouter.get(
  "/manage/:id",
  ...manage,
  asyncHandler(async (req, res) => {
    const ad = await prisma.ad.findUnique({ where: { id: idParam.parse(req.params).id }, select: manageSelect });
    if (!ad) throw ApiError.notFound("Ad not found");
    res.json(ad);
  })
);

async function areaData(path: string | null | undefined) {
  if (path === undefined) return {};
  if (path === null) return { locationId: null, stateId: null, districtId: null, cityId: null };
  const r = await resolveLocation(path);
  return { locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId };
}

const cleanCopy = (v: { name?: string; advertiser?: string; altText?: string }) => ({
  ...(v.name !== undefined ? { name: cleanText(v.name) } : {}),
  ...(v.advertiser !== undefined ? { advertiser: cleanText(v.advertiser) } : {}),
  ...(v.altText !== undefined ? { altText: cleanText(v.altText) } : {}),
});

adsRouter.post(
  "/manage",
  ...manage,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { locationPath: lp, ...input } = createSchema.parse(req.body);
    const ad = await prisma.$transaction(async (tx) => {
      const created = await tx.ad.create({ data: { ...input, ...cleanCopy(input), ...(await areaData(lp ?? null)), createdById: req.actor!.id }, select: manageSelect });
      await audit(tx, { actorId: req.actor!.id, action: "ad.create", entityType: "Ad", entityId: created.id, ip: req.ip });
      return created;
    });
    res.status(201).json(ad);
  })
);

adsRouter.patch(
  "/manage/:id",
  ...manage,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { locationPath: lp, ...input } = updateSchema.parse(req.body);
    const current = await prisma.ad.findUnique({ where: { id }, select: { startsAt: true, endsAt: true } });
    if (!current) throw ApiError.notFound("Ad not found");
    if ((input.endsAt ?? current.endsAt) <= (input.startsAt ?? current.startsAt)) throw ApiError.badRequest("End must be after start");
    const ad = await prisma.$transaction(async (tx) => {
      const updated = await tx.ad.update({ where: { id }, data: { ...input, ...cleanCopy(input), ...(await areaData(lp)) }, select: manageSelect });
      await audit(tx, { actorId: req.actor!.id, action: "ad.update", entityType: "Ad", entityId: id, ip: req.ip });
      return updated;
    });
    res.json(ad);
  })
);

adsRouter.delete(
  "/manage/:id",
  ...manage,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const ad = await prisma.ad.findUnique({ where: { id }, select: { name: true, impressions: true, clicks: true } });
    if (!ad) throw ApiError.notFound("Ad not found");
    await prisma.$transaction(async (tx) => {
      await tx.ad.delete({ where: { id } });
      await audit(tx, { actorId: req.actor!.id, action: "ad.delete", entityType: "Ad", entityId: id, meta: ad, ip: req.ip });
    });
    res.json({ id, deleted: true });
  })
);
