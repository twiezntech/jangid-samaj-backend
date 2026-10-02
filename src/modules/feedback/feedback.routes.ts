import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { noStore } from "../../middleware/httpCache";
import { optionalActor, requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { audit } from "../../lib/audit";
import { paginationQuery, toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";

const CATEGORIES = ["general", "bug", "suggestion", "content", "other"] as const;

const schema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  category: z.enum(CATEGORIES).default("general"),
  message: z.string().trim().min(10, "Message is too short").max(2000),
});

const limit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many submissions. Please try again later." } },
  skip: () => process.env.NODE_ENV === "test",
});

export const feedbackRouter = Router();

feedbackRouter.post(
  "/",
  limit,
  optionalActor,
  asyncHandler(async (req, res) => {
    const data = schema.parse(req.body);
    await prisma.feedback.create({
      data: {
        category: data.category,
        email: data.email,
        name: data.name ? cleanText(data.name) || null : null,
        message: cleanText(data.message),
        userId: req.actor?.id,
        ip: req.ip,
      },
    });
    res.status(201).json({ ok: true });
  })
);

// ---- support inbox (feedback.read) ------------------------------------------------

feedbackRouter.get(
  "/",
  requireActor,
  noStore,
  requirePermission("feedback.read"),
  asyncHandler(async (req, res) => {
    const { page, limit: take, status, category } = paginationQuery
      .extend({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional(), category: z.enum(CATEGORIES).optional() })
      .parse(req.query);
    const where = { ...(status ? { status } : {}), ...(category ? { category } : {}) };
    const [rows, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
        select: { id: true, name: true, email: true, category: true, message: true, status: true, adminNote: true, userId: true, createdAt: true, updatedAt: true },
      }),
      prisma.feedback.count({ where }),
    ]);
    res.json(toPage(rows, total, page, take));
  })
);

feedbackRouter.patch(
  "/:id",
  requireActor,
  writeLimiter,
  requirePermission("feedback.read"),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().trim().min(10).max(40) }).parse(req.params);
    const input = z
      .object({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional(), adminNote: z.string().trim().max(1000).nullable().optional() })
      .strict()
      .refine((v) => Object.keys(v).length > 0, "Nothing to update")
      .parse(req.body);
    if (!(await prisma.feedback.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.notFound("Message not found");

    const updated = await prisma.$transaction(async (tx) => {
      const f = await tx.feedback.update({
        where: { id },
        data: { ...(input.status ? { status: input.status } : {}), ...(input.adminNote !== undefined ? { adminNote: input.adminNote ? cleanText(input.adminNote) : null } : {}) },
        select: { id: true, status: true, adminNote: true },
      });
      await audit(tx, { actorId: req.actor!.id, action: "feedback.update", entityType: "Feedback", entityId: id, meta: { status: input.status }, ip: req.ip });
      return f;
    });
    res.json(updated);
  })
);
