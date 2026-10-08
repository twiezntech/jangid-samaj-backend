import type { AchievementCategory, ContentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope } from "../../lib/access";
import { audit } from "../../lib/audit";
import { notifyReview } from "../../lib/notify";
import { byLang, translationRows } from "../../lib/i18n";
import { ModerationAction, authorizeTransition, initialStatus, manageScope, reviewFields } from "../../lib/moderation";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState, type StateRef } from "../locations/location.service";
import type { CreateAchievementInput, UpdateAchievementInput } from "./achievements.schemas";

const MANAGE = "achievement.manage";
const MANAGER_ONLY = ["sortOrder", "isFeatured"] as const;

const publicSelect = {
  slug: true,
  category: true,
  photoUrl: true,
  achievedOn: true,
  isFeatured: true,
  stateId: true,
  updatedAt: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, personName: true, title: true, description: true } },
} satisfies Prisma.AchievementSelect;

type PublicRow = Prisma.AchievementGetPayload<{ select: typeof publicSelect }>;

const toPublic = ({ translations, ...row }: Omit<PublicRow, "stateId"> & { state: StateRef | null }) => ({ ...row, translations: byLang(translations) });

const visible: Prisma.AchievementWhereInput = { status: "PUBLISHED" };

export async function listPublic(p: { page: number; limit: number; category?: AchievementCategory; location?: string; q?: string; featured?: boolean }) {
  const where: Prisma.AchievementWhereInput = {
    ...visible,
    ...(await locationWhere(p.location)),
    ...(p.category ? { category: p.category } : {}),
    ...(p.featured !== undefined ? { isFeatured: p.featured } : {}),
    ...(p.q ? { translations: { some: { OR: [{ personName: { contains: p.q, mode: "insensitive" } }, { title: { contains: p.q, mode: "insensitive" } }] } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.achievement.findMany({
      where,
      select: publicSelect,
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { achievedOn: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.achievement.count({ where }),
  ]);
  return toPage((await withState(rows)).map(toPublic), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.achievement.findFirst({ where: { slug, ...visible }, select: publicSelect });
  if (!row) throw ApiError.notFound("Achievement not found");
  return toPublic((await withState([row]))[0]);
}

export const listSitemap = (limit = 5000) =>
  prisma.achievement.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateAchievementInput["translations"] | undefined) {
  return translationRows(input, (t) => {
    const personName = cleanText(t.personName);
    const title = cleanText(t.title);
    if (personName.length < 2 || title.length < 3) throw ApiError.badRequest("Name and title must contain text", undefined, "EMPTY_CONTENT");
    return { personName, title, description: t.description ? cleanText(t.description) : null };
  });
}

function scalarFields(input: Partial<CreateAchievementInput>) {
  return {
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
    ...(input.achievedOn !== undefined ? { achievedOn: input.achievedOn } : {}),
  };
}

const denormalised = (r: Awaited<ReturnType<typeof resolveLocation>>) => ({ locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId });

export async function createAchievement(actor: Actor, input: CreateAchievementInput, ip?: string) {
  const refs = await resolveLocation(input.locationPath);
  const status = initialStatus(actor, MANAGE, refs);
  const manager = can(actor, MANAGE);
  if (!manager && MANAGER_ONLY.some((k) => input[k] !== undefined)) throw ApiError.forbidden("Only managers can feature or order achievements", "FORBIDDEN");

  const translations = cleanTranslations(input.translations);
  const base = input.slug ?? input.translations.en?.title ?? input.translations.en?.personName ?? "achievement";
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.achievement.findUnique({ where: { slug: s }, select: { id: true } })));

  return prisma.$transaction(async (tx) => {
    const created = await tx.achievement.create({
      data: {
        ...scalarFields(input),
        category: input.category,
        slug,
        status,
        isFeatured: manager ? input.isFeatured ?? false : false,
        sortOrder: manager ? input.sortOrder ?? 0 : 0,
        ...denormalised(refs),
        createdById: actor.id,
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "achievement.create", entityType: "Achievement", entityId: created.id, ip });
    return created;
  });
}

export async function updateAchievement(actor: Actor, id: string, input: UpdateAchievementInput, ip?: string) {
  const current = await prisma.achievement.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Achievement not found");

  const manager = can(actor, MANAGE) && inScope(actor, current);
  const owner = current.createdById === actor.id && AUTHOR_EDITABLE.includes(current.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this achievement", "FORBIDDEN");
  if (!manager && MANAGER_ONLY.some((k) => input[k] !== undefined)) throw ApiError.forbidden("Only managers can feature or order achievements", "FORBIDDEN");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = denormalised(refs);
  }
  const translations = cleanTranslations(input.translations as CreateAchievementInput["translations"] | undefined);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.achievementTranslation.upsert({ where: { achievementId_lang: { achievementId: id, lang } }, create: { achievementId: id, lang, ...data }, update: data });
    }
    const updated = await tx.achievement.update({
      where: { id },
      data: {
        ...scalarFields(input as Partial<CreateAchievementInput>),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured && current.status === "PUBLISHED" } : {}),
        ...loc,
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "achievement.update", entityType: "Achievement", entityId: id, ip });
    return updated;
  });
}

export async function transitionAchievement(actor: Actor, id: string, action: ModerationAction, reason?: string, ip?: string) {
  const current = await prisma.achievement.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Achievement not found");

  const to: ContentStatus = authorizeTransition(actor, MANAGE, current, action, reason);
  const data: Prisma.AchievementUpdateInput = {
    status: to,
    ...reviewFields(actor, action, reason),
    ...(to !== "PUBLISHED" ? { isFeatured: false } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.achievement.update({ where: { id }, data, select: { id: true, slug: true, status: true, isFeatured: true } });
    await audit(tx, { actorId: actor.id, action: `achievement.${action}`, entityType: "Achievement", entityId: id, meta: { from: current.status, to }, ip });
    await notifyReview(tx, { userId: current.createdById, actorId: actor.id, kind: "achievement", action, reason, link: `/achievements/${updated.slug}` });
    return updated;
  });
}

export async function setFeatured(actor: Actor, id: string, featured: boolean, ip?: string) {
  const current = await prisma.achievement.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Achievement not found");
  if (!(can(actor, MANAGE) && inScope(actor, current))) throw ApiError.forbidden("You cannot feature this achievement", "FORBIDDEN");
  if (featured && current.status !== "PUBLISHED") throw new ApiError(409, "Only published achievements can be featured", undefined, "INVALID_TRANSITION");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.achievement.update({ where: { id }, data: { isFeatured: featured }, select: { id: true, slug: true, isFeatured: true } });
    await audit(tx, { actorId: actor.id, action: featured ? "achievement.feature" : "achievement.unfeature", entityType: "Achievement", entityId: id, ip });
    return updated;
  });
}

/** Permanent removal for mistakes (e.g. approved by accident). Gated by `achievement.delete`; the audit row keeps a snapshot. */
export async function deleteAchievement(actor: Actor, id: string, ip?: string) {
  const current = await prisma.achievement.findUnique({ where: { id }, include: { translations: { select: { lang: true, title: true } } } });
  if (!current) throw ApiError.notFound("Achievement not found");
  if (!can(actor, "achievement.delete")) throw ApiError.forbidden("You cannot delete achievements", "FORBIDDEN");

  await prisma.$transaction(async (tx) => {
    await tx.achievement.delete({ where: { id } });
    await audit(tx, {
      actorId: actor.id,
      action: "achievement.delete",
      entityType: "Achievement",
      entityId: id,
      meta: { slug: current.slug, status: current.status, titles: Object.fromEntries(current.translations.map((t) => [t.lang, t.title])) },
      ip,
    });
  });
  return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Admin / member views
// ---------------------------------------------------------------------------

const manageSelect = {
  id: true,
  slug: true,
  category: true,
  status: true,
  isFeatured: true,
  photoUrl: true,
  achievedOn: true,
  rejectionReason: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, personName: true, title: true } },
} satisfies Prisma.AchievementSelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; category?: AchievementCategory; q?: string; mine?: boolean }) {
  const where: Prisma.AchievementWhereInput = {
    AND: [
      manageScope(actor, MANAGE, p.mine),
      p.status ? { status: p.status } : {},
      p.category ? { category: p.category } : {},
      p.q ? { translations: { some: { OR: [{ personName: { contains: p.q, mode: "insensitive" } }, { title: { contains: p.q, mode: "insensitive" } }] } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.achievement.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.achievement.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ ...r, translations: byLang(r.translations) })), total, p.page, p.limit);
}

/** Full record for the edit form. Creators see their own submissions; managers anything in scope. */
export async function getForManage(actor: Actor, id: string) {
  const row = await prisma.achievement.findUnique({ where: { id }, include: { translations: true, location: { select: { path: true } } } });
  const allowed = row && (row.createdById === actor.id || (can(actor, MANAGE) && inScope(actor, row)));
  if (!row || !allowed) throw ApiError.notFound("Achievement not found");
  return { ...row, translations: byLang(row.translations) };
}
