import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { publicCache } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { audit } from "../../lib/audit";
import { cleanText } from "../../lib/sanitize";
import { slugParam } from "../../lib/validators";

export const taxonomyRouter = Router();

taxonomyRouter.get(
  "/categories",
  publicCache(600),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { slug: true, nameHi: true, nameEn: true, parent: { select: { slug: true } } },
    });
    res.json({ items: rows.map((r) => ({ slug: r.slug, nameHi: r.nameHi, nameEn: r.nameEn, parentSlug: r.parent?.slug ?? null })) });
  })
);

taxonomyRouter.get(
  "/tags",
  publicCache(600),
  asyncHandler(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const rows = await prisma.tag.findMany({
      orderBy: [{ news: { _count: "desc" } }, { nameEn: "asc" }],
      take: limit,
      select: { slug: true, nameHi: true, nameEn: true },
    });
    res.json({ items: rows });
  })
);

const nameSchema = z.object({ slug: slugParam, nameHi: z.string().trim().min(1).max(80), nameEn: z.string().trim().min(1).max(80) }).strict();

taxonomyRouter.post(
  "/categories",
  requireActor,
  writeLimiter,
  requirePermission("taxonomy.manage"),
  asyncHandler(async (req, res) => {
    const input = nameSchema.extend({ parentSlug: slugParam.optional() }).parse(req.body);
    const parent = input.parentSlug ? await prisma.category.findUnique({ where: { slug: input.parentSlug } }) : null;
    if (input.parentSlug && !parent) throw ApiError.notFound("Parent category not found");
    if (await prisma.category.findUnique({ where: { slug: input.slug } })) throw ApiError.conflict("Category already exists");

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.category.create({ data: { slug: input.slug, nameHi: cleanText(input.nameHi), nameEn: cleanText(input.nameEn), parentId: parent?.id ?? null } });
      await audit(tx, { actorId: req.actor!.id, action: "category.create", entityType: "Category", entityId: c.id, ip: req.ip });
      return c;
    });
    res.status(201).json({ slug: created.slug });
  })
);

taxonomyRouter.post(
  "/tags",
  requireActor,
  writeLimiter,
  requirePermission("taxonomy.manage"),
  asyncHandler(async (req, res) => {
    const input = nameSchema.parse(req.body);
    if (await prisma.tag.findUnique({ where: { slug: input.slug } })) throw ApiError.conflict("Tag already exists");

    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.tag.create({ data: { slug: input.slug, nameHi: cleanText(input.nameHi), nameEn: cleanText(input.nameEn) } });
      await audit(tx, { actorId: req.actor!.id, action: "tag.create", entityType: "Tag", entityId: t.id, ip: req.ip });
      return t;
    });
    res.status(201).json({ slug: created.slug });
  })
);

const renameSchema = z
  .object({ nameHi: z.string().trim().min(1).max(80).optional(), nameEn: z.string().trim().min(1).max(80).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10_000).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** All categories incl. inactive, with story counts (admin). */
taxonomyRouter.get(
  "/categories/manage",
  requireActor,
  requirePermission("taxonomy.manage", "news.create"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }], include: { _count: { select: { news: true } } } });
    res.set("Cache-Control", "no-store");
    res.json({ items: rows.map((c) => ({ slug: c.slug, nameHi: c.nameHi, nameEn: c.nameEn, isActive: c.isActive, sortOrder: c.sortOrder, count: c._count.news })) });
  })
);

taxonomyRouter.patch(
  "/categories/:slug",
  requireActor,
  writeLimiter,
  requirePermission("taxonomy.manage"),
  asyncHandler(async (req, res) => {
    const { slug } = z.object({ slug: slugParam }).parse(req.params);
    const input = renameSchema.parse(req.body);
    const cat = await prisma.category.findUnique({ where: { slug } });
    if (!cat) throw ApiError.notFound("Category not found");
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.category.update({
        where: { id: cat.id },
        data: {
          ...(input.nameHi ? { nameHi: cleanText(input.nameHi) } : {}),
          ...(input.nameEn ? { nameEn: cleanText(input.nameEn) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      await audit(tx, { actorId: req.actor!.id, action: "category.update", entityType: "Category", entityId: c.id, meta: input, ip: req.ip });
      return c;
    });
    res.json({ slug: updated.slug, nameHi: updated.nameHi, nameEn: updated.nameEn, isActive: updated.isActive, sortOrder: updated.sortOrder });
  })
);

taxonomyRouter.patch(
  "/tags/:slug",
  requireActor,
  writeLimiter,
  requirePermission("taxonomy.manage"),
  asyncHandler(async (req, res) => {
    const { slug } = z.object({ slug: slugParam }).parse(req.params);
    const input = z.object({ nameHi: z.string().trim().min(1).max(80).optional(), nameEn: z.string().trim().min(1).max(80).optional() }).strict().parse(req.body);
    const tag = await prisma.tag.findUnique({ where: { slug } });
    if (!tag) throw ApiError.notFound("Tag not found");
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tag.update({ where: { id: tag.id }, data: { ...(input.nameHi ? { nameHi: cleanText(input.nameHi) } : {}), ...(input.nameEn ? { nameEn: cleanText(input.nameEn) } : {}) } });
      await audit(tx, { actorId: req.actor!.id, action: "tag.update", entityType: "Tag", entityId: t.id, meta: input, ip: req.ip });
      return t;
    });
    res.json({ slug: updated.slug, nameHi: updated.nameHi, nameEn: updated.nameEn });
  })
);
