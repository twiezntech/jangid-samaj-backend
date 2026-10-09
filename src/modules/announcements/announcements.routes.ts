import { Router } from "express";
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
import { locationPath } from "../../lib/validators";
import { findLocation } from "../locations/location.service";

export const SEGMENTS = ["EVERYONE", "BUSINESS_OWNERS", "MATRIMONY_MEMBERS", "EVENT_ATTENDEES"] as const;
const BATCH = 1000;

const createSchema = z
  .object({
    titleHi: z.string().trim().min(3).max(160),
    titleEn: z.string().trim().min(3).max(160),
    bodyHi: z.string().trim().max(1000).optional(),
    bodyEn: z.string().trim().max(1000).optional(),
    /** Site-relative link only, so a broadcast can never send members off-site. */
    link: z.string().trim().regex(/^\/[a-z0-9/_?=&-]*$/i, "Use a link on this website, e.g. /events/slug").max(200).optional(),
    /** Only members whose home location is this place (or inside it). Omit for everyone. */
    locationPath: locationPath.optional(),
    /// Which kind of member receives it; combined with the area filter.
    segment: z.enum(SEGMENTS).default("EVERYONE"),
  })
  .strict();

export const announcementsRouter = Router();
announcementsRouter.use(requireActor, requirePermission("notification.send"), noStore);

/** Members who would receive an announcement for this area (preview before sending). */
const SEGMENT_WHERE: Record<(typeof SEGMENTS)[number], Prisma.UserWhereInput> = {
  EVERYONE: {},
  BUSINESS_OWNERS: { businesses: { some: { status: "PUBLISHED" } } },
  MATRIMONY_MEMBERS: { matrimonyProfile: { is: { status: "PUBLISHED" } } },
  EVENT_ATTENDEES: { eventRegistrations: { some: {} } },
};

async function audience(path: string | undefined, segment: (typeof SEGMENTS)[number] = "EVERYONE"): Promise<Prisma.UserWhereInput> {
  const base: Prisma.UserWhereInput = { isActive: true, isSuspended: false, isEmailVerified: true, ...SEGMENT_WHERE[segment] };
  if (!path) return base;
  if (!(await findLocation(path))) throw ApiError.badRequest("Unknown location", undefined, "INVALID_LOCATION");
  return { ...base, location: { OR: [{ path }, { path: { startsWith: `${path}/` } }] } };
}

announcementsRouter.get(
  "/audience",
  asyncHandler(async (req, res) => {
    const path = z.object({ locationPath: locationPath.optional(), segment: z.enum(SEGMENTS).default("EVERYONE") }).parse(req.query);
    res.json({ recipients: await prisma.user.count({ where: await audience(path.locationPath, path.segment) }) });
  })
);

announcementsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const p = paginationQuery.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.announcement.findMany({
        select: { id: true, segment: true, titleHi: true, titleEn: true, bodyHi: true, bodyEn: true, link: true, recipients: true, createdAt: true, location: { select: { path: true, nameHi: true, nameEn: true } }, sentBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (p.page - 1) * p.limit,
        take: p.limit,
      }),
      prisma.announcement.count(),
    ]);
    res.json(toPage(items, total, p.page, p.limit));
  })
);

/** Writes one inbox row per recipient, in batches, then records the broadcast. */
announcementsRouter.post(
  "/",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const where = await audience(input.locationPath, input.segment);
    const loc = input.locationPath ? await findLocation(input.locationPath) : null;
    const copy = {
      titleHi: cleanText(input.titleHi),
      titleEn: cleanText(input.titleEn),
      bodyHi: input.bodyHi ? cleanText(input.bodyHi) || null : null,
      bodyEn: input.bodyEn ? cleanText(input.bodyEn) || null : null,
      link: input.link ?? null,
    };

    let recipients = 0;
    let cursor: string | undefined;
    for (;;) {
      const users = await prisma.user.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      if (!users.length) break;
      await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: "ANNOUNCEMENT" as const, ...copy })) });
      recipients += users.length;
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) break;
    }

    const a = await prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({ data: { ...copy, segment: input.segment, locationId: loc?.id ?? null, recipients, sentById: req.actor!.id }, select: { id: true, recipients: true, createdAt: true } });
      await audit(tx, { actorId: req.actor!.id, action: "announcement.send", entityType: "Announcement", entityId: created.id, meta: { recipients, location: input.locationPath ?? null }, ip: req.ip });
      return created;
    });
    res.status(201).json(a);
  })
);
