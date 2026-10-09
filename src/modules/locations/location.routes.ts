import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { noStore, publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { audit } from "../../lib/audit";
import { locationPath, slugParam } from "../../lib/validators";
import { cleanText } from "../../lib/sanitize";
import { getWithAncestors, listChildren, toLocationDto } from "./location.service";

export const locationRouter = Router();

const LEVELS = ["STATE", "DISTRICT", "CITY", "TEHSIL", "VILLAGE"] as const;

locationRouter.get(
  "/",
  publicCache(600),
  asyncHandler(async (req, res) => {
    const { parent } = z.object({ parent: locationPath.optional() }).parse(req.query);
    res.json({ items: await listChildren(parent) });
  })
);

/** Find a place by name in either language (global search, city pages). Districts and cities rank first. */
locationRouter.get(
  "/search",
  publicCache(300),
  asyncHandler(async (req, res) => {
    const { q, limit } = z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(20).default(8) }).parse(req.query);
    const rows = await prisma.location.findMany({
      where: { isActive: true, OR: [{ nameEn: { contains: q, mode: "insensitive" } }, { nameHi: { contains: q } }] },
      orderBy: [{ level: "asc" }, { nameEn: "asc" }],
      take: limit,
    });
    res.json({ items: rows.map(toLocationDto) });
  })
);

// Express 4 wildcard: everything after /detail/ is the slug path, e.g. /detail/rajasthan/jaipur
locationRouter.get(
  "/detail/*",
  publicCache(600),
  asyncHandler(async (req, res) => {
    const path = locationPath.parse(String((req.params as Record<string, string>)[0] ?? ""));
    res.json(await getWithAncestors(path));
  })
);

const createSchema = z
  .object({
    parentPath: locationPath.optional(),
    slug: slugParam,
    nameHi: z.string().trim().min(1).max(100),
    nameEn: z.string().trim().min(1).max(100),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

locationRouter.post(
  "/",
  requireActor,
  writeLimiter,
  requirePermission("location.manage"),
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const parent = input.parentPath ? await prisma.location.findUnique({ where: { path: input.parentPath } }) : null;
    if (input.parentPath && !parent) throw ApiError.notFound("Parent location not found");

    const level = parent ? LEVELS[LEVELS.indexOf(parent.level) + 1] : "STATE";
    if (!level) throw ApiError.badRequest("Villages cannot have children");

    const path = parent ? `${parent.path}/${input.slug}` : input.slug;
    if (await prisma.location.findUnique({ where: { path } })) throw ApiError.conflict("Location already exists");

    const created = await prisma.$transaction(async (tx) => {
      const loc = await tx.location.create({
        data: { slug: input.slug, path, level, parentId: parent?.id ?? null, nameHi: cleanText(input.nameHi), nameEn: cleanText(input.nameEn), sortOrder: input.sortOrder ?? 0 },
      });
      await audit(tx, { actorId: req.actor!.id, action: "location.create", entityType: "Location", entityId: loc.id, meta: { path }, ip: req.ip });
      return loc;
    });
    res.status(201).json(toLocationDto(created));
  })
);

// ---- management (location.manage) --------------------------------------------------

/** Children of a node including inactive ones, with content counts, for the admin tree. */
locationRouter.get(
  "/manage/children",
  requireActor,
  noStore,
  requirePermission("location.manage"),
  asyncHandler(async (req, res) => {
    const { parent } = z.object({ parent: locationPath.optional() }).parse(req.query);
    const rows = await prisma.location.findMany({
      where: parent ? { parent: { path: parent } } : { parentId: null },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      include: { _count: { select: { children: true, news: true, directory: true, leaders: true, events: true, businesses: true } } },
    });
    res.json({
      items: rows.map(({ _count, ...l }) => ({ ...toLocationDto(l), isActive: l.isActive, sortOrder: l.sortOrder, childCount: _count.children, contentCount: _count.news + _count.directory + _count.leaders + _count.events + _count.businesses })),
    });
  })
);

const updateSchema = z
  .object({
    path: locationPath,
    nameHi: z.string().trim().min(1).max(100).optional(),
    nameEn: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** Rename / reorder / (de)activate. Slugs and paths never change, so existing URLs and content stay valid. */
locationRouter.patch(
  "/manage",
  requireActor,
  writeLimiter,
  requirePermission("location.manage"),
  asyncHandler(async (req, res) => {
    const { path, ...input } = updateSchema.parse(req.body);
    const loc = await prisma.location.findUnique({ where: { path } });
    if (!loc) throw ApiError.notFound("Location not found");
    const updated = await prisma.$transaction(async (tx) => {
      const l = await tx.location.update({
        where: { id: loc.id },
        data: {
          ...(input.nameHi ? { nameHi: cleanText(input.nameHi) } : {}),
          ...(input.nameEn ? { nameEn: cleanText(input.nameEn) } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await audit(tx, { actorId: req.actor!.id, action: "location.update", entityType: "Location", entityId: loc.id, meta: { path, ...input }, ip: req.ip });
      return l;
    });
    res.json({ ...toLocationDto(updated), isActive: updated.isActive, sortOrder: updated.sortOrder });
  })
);
