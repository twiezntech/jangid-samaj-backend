import { Router } from "express";
import { Prisma, type ReportTarget } from "@prisma/client";
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

const TARGETS = ["NEWS", "BUSINESS", "EVENT", "DIRECTORY", "LEADER", "ACHIEVEMENT", "OBITUARY", "TRIBUTE", "JOB", "ALBUM", "MATRIMONY"] as const;
const REASONS = ["SPAM", "FAKE", "OFFENSIVE", "WRONG_INFO", "PRIVACY", "OTHER"] as const;

const reportSchema = z
  .object({
    targetType: z.enum(TARGETS),
    /** Slug for public pages, tribute id, or matrimony profile code. */
    targetId: z.string().trim().min(2).max(120),
    reason: z.enum(REASONS),
    details: z.string().trim().max(1000).optional(),
  })
  .strict();

const manageQuery = paginationQuery.extend({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional(), type: z.enum(TARGETS).optional() });
const updateSchema = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional(), adminNote: z.string().trim().max(1000).nullable().optional() }).strict();
const idParam = z.object({ id: z.string().trim().min(10).max(40) });

const live = { status: "PUBLISHED" as const };
const SECTION: Partial<Record<ReportTarget, string>> = { NEWS: "news", BUSINESS: "business", EVENT: "events", DIRECTORY: "directory", LEADER: "leaders", ACHIEVEMENT: "achievements", OBITUARY: "obituaries", JOB: "jobs", ALBUM: "gallery" };

/** Resolves a report target to the stored key (slug / id) and confirms it is public. */
async function resolveTarget(type: ReportTarget, key: string): Promise<string | null> {
  const bySlug = { where: { slug: key, ...live }, select: { slug: true } };
  switch (type) {
    case "NEWS":
      return (await prisma.news.findFirst(bySlug))?.slug ?? null;
    case "BUSINESS":
      return (await prisma.business.findFirst(bySlug))?.slug ?? null;
    case "EVENT":
      return (await prisma.event.findFirst(bySlug))?.slug ?? null;
    case "DIRECTORY":
      return (await prisma.directoryEntry.findFirst(bySlug))?.slug ?? null;
    case "LEADER":
      return (await prisma.leaderProfile.findFirst(bySlug))?.slug ?? null;
    case "ACHIEVEMENT":
      return (await prisma.achievement.findFirst(bySlug))?.slug ?? null;
    case "OBITUARY":
      return (await prisma.obituary.findFirst(bySlug))?.slug ?? null;
    case "JOB":
      return (await prisma.job.findFirst(bySlug))?.slug ?? null;
    case "ALBUM":
      return (await prisma.album.findFirst(bySlug))?.slug ?? null;
    case "TRIBUTE":
      return (await prisma.obituaryTribute.findFirst({ where: { id: key, status: "PUBLISHED" }, select: { id: true } }))?.id ?? null;
    case "MATRIMONY":
      return (await prisma.matrimonyProfile.findFirst({ where: { code: key.toUpperCase(), status: "PUBLISHED" }, select: { id: true } }))?.id ?? null;
  }
}

/** Where a moderator opens the reported item. */
async function targetLink(type: ReportTarget, key: string) {
  if (SECTION[type]) return { site: `/${SECTION[type]}/${key}` };
  if (type === "TRIBUTE") {
    const t = await prisma.obituaryTribute.findUnique({ where: { id: key }, select: { message: true, obituary: { select: { id: true, slug: true } } } });
    return t ? { site: `/obituaries/${t.obituary.slug}`, admin: `/obituaries/tributes?obituaryId=${t.obituary.id}`, preview: t.message.slice(0, 200) } : {};
  }
  const p = await prisma.matrimonyProfile.findUnique({ where: { id: key }, select: { code: true } });
  return p ? { admin: `/matrimony/${key}`, preview: p.code } : {};
}

export const reportsRouter = Router();

reportsRouter.post(
  "/",
  requireActor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const input = reportSchema.parse(req.body);
    const targetId = await resolveTarget(input.targetType, input.targetId);
    if (!targetId) throw ApiError.notFound("This item is not available");
    try {
      const r = await prisma.$transaction(async (tx) => {
        const created = await tx.contentReport.create({
          data: { targetType: input.targetType, targetId, reason: input.reason, details: input.details ? cleanText(input.details) || null : null, reporterId: req.actor!.id },
          select: { id: true, status: true },
        });
        await audit(tx, { actorId: req.actor!.id, action: "report.create", entityType: "ContentReport", entityId: created.id, meta: { targetType: input.targetType, targetId }, ip: req.ip });
        return created;
      });
      res.status(201).json(r);
    } catch (e) {
      // Reporting the same thing twice is not an error for the member.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.status(200).json({ alreadyReported: true });
      throw e;
    }
  })
);

reportsRouter.get(
  "/manage",
  requireActor,
  requirePermission("report.manage"),
  noStore,
  asyncHandler(async (req, res) => {
    const p = manageQuery.parse(req.query);
    const where: Prisma.ContentReportWhereInput = { ...(p.status ? { status: p.status } : {}), ...(p.type ? { targetType: p.type } : {}) };
    const [rows, total, open] = await Promise.all([
      prisma.contentReport.findMany({
        where,
        select: { id: true, targetType: true, targetId: true, reason: true, details: true, status: true, adminNote: true, createdAt: true, resolvedAt: true, reporter: { select: { name: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (p.page - 1) * p.limit,
        take: p.limit,
      }),
      prisma.contentReport.count({ where }),
      prisma.contentReport.count({ where: { status: "NEW" } }),
    ]);
    const items = await Promise.all(rows.map(async (r) => ({ ...r, link: await targetLink(r.targetType, r.targetId) })));
    res.json({ ...toPage(items, total, p.page, p.limit), open });
  })
);

reportsRouter.patch(
  "/manage/:id",
  requireActor,
  requirePermission("report.manage"),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = updateSchema.parse(req.body);
    const r = await prisma.contentReport.findUnique({ where: { id }, select: { id: true } });
    if (!r) throw ApiError.notFound("Report not found");
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.contentReport.update({
        where: { id },
        data: {
          ...(input.status ? { status: input.status, ...(input.status === "CLOSED" ? { resolvedAt: new Date(), resolvedById: req.actor!.id } : { resolvedAt: null, resolvedById: null }) } : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote ? cleanText(input.adminNote) || null : null } : {}),
        },
        select: { id: true, status: true, adminNote: true },
      });
      await audit(tx, { actorId: req.actor!.id, action: "report.update", entityType: "ContentReport", entityId: id, meta: input, ip: req.ip });
      return u;
    });
    res.json(updated);
  })
);
