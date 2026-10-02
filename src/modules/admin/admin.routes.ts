import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { noStore } from "../../middleware/httpCache";
import { requireActor, requirePermission } from "../../middleware/auth";
import { writeLimiter } from "../../middleware/rateLimits";
import { can, invalidateActor, scopeWhere } from "../../lib/access";
import { audit } from "../../lib/audit";
import { paginationQuery, toPage } from "../../lib/pagination";
import { locationPath } from "../../lib/validators";
import { resolveLocation } from "../locations/location.service";

export const adminRouter = Router();
adminRouter.use(requireActor, noStore);

adminRouter.get(
  "/roles",
  requirePermission("user.manage"),
  asyncHandler(async (_req, res) => {
    const [roles, permissions] = await Promise.all([
      prisma.role.findMany({
        orderBy: { name: "asc" },
        select: { name: true, description: true, isLocationScoped: true, permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
      }),
      prisma.permission.findMany({ orderBy: { key: "asc" }, select: { key: true, label: true } }),
    ]);
    res.json({
      items: roles.map(({ permissions: p, _count, ...r }) => ({ ...r, permissions: p.map((x) => x.permission.key).sort(), users: _count.users })),
      permissions,
    });
  })
);

/** One call for the dashboard: headline counts, work queues and an 8-week trend. Scoped roles see their own area. */
adminRouter.get(
  "/stats",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const scope = scopeWhere(actor);
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const upcoming = { OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] };

    const [
      newsPublished, newsPending, newsScheduled, directoryPublished, directoryPending, leadersPublished, leadersPending,
      eventsUpcoming, eventDrafts, registrations30d, businessesPublished, businessesPending, enquiriesNew, feedbackNew, usersTotal, usersNew30d,
    ] = await Promise.all([
      prisma.news.count({ where: { ...scope, status: "PUBLISHED" } }),
      prisma.news.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
      prisma.news.count({ where: { ...scope, status: "SCHEDULED" } }),
      prisma.directoryEntry.count({ where: { ...scope, status: "PUBLISHED" } }),
      prisma.directoryEntry.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
      prisma.leaderProfile.count({ where: { ...scope, status: "PUBLISHED" } }),
      prisma.leaderProfile.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
      prisma.event.count({ where: { AND: [scope, { status: "PUBLISHED" }, upcoming] } }),
      prisma.event.count({ where: { ...scope, status: "DRAFT" } }),
      prisma.eventRegistration.count({ where: { status: "CONFIRMED", createdAt: { gte: monthAgo }, event: scope } }),
      prisma.business.count({ where: { ...scope, status: "PUBLISHED" } }),
      prisma.business.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
      prisma.businessEnquiry.count({ where: { status: "NEW", business: scope } }),
      can(actor, "feedback.read") ? prisma.feedback.count({ where: { status: "NEW" } }) : Promise.resolve(null),
      can(actor, "user.manage") ? prisma.user.count() : Promise.resolve(null),
      can(actor, "user.manage") ? prisma.user.count({ where: { createdAt: { gte: monthAgo } } }) : Promise.resolve(null),
    ]);

    // Weekly trend. Scoped roles get content only (no site-wide signups).
    const weeks = 8;
    const since = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    const newsWeekly = await prisma.news.findMany({ where: { ...scope, status: "PUBLISHED", publishedAt: { gte: since } }, select: { publishedAt: true } });
    const signupWeekly = can(actor, "user.manage") ? await prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }) : [];
    const bucket = (d: Date) => Math.min(weeks - 1, Math.floor((d.getTime() - since.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const trend = Array.from({ length: weeks }, (_, i) => ({ weekStart: new Date(since.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString(), news: 0, signups: 0 }));
    for (const n of newsWeekly) if (n.publishedAt) trend[bucket(n.publishedAt)].news += 1;
    for (const u of signupWeekly) trend[bucket(u.createdAt)].signups += 1;

    res.json({
      content: {
        news: { published: newsPublished, pending: newsPending, scheduled: newsScheduled },
        directory: { published: directoryPublished, pending: directoryPending },
        leaders: { published: leadersPublished, pending: leadersPending },
        events: { upcoming: eventsUpcoming, drafts: eventDrafts, registrations30d },
        business: { published: businessesPublished, pending: businessesPending, newEnquiries: enquiriesNew },
      },
      inbox: { feedbackNew },
      users: usersTotal === null ? null : { total: usersTotal, new30d: usersNew30d },
      trend,
    });
  })
);

adminRouter.get(
  "/users",
  requirePermission("user.manage"),
  asyncHandler(async (req, res) => {
    const { page, limit, q, role, suspended } = paginationQuery
      .extend({
        q: z.string().trim().min(2).max(100).optional(),
        role: z.string().trim().regex(/^[A-Z_]{2,40}$/).optional(),
        suspended: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
      })
      .parse(req.query);
    const where = {
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
      ...(role ? { role: { name: role } } : {}),
      ...(suspended !== undefined ? { isSuspended: suspended } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true, email: true, isEmailVerified: true, isSuspended: true, createdAt: true, lastLoginAt: true, role: { select: { name: true } }, location: { select: { path: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    res.json(toPage(rows.map((u) => ({ ...u, role: u.role?.name ?? null, locationPath: u.location?.path ?? null, location: undefined })), total, page, limit));
  })
);

const updateUserSchema = z
  .object({
    roleName: z.string().trim().min(2).max(40).optional(),
    locationPath: locationPath.nullable().optional(),
    isSuspended: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

adminRouter.patch(
  "/users/:id",
  writeLimiter,
  requirePermission("user.manage"),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().min(10).max(40) }).parse(req.params);
    const input = updateUserSchema.parse(req.body);
    const actor = req.actor!;

    const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw ApiError.notFound("User not found");

    const actorIsSuper = actor.roleName === "SUPER_ADMIN";
    if (target.role?.name === "SUPER_ADMIN" && !actorIsSuper) throw ApiError.forbidden("Only a super admin can modify a super admin", "FORBIDDEN");
    if (input.roleName === "SUPER_ADMIN" && !actorIsSuper) throw ApiError.forbidden("Only a super admin can grant super admin", "FORBIDDEN");
    if (id === actor.id && (input.roleName !== undefined || input.isSuspended)) throw ApiError.forbidden("You cannot change your own role or suspend yourself", "FORBIDDEN");

    const role = input.roleName ? await prisma.role.findUnique({ where: { name: input.roleName } }) : null;
    if (input.roleName && !role) throw ApiError.badRequest("Unknown role", undefined, "INVALID_ROLE");

    if (target.role?.name === "SUPER_ADMIN" && (input.roleName || input.isSuspended)) {
      const supers = await prisma.user.count({ where: { role: { name: "SUPER_ADMIN" }, isSuspended: false, isActive: true } });
      if (supers <= 1) throw new ApiError(409, "At least one active super admin is required", undefined, "LAST_SUPER_ADMIN");
    }

    const locationId = input.locationPath === undefined ? undefined : input.locationPath === null ? null : (await resolveLocation(input.locationPath)).locationId;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { ...(role ? { roleId: role.id } : {}), ...(locationId !== undefined ? { locationId } : {}), ...(input.isSuspended !== undefined ? { isSuspended: input.isSuspended } : {}) },
        select: { id: true, email: true, isSuspended: true, role: { select: { name: true } } },
      });
      if (input.isSuspended) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { actorId: actor.id, action: "user.update", entityType: "User", entityId: id, meta: { ...input, previousRole: target.role?.name ?? null }, ip: req.ip });
      return u;
    });
    invalidateActor(id);
    res.json({ id: updated.id, email: updated.email, isSuspended: updated.isSuspended, role: updated.role?.name ?? null });
  })
);

adminRouter.get(
  "/audit",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const { page, limit, entityType, actorId } = paginationQuery
      .extend({ entityType: z.string().trim().max(40).optional(), actorId: z.string().trim().max(40).optional() })
      .parse(req.query);
    const where = { ...(entityType ? { entityType } : {}), ...(actorId ? { actorId } : {}) };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
    ]);
    // Audit rows keep only the actor id (users may later be renamed); resolve names for display.
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
    const byId = new Map(actors.map((a) => [a.id, { name: a.name, email: a.email }]));
    res.json(toPage(rows.map((r) => ({ ...r, actor: r.actorId ? byId.get(r.actorId) ?? null : null })), total, page, limit));
  })
);
