import { Prisma } from "@prisma/client";
import type { ContentStatus, DirectoryType, Lang } from "@prisma/client";
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
import type { CreateDirectoryInput, UpdateDirectoryInput } from "./directory.schemas";

const LANGS: Lang[] = ["hi", "en"];

const publicSelect = {
  slug: true,
  stateId: true,
  type: true,
  verification: true,
  verifiedAt: true,
  coverImageUrl: true,
  pincode: true,
  latitude: true,
  longitude: true,
  phone: true,
  altPhone: true,
  email: true,
  website: true,
  socials: true,
  isContactPublic: true,
  establishedYear: true,
  updatedAt: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true, description: true, address: true } },
} satisfies Prisma.DirectoryEntrySelect;

type PublicRow = Prisma.DirectoryEntryGetPayload<{ select: typeof publicSelect }>;

/** Personal contact details never leave the API unless the owner/admin opted in. */
function toPublic(row: Omit<PublicRow, "stateId"> & { state: StateRef | null }) {
  const { isContactPublic, phone, altPhone, email, translations, ...rest } = row;
  const t: Record<string, { name: string; description: string | null; address: string | null }> = {};
  for (const x of translations) t[x.lang] = { name: x.name, description: x.description, address: x.address };
  return { ...rest, ...(isContactPublic ? { phone, altPhone, email } : {}), contactHidden: !isContactPublic, translations: t };
}

const visible: Prisma.DirectoryEntryWhereInput = { status: "PUBLISHED" };

export async function listPublic(p: { page: number; limit: number; type?: DirectoryType; location?: string; q?: string; verified?: boolean }) {
  const where: Prisma.DirectoryEntryWhereInput = {
    ...visible,
    ...(await locationWhere(p.location)),
    ...(p.type ? { type: p.type } : {}),
    ...(p.verified ? { verification: "VERIFIED" } : {}),
    ...(p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.directoryEntry.findMany({
      where,
      select: publicSelect,
      orderBy: [{ sortOrder: "asc" }, { verifiedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.directoryEntry.count({ where }),
  ]);
  return toPage((await withState(rows)).map(toPublic), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.directoryEntry.findFirst({ where: { slug, ...visible }, select: publicSelect });
  if (!row) throw ApiError.notFound("Entry not found");

  const leaders = await prisma.leaderProfile.findMany({
    where: { status: "PUBLISHED", organization: { slug } },
    select: { slug: true, category: true, photoUrl: true, verification: true, translations: { select: { lang: true, name: true, designation: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: 30,
  });
  const [self] = await withState([row]);
  return {
    ...toPublic(self),
    leaders: leaders.map((l) => ({
      ...l,
      translations: Object.fromEntries(l.translations.map((x) => [x.lang, { name: x.name, designation: x.designation }])),
    })),
  };
}

export const listSitemap = (limit = 5000) =>
  prisma.directoryEntry.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateDirectoryInput["translations"] | undefined) {
  if (!input) return [];
  return LANGS.flatMap((lang) => {
    const t = input[lang];
    if (!t) return [];
    const name = cleanText(t.name);
    if (name.length < 2) throw ApiError.badRequest("Name must contain text", undefined, "EMPTY_CONTENT");
    return [{ lang, name, description: t.description ? cleanText(t.description) : null, address: t.address ? cleanText(t.address) : null }];
  });
}

function scalarFields(input: Partial<CreateDirectoryInput>) {
  const pick = <K extends keyof CreateDirectoryInput>(k: K) => (input[k] !== undefined ? { [k]: input[k] } : {});
  return {
    ...pick("type"),
    ...pick("pincode"),
    ...pick("latitude"),
    ...pick("longitude"),
    ...pick("phone"),
    ...pick("altPhone"),
    ...pick("email"),
    ...pick("website"),
    ...pick("isContactPublic"),
    ...pick("coverImageUrl"),
    ...pick("establishedYear"),
    ...pick("sortOrder"),
    ...(input.socials !== undefined ? { socials: input.socials === null ? Prisma.DbNull : (input.socials as Prisma.InputJsonValue) } : {}),
  };
}

export async function createEntry(actor: Actor, input: CreateDirectoryInput, ip?: string) {
  const refs = await resolveLocation(input.locationPath);
  const manager = can(actor, "directory.manage");
  if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");

  const slug = await uniqueSlug(input.slug ?? input.translations.en?.name ?? "entry", async (s) => !!(await prisma.directoryEntry.findUnique({ where: { slug: s }, select: { id: true } })));
  const translations = cleanTranslations(input.translations);
  const { sortOrder, ...rest } = scalarFields(input) as Record<string, unknown> & { sortOrder?: number };

  return prisma.$transaction(async (tx) => {
    const entry = await tx.directoryEntry.create({
      data: {
        ...(rest as object),
        // only managers may pin ordering; submissions from members always start neutral
        sortOrder: manager ? sortOrder ?? 0 : 0,
        slug,
        type: input.type,
        isContactPublic: input.isContactPublic ?? input.type !== "CONTACT",
        status: manager ? "PUBLISHED" : "PENDING_REVIEW",
        verification: "UNVERIFIED",
        locationId: refs.locationId,
        stateId: refs.stateId,
        districtId: refs.districtId,
        cityId: refs.cityId,
        submittedById: actor.id,
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "directory.create", entityType: "DirectoryEntry", entityId: entry.id, ip });
    return entry;
  });
}

export async function updateEntry(actor: Actor, id: string, input: UpdateDirectoryInput, ip?: string) {
  const entry = await prisma.directoryEntry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound("Entry not found");

  const manager = can(actor, "directory.manage") && inScope(actor, entry);
  const owner = entry.submittedById === actor.id && AUTHOR_EDITABLE.includes(entry.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this entry", "FORBIDDEN");
  if (!manager && (input.sortOrder !== undefined)) throw ApiError.forbidden("Only managers can set ordering", "FORBIDDEN");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (!inScope(actor, refs) && !owner) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId };
  }
  const translations = cleanTranslations(input.translations as CreateDirectoryInput["translations"] | undefined);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.directoryTranslation.upsert({ where: { entryId_lang: { entryId: id, lang } }, create: { entryId: id, lang, ...data }, update: data });
    }
    const updated = await tx.directoryEntry.update({
      where: { id },
      data: { ...(scalarFields(input as Partial<CreateDirectoryInput>) as object), ...loc },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "directory.update", entityType: "DirectoryEntry", entityId: id, ip });
    return updated;
  });
}

export type DirectoryAction = Exclude<WorkflowAction, "schedule" | "unpublish">;

export async function transitionEntry(actor: Actor, id: string, action: DirectoryAction, reason?: string, ip?: string) {
  const entry = await prisma.directoryEntry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound("Entry not found");

  const manager = can(actor, "directory.manage") && inScope(actor, entry);
  const owner = entry.submittedById === actor.id;
  const withdraw = owner && action === "archive" && ["PENDING_REVIEW", "REJECTED", "DRAFT"].includes(entry.status);
  if (!(manager || withdraw || (owner && action === "submit"))) throw ApiError.forbidden("You cannot perform this action", "FORBIDDEN");
  if (action === "reject" && !reason) throw ApiError.badRequest("A rejection reason is required");

  const to: ContentStatus = nextStatus(entry.status, action);
  const now = new Date();
  const data: Prisma.DirectoryEntryUpdateInput = { status: to };
  if (action === "publish") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: null });
  if (action === "reject") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: reason });
  if (action === "archive" || action === "restore") Object.assign(data, { verification: "UNVERIFIED", verifiedAt: null });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.directoryEntry.update({ where: { id }, data, select: { id: true, slug: true, status: true, verification: true } });
    await audit(tx, { actorId: actor.id, action: `directory.${action}`, entityType: "DirectoryEntry", entityId: id, meta: { from: entry.status, to }, ip });
    return updated;
  });
}

/** Verified badge: a separate, deliberate step on top of publication. */
export async function setVerification(actor: Actor, id: string, verified: boolean, ip?: string) {
  const entry = await prisma.directoryEntry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound("Entry not found");
  if (!(can(actor, "directory.manage") && inScope(actor, entry))) throw ApiError.forbidden("You cannot verify this entry", "FORBIDDEN");
  if (verified && entry.status !== "PUBLISHED") throw new ApiError(409, "Only published entries can be verified", undefined, "INVALID_TRANSITION");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.directoryEntry.update({
      where: { id },
      data: verified ? { verification: "VERIFIED", verifiedAt: new Date(), reviewedById: actor.id } : { verification: "UNVERIFIED", verifiedAt: null },
      select: { id: true, slug: true, verification: true },
    });
    await audit(tx, { actorId: actor.id, action: verified ? "directory.verify" : "directory.unverify", entityType: "DirectoryEntry", entityId: id, ip });
    return updated;
  });
}

const manageSelect = {
  id: true,
  slug: true,
  type: true,
  status: true,
  verification: true,
  rejectionReason: true,
  updatedAt: true,
  submittedBy: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true } },
} satisfies Prisma.DirectoryEntrySelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; type?: DirectoryType; q?: string; mine?: boolean }) {
  const manager = can(actor, "directory.manage");
  const scope: Prisma.DirectoryEntryWhereInput =
    manager && !p.mine
      ? actor.isLocationScoped
        ? actor.locationId
          ? { OR: [{ locationId: actor.locationId }, { stateId: actor.locationId }, { districtId: actor.locationId }, { cityId: actor.locationId }] }
          : { id: "__none__" }
        : {}
      : { submittedById: actor.id };
  const where: Prisma.DirectoryEntryWhereInput = {
    AND: [
      scope,
      p.status ? { status: p.status } : {},
      p.type ? { type: p.type } : {},
      p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.directoryEntry.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.directoryEntry.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ ...r, translations: Object.fromEntries(r.translations.map((t) => [t.lang, { name: t.name }])) })),
    total,
    p.page,
    p.limit
  );
}

/** Full record for the edit form. Owners see their own submissions; managers anything in scope. */
export async function getForManage(actor: Actor, id: string) {
  const entry = await prisma.directoryEntry.findUnique({ where: { id }, include: { translations: true, location: { select: { path: true } } } });
  const allowed = entry && (entry.submittedById === actor.id || (can(actor, "directory.manage") && inScope(actor, entry)));
  if (!entry || !allowed) throw ApiError.notFound("Entry not found"); // do not reveal existence
  return { ...entry, translations: byLang(entry.translations) };
}
