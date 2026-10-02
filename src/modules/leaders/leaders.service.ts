import { Prisma } from "@prisma/client";
import type { ContentStatus, LeaderCategory, Lang } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope } from "../../lib/access";
import { audit } from "../../lib/audit";
import { byLang } from "../../lib/i18n";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE, WorkflowAction, nextStatus } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState, type StateRef } from "../locations/location.service";
import type { CreateLeaderInput, UpdateLeaderInput } from "./leaders.schemas";

const LANGS: Lang[] = ["hi", "en"];

const publicSelect = {
  slug: true,
  stateId: true,
  category: true,
  verification: true,
  verifiedAt: true,
  photoUrl: true,
  termStart: true,
  termEnd: true,
  phone: true,
  email: true,
  socials: true,
  isContactPublic: true,
  updatedAt: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  organization: { select: { slug: true, translations: { select: { lang: true, name: true } } } },
  translations: { select: { lang: true, name: true, designation: true, bio: true } },
} satisfies Prisma.LeaderProfileSelect;

type PublicRow = Prisma.LeaderProfileGetPayload<{ select: typeof publicSelect }>;

function toPublic(row: Omit<PublicRow, "stateId"> & { state: StateRef | null }) {
  const { isContactPublic, phone, email, translations, organization, termEnd, ...rest } = row;
  const today = new Date();
  return {
    ...rest,
    termEnd,
    isCurrent: !termEnd || termEnd >= today,
    ...(isContactPublic ? { phone, email } : {}),
    contactHidden: !isContactPublic,
    organization: organization
      ? { slug: organization.slug, translations: Object.fromEntries(organization.translations.map((t) => [t.lang, { name: t.name }])) }
      : null,
    translations: Object.fromEntries(translations.map((t) => [t.lang, { name: t.name, designation: t.designation, bio: t.bio }])),
  };
}

const visible: Prisma.LeaderProfileWhereInput = { status: "PUBLISHED" };

export async function listPublic(p: { page: number; limit: number; category?: LeaderCategory; location?: string; q?: string; verified?: boolean }) {
  const where: Prisma.LeaderProfileWhereInput = {
    ...visible,
    ...(await locationWhere(p.location)),
    ...(p.category ? { category: p.category } : {}),
    ...(p.verified ? { verification: "VERIFIED" } : {}),
    ...(p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.leaderProfile.findMany({
      where,
      select: publicSelect,
      orderBy: [{ sortOrder: "asc" }, { verifiedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.leaderProfile.count({ where }),
  ]);
  return toPage((await withState(rows)).map(toPublic), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.leaderProfile.findFirst({ where: { slug, ...visible }, select: publicSelect });
  if (!row) throw ApiError.notFound("Profile not found");
  return toPublic((await withState([row]))[0]);
}

export const listSitemap = (limit = 5000) =>
  prisma.leaderProfile.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateLeaderInput["translations"] | undefined) {
  if (!input) return [];
  return LANGS.flatMap((lang) => {
    const t = input[lang];
    if (!t) return [];
    const name = cleanText(t.name);
    if (name.length < 2) throw ApiError.badRequest("Name must contain text", undefined, "EMPTY_CONTENT");
    return [{ lang, name, designation: t.designation ? cleanText(t.designation) : null, bio: t.bio ? cleanText(t.bio) : null }];
  });
}

async function organizationId(slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (slug === null) return null;
  const org = await prisma.directoryEntry.findFirst({ where: { slug, status: "PUBLISHED" }, select: { id: true } });
  if (!org) throw ApiError.badRequest("Unknown organization", undefined, "INVALID_ORGANIZATION");
  return org.id;
}

function scalarFields(input: Partial<CreateLeaderInput>) {
  return {
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
    ...(input.termStart !== undefined ? { termStart: input.termStart } : {}),
    ...(input.termEnd !== undefined ? { termEnd: input.termEnd } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.isContactPublic !== undefined ? { isContactPublic: input.isContactPublic } : {}),
    ...(input.socials !== undefined ? { socials: input.socials === null ? Prisma.DbNull : (input.socials as Prisma.InputJsonValue) } : {}),
  };
}

export async function createLeader(actor: Actor, input: CreateLeaderInput, ip?: string) {
  const refs = await resolveLocation(input.locationPath);
  const manager = can(actor, "leader.manage");
  if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");

  const slug = await uniqueSlug(input.slug ?? input.translations.en?.name ?? "leader", async (s) => !!(await prisma.leaderProfile.findUnique({ where: { slug: s }, select: { id: true } })));
  const orgId = await organizationId(input.organizationSlug);
  const translations = cleanTranslations(input.translations);

  return prisma.$transaction(async (tx) => {
    const leader = await tx.leaderProfile.create({
      data: {
        ...scalarFields(input),
        category: input.category,
        slug,
        status: manager ? "PUBLISHED" : "PENDING_REVIEW",
        verification: "UNVERIFIED",
        sortOrder: manager ? input.sortOrder ?? 0 : 0,
        organizationId: orgId ?? null,
        locationId: refs.locationId,
        stateId: refs.stateId,
        districtId: refs.districtId,
        cityId: refs.cityId,
        createdById: actor.id,
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "leader.create", entityType: "LeaderProfile", entityId: leader.id, ip });
    return leader;
  });
}

export async function updateLeader(actor: Actor, id: string, input: UpdateLeaderInput, ip?: string) {
  const leader = await prisma.leaderProfile.findUnique({ where: { id } });
  if (!leader) throw ApiError.notFound("Profile not found");

  const manager = can(actor, "leader.manage") && inScope(actor, leader);
  const owner = leader.createdById === actor.id && AUTHOR_EDITABLE.includes(leader.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this profile", "FORBIDDEN");
  if (!manager && input.sortOrder !== undefined) throw ApiError.forbidden("Only managers can set ordering", "FORBIDDEN");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId };
  }
  const orgId = await organizationId(input.organizationSlug);
  const translations = cleanTranslations(input.translations as CreateLeaderInput["translations"] | undefined);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.leaderTranslation.upsert({ where: { leaderId_lang: { leaderId: id, lang } }, create: { leaderId: id, lang, ...data }, update: data });
    }
    const updated = await tx.leaderProfile.update({
      where: { id },
      data: {
        ...scalarFields(input as Partial<CreateLeaderInput>),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(orgId !== undefined ? { organizationId: orgId } : {}),
        ...loc,
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "leader.update", entityType: "LeaderProfile", entityId: id, ip });
    return updated;
  });
}

export type LeaderAction = Exclude<WorkflowAction, "schedule" | "unpublish">;

export async function transitionLeader(actor: Actor, id: string, action: LeaderAction, reason?: string, ip?: string) {
  const leader = await prisma.leaderProfile.findUnique({ where: { id } });
  if (!leader) throw ApiError.notFound("Profile not found");

  const manager = can(actor, "leader.manage") && inScope(actor, leader);
  const owner = leader.createdById === actor.id;
  const withdraw = owner && action === "archive" && ["PENDING_REVIEW", "REJECTED", "DRAFT"].includes(leader.status);
  if (!(manager || withdraw || (owner && action === "submit"))) throw ApiError.forbidden("You cannot perform this action", "FORBIDDEN");
  if (action === "reject" && !reason) throw ApiError.badRequest("A rejection reason is required");

  const to: ContentStatus = nextStatus(leader.status, action);
  const now = new Date();
  const data: Prisma.LeaderProfileUpdateInput = { status: to };
  if (action === "publish") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: null });
  if (action === "reject") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: reason });
  if (action === "archive" || action === "restore") Object.assign(data, { verification: "UNVERIFIED", verifiedAt: null, verifiedById: null });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.leaderProfile.update({ where: { id }, data, select: { id: true, slug: true, status: true, verification: true } });
    await audit(tx, { actorId: actor.id, action: `leader.${action}`, entityType: "LeaderProfile", entityId: id, meta: { from: leader.status, to }, ip });
    return updated;
  });
}

export async function setVerification(actor: Actor, id: string, verified: boolean, ip?: string) {
  const leader = await prisma.leaderProfile.findUnique({ where: { id } });
  if (!leader) throw ApiError.notFound("Profile not found");
  if (!(can(actor, "leader.manage") && inScope(actor, leader))) throw ApiError.forbidden("You cannot verify this profile", "FORBIDDEN");
  if (verified && leader.status !== "PUBLISHED") throw new ApiError(409, "Only published profiles can be verified", undefined, "INVALID_TRANSITION");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.leaderProfile.update({
      where: { id },
      data: verified ? { verification: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.id } : { verification: "UNVERIFIED", verifiedAt: null, verifiedById: null },
      select: { id: true, slug: true, verification: true },
    });
    await audit(tx, { actorId: actor.id, action: verified ? "leader.verify" : "leader.unverify", entityType: "LeaderProfile", entityId: id, ip });
    return updated;
  });
}

const manageSelect = {
  id: true,
  slug: true,
  category: true,
  status: true,
  verification: true,
  rejectionReason: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true, designation: true } },
} satisfies Prisma.LeaderProfileSelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; category?: LeaderCategory; q?: string; mine?: boolean }) {
  const manager = can(actor, "leader.manage");
  const scope: Prisma.LeaderProfileWhereInput =
    manager && !p.mine
      ? actor.isLocationScoped
        ? actor.locationId
          ? { OR: [{ locationId: actor.locationId }, { stateId: actor.locationId }, { districtId: actor.locationId }, { cityId: actor.locationId }] }
          : { id: "__none__" }
        : {}
      : { createdById: actor.id };
  const where: Prisma.LeaderProfileWhereInput = {
    AND: [
      scope,
      p.status ? { status: p.status } : {},
      p.category ? { category: p.category } : {},
      p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.leaderProfile.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.leaderProfile.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ ...r, translations: byLang(r.translations) })),
    total,
    p.page,
    p.limit
  );
}

/** Full record for the edit form. Creators see their own submissions; managers anything in scope. */
export async function getForManage(actor: Actor, id: string) {
  const leader = await prisma.leaderProfile.findUnique({
    where: { id },
    include: { translations: true, location: { select: { path: true } }, organization: { select: { slug: true } } },
  });
  const allowed = leader && (leader.createdById === actor.id || (can(actor, "leader.manage") && inScope(actor, leader)));
  if (!leader || !allowed) throw ApiError.notFound("Leader not found");
  return { ...leader, translations: byLang(leader.translations) };
}
