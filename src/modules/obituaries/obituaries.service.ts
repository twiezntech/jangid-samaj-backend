import type { ContentStatus, Prisma, TributeStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope, scopeWhere } from "../../lib/access";
import { audit } from "../../lib/audit";
import { notify, notifyReview } from "../../lib/notify";
import { byLang, translationRows } from "../../lib/i18n";
import { ModerationAction, authorizeTransition, initialStatus, manageScope, reviewFields } from "../../lib/moderation";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState, type StateRef } from "../locations/location.service";
import type { CreateObituaryInput, TributeInput, UpdateObituaryInput } from "./obituaries.schemas";

const MANAGE = "obituary.manage";

const opt = (s: string | null | undefined) => {
  if (s === undefined) return undefined;
  const v = s === null ? "" : cleanText(s);
  return v.length ? v : null;
};

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

const ceremonySelect = { type: true, startsAt: true, venue: true, address: true, note: true } satisfies Prisma.ObituaryCeremonySelect;

const cardSelect = {
  slug: true,
  gender: true,
  photoUrl: true,
  dateOfBirth: true,
  dateOfDeath: true,
  ageYears: true,
  stateId: true,
  updatedAt: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true, relationLine: true, nativePlace: true } },
} satisfies Prisma.ObituarySelect;

const detailSelect = {
  ...cardSelect,
  id: true,
  isContactPublic: true,
  contactName: true,
  contactRelation: true,
  contactPhone: true,
  gotra: { select: { nameEn: true, nameHi: true } },
  translations: { select: { lang: true, name: true, relationLine: true, nativePlace: true, biography: true, familyMessage: true } },
  ceremonies: { select: ceremonySelect, orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] },
  _count: { select: { tributes: { where: { status: "PUBLISHED" } } } },
} satisfies Prisma.ObituarySelect;

const visible: Prisma.ObituaryWhereInput = { status: "PUBLISHED" };

type WithState<T> = Omit<T, "stateId"> & { state: StateRef | null };

export async function listPublic(p: { page: number; limit: number; location?: string; q?: string }) {
  const now = new Date();
  const where: Prisma.ObituaryWhereInput = {
    ...visible,
    ...(await locationWhere(p.location)),
    ...(p.q ? { translations: { some: { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { nativePlace: { contains: p.q, mode: "insensitive" } }] } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.obituary.findMany({
      where,
      select: {
        ...cardSelect,
        // The next rite still to come (uthavna, shok sabha...) is what readers look for on the list.
        ceremonies: { where: { startsAt: { gte: now } }, select: ceremonySelect, orderBy: { startsAt: "asc" }, take: 1 },
        _count: { select: { tributes: { where: { status: "PUBLISHED" } } } },
      },
      orderBy: [{ dateOfDeath: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.obituary.count({ where }),
  ]);
  const items = (await withState(rows)).map(({ translations, ceremonies, _count, ...row }: WithState<(typeof rows)[number]>) => ({
    ...row,
    translations: byLang(translations),
    nextCeremony: ceremonies[0] ?? null,
    tributeCount: _count.tributes,
  }));
  return toPage(items, total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.obituary.findFirst({ where: { slug, ...visible }, select: detailSelect });
  if (!row) throw ApiError.notFound("Obituary not found");
  const [{ translations, _count, isContactPublic, contactName, contactRelation, contactPhone, ...rest }] = await withState([row]);
  return {
    ...rest,
    translations: byLang(translations),
    tributeCount: _count.tributes,
    // The family decides whether their phone number is shown; nothing leaks otherwise.
    contact: isContactPublic && contactPhone ? { name: contactName, relation: contactRelation, phone: contactPhone } : null,
  };
}

export const listSitemap = (limit = 5000) =>
  prisma.obituary.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateObituaryInput["translations"] | undefined) {
  return translationRows(input, (t) => {
    const name = cleanText(t.name);
    if (name.length < 2) throw ApiError.badRequest("Name must contain text", undefined, "EMPTY_CONTENT");
    return {
      name,
      relationLine: opt(t.relationLine) ?? null,
      nativePlace: opt(t.nativePlace) ?? null,
      biography: opt(t.biography) ?? null,
      familyMessage: opt(t.familyMessage) ?? null,
    };
  });
}

function cleanCeremonies(list: CreateObituaryInput["ceremonies"]) {
  return (list ?? []).map((c, i) => {
    const venue = cleanText(c.venue);
    if (venue.length < 2) throw ApiError.badRequest("Ceremony venue must contain text", undefined, "EMPTY_CONTENT");
    return { type: c.type, startsAt: c.startsAt, venue, address: opt(c.address) ?? null, note: opt(c.note) ?? null, sortOrder: i };
  });
}

async function checkGotra(gotraId: string | null | undefined) {
  if (!gotraId) return;
  const g = await prisma.gotra.findUnique({ where: { id: gotraId }, select: { isActive: true } });
  if (!g?.isActive) throw ApiError.badRequest("Unknown gotra", undefined, "INVALID_GOTRA");
}

function checkDates(dob: Date | null | undefined, dod: Date) {
  if (dob && dob > dod) throw ApiError.badRequest("Date of birth must be before the date of death", undefined, "INVALID_DATES");
}

function scalarFields(input: Partial<CreateObituaryInput>) {
  return {
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
    ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
    ...(input.dateOfDeath !== undefined ? { dateOfDeath: input.dateOfDeath } : {}),
    ...(input.ageYears !== undefined ? { ageYears: input.ageYears } : {}),
    ...(input.gotraId !== undefined ? { gotraId: input.gotraId } : {}),
    ...(input.contactName !== undefined ? { contactName: opt(input.contactName) } : {}),
    ...(input.contactRelation !== undefined ? { contactRelation: opt(input.contactRelation) } : {}),
    ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
    ...(input.isContactPublic !== undefined ? { isContactPublic: input.isContactPublic } : {}),
  };
}

const denormalised = (r: Awaited<ReturnType<typeof resolveLocation>>) => ({ locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId });

export async function createObituary(actor: Actor, input: CreateObituaryInput, ip?: string) {
  checkDates(input.dateOfBirth, input.dateOfDeath);
  await checkGotra(input.gotraId);
  const refs = await resolveLocation(input.locationPath);
  const status = initialStatus(actor, MANAGE, refs);

  const translations = cleanTranslations(input.translations);
  const ceremonies = cleanCeremonies(input.ceremonies);
  const base = input.slug ?? input.translations.en?.name ?? input.translations.hi?.name ?? "shraddhanjali";
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.obituary.findUnique({ where: { slug: s }, select: { id: true } })));

  return prisma.$transaction(async (tx) => {
    const created = await tx.obituary.create({
      data: {
        ...scalarFields(input),
        dateOfDeath: input.dateOfDeath,
        slug,
        status,
        ...denormalised(refs),
        createdById: actor.id,
        translations: { create: translations },
        ceremonies: { create: ceremonies },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "obituary.create", entityType: "Obituary", entityId: created.id, ip });
    return created;
  });
}

export async function updateObituary(actor: Actor, id: string, input: UpdateObituaryInput, ip?: string) {
  const current = await prisma.obituary.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Obituary not found");

  const manager = can(actor, MANAGE) && inScope(actor, current);
  const owner = current.createdById === actor.id && AUTHOR_EDITABLE.includes(current.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this notice", "FORBIDDEN");

  checkDates(input.dateOfBirth !== undefined ? input.dateOfBirth : current.dateOfBirth, input.dateOfDeath ?? current.dateOfDeath);
  await checkGotra(input.gotraId);

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = denormalised(refs);
  }
  const translations = cleanTranslations(input.translations as CreateObituaryInput["translations"] | undefined);
  const ceremonies = input.ceremonies ? cleanCeremonies(input.ceremonies) : null;

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.obituaryTranslation.upsert({ where: { obituaryId_lang: { obituaryId: id, lang } }, create: { obituaryId: id, lang, ...data }, update: data });
    }
    if (ceremonies) {
      await tx.obituaryCeremony.deleteMany({ where: { obituaryId: id } });
      if (ceremonies.length) await tx.obituaryCeremony.createMany({ data: ceremonies.map((c) => ({ ...c, obituaryId: id })) });
    }
    const updated = await tx.obituary.update({
      where: { id },
      data: { ...scalarFields(input as Partial<CreateObituaryInput>), ...loc },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "obituary.update", entityType: "Obituary", entityId: id, ip });
    return updated;
  });
}

export async function transitionObituary(actor: Actor, id: string, action: ModerationAction, reason?: string, ip?: string) {
  const current = await prisma.obituary.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Obituary not found");

  const to: ContentStatus = authorizeTransition(actor, MANAGE, current, action, reason);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.obituary.update({ where: { id }, data: { status: to, ...reviewFields(actor, action, reason) }, select: { id: true, slug: true, status: true } });
    await audit(tx, { actorId: actor.id, action: `obituary.${action}`, entityType: "Obituary", entityId: id, meta: { from: current.status, to }, ip });
    await notifyReview(tx, { userId: current.createdById, actorId: actor.id, kind: "obituary", action, reason, link: `/obituaries/${updated.slug}` });
    return updated;
  });
}

/** Permanent removal (e.g. a fake or mistaken notice). Gated by `obituary.delete`; the audit row keeps a snapshot. */
export async function deleteObituary(actor: Actor, id: string, ip?: string) {
  const current = await prisma.obituary.findUnique({ where: { id }, include: { translations: { select: { lang: true, name: true } } } });
  if (!current) throw ApiError.notFound("Obituary not found");
  if (!can(actor, "obituary.delete")) throw ApiError.forbidden("You cannot delete notices", "FORBIDDEN");

  await prisma.$transaction(async (tx) => {
    await tx.obituary.delete({ where: { id } });
    await audit(tx, {
      actorId: actor.id,
      action: "obituary.delete",
      entityType: "Obituary",
      entityId: id,
      meta: { slug: current.slug, status: current.status, names: Object.fromEntries(current.translations.map((t) => [t.lang, t.name])) },
      ip,
    });
  });
  return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Tributes (श्रद्धांजलि)
// ---------------------------------------------------------------------------

const tributePublicSelect = { id: true, authorName: true, relation: true, message: true, createdAt: true } satisfies Prisma.ObituaryTributeSelect;

export async function listTributes(slug: string, p: { page: number; limit: number }) {
  const ob = await prisma.obituary.findFirst({ where: { slug, ...visible }, select: { id: true } });
  if (!ob) throw ApiError.notFound("Obituary not found");
  const where: Prisma.ObituaryTributeWhereInput = { obituaryId: ob.id, status: "PUBLISHED" };
  const [items, total] = await Promise.all([
    prisma.obituaryTribute.findMany({ where, select: tributePublicSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.obituaryTribute.count({ where }),
  ]);
  return toPage(items, total, p.page, p.limit);
}

/**
 * One tribute per member per notice. Posting again replaces the text and sends it back to review;
 * staff who moderate this notice publish straight away.
 */
export async function postTribute(actor: Actor, obituaryId: string, input: TributeInput, ip?: string) {
  const ob = await prisma.obituary.findUnique({ where: { id: obituaryId }, select: { id: true, status: true, locationId: true, stateId: true, districtId: true, cityId: true } });
  if (!ob || ob.status !== "PUBLISHED") throw ApiError.notFound("Obituary not found");

  const message = cleanText(input.message);
  if (message.length < 3) throw ApiError.badRequest("Message must contain text", undefined, "EMPTY_CONTENT");
  const relation = opt(input.relation) ?? null;
  const trusted = can(actor, MANAGE) && inScope(actor, ob);
  const status: TributeStatus = trusted ? "PUBLISHED" : "PENDING";
  const review = trusted ? { reviewedById: actor.id, reviewedAt: new Date() } : { reviewedById: null, reviewedAt: null };
  const authorName = cleanText(actor.name ?? "") || "Samaj member";

  return prisma.$transaction(async (tx) => {
    const t = await tx.obituaryTribute.upsert({
      where: { obituaryId_userId: { obituaryId, userId: actor.id } },
      create: { obituaryId, userId: actor.id, authorName, relation, message, status, ...review },
      update: { authorName, relation, message, status, ...review },
      select: { id: true, status: true, message: true, relation: true, authorName: true, createdAt: true },
    });
    await audit(tx, { actorId: actor.id, action: "obituary.tribute.post", entityType: "ObituaryTribute", entityId: t.id, meta: { obituaryId, status }, ip });
    return t;
  });
}

export async function myTribute(actor: Actor, obituaryId: string) {
  return prisma.obituaryTribute.findUnique({
    where: { obituaryId_userId: { obituaryId, userId: actor.id } },
    select: { id: true, status: true, message: true, relation: true, authorName: true, createdAt: true },
  });
}

export async function deleteMyTribute(actor: Actor, obituaryId: string, ip?: string) {
  const t = await prisma.obituaryTribute.findUnique({ where: { obituaryId_userId: { obituaryId, userId: actor.id } }, select: { id: true } });
  if (!t) throw ApiError.notFound("Tribute not found");
  await prisma.$transaction(async (tx) => {
    await tx.obituaryTribute.delete({ where: { id: t.id } });
    await audit(tx, { actorId: actor.id, action: "obituary.tribute.withdraw", entityType: "ObituaryTribute", entityId: t.id, meta: { obituaryId }, ip });
  });
  return { id: t.id, deleted: true };
}

async function tributeForModeration(actor: Actor, tributeId: string) {
  const t = await prisma.obituaryTribute.findUnique({
    where: { id: tributeId },
    include: { obituary: { select: { slug: true, createdById: true, locationId: true, stateId: true, districtId: true, cityId: true } } },
  });
  if (!t || !(can(actor, MANAGE) && inScope(actor, t.obituary))) throw ApiError.notFound("Tribute not found");
  return t;
}

export async function moderateTribute(actor: Actor, tributeId: string, to: "PUBLISHED" | "HIDDEN", ip?: string) {
  const t = await tributeForModeration(actor, tributeId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.obituaryTribute.update({ where: { id: t.id }, data: { status: to, reviewedById: actor.id, reviewedAt: new Date() }, select: { id: true, status: true } });
    await audit(tx, { actorId: actor.id, action: to === "PUBLISHED" ? "obituary.tribute.approve" : "obituary.tribute.hide", entityType: "ObituaryTribute", entityId: t.id, meta: { from: t.status, to }, ip });
    if (to === "PUBLISHED" && t.status !== "PUBLISHED") {
      const link = `/obituaries/${t.obituary.slug}`;
      if (t.userId !== actor.id) await notify(tx, t.userId, { type: "TRIBUTE", title: { hi: "आपकी श्रद्धांजलि प्रकाशित हो गई है", en: "Your tribute has been published" }, link });
      // The family that posted the notice hears about every new condolence.
      if (t.obituary.createdById !== t.userId) await notify(tx, t.obituary.createdById, { type: "TRIBUTE", title: { hi: `${t.authorName} ने श्रद्धांजलि अर्पित की`, en: `${t.authorName} paid tribute` }, body: { hi: t.message.slice(0, 140), en: t.message.slice(0, 140) }, link });
    }
    return updated;
  });
}

export async function deleteTribute(actor: Actor, tributeId: string, ip?: string) {
  const t = await tributeForModeration(actor, tributeId);
  await prisma.$transaction(async (tx) => {
    await tx.obituaryTribute.delete({ where: { id: t.id } });
    await audit(tx, { actorId: actor.id, action: "obituary.tribute.delete", entityType: "ObituaryTribute", entityId: t.id, meta: { obituaryId: t.obituaryId, message: t.message.slice(0, 200) }, ip });
  });
  return { id: t.id, deleted: true };
}

/** Moderation queue across every notice in the moderator's area (or one notice). */
export async function listTributesForManage(actor: Actor, p: { page: number; limit: number; status?: TributeStatus; obituaryId?: string }) {
  if (!can(actor, MANAGE)) throw ApiError.forbidden("You cannot moderate tributes", "FORBIDDEN");
  const where: Prisma.ObituaryTributeWhereInput = {
    obituary: scopeWhere(actor),
    ...(p.status ? { status: p.status } : {}),
    ...(p.obituaryId ? { obituaryId: p.obituaryId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.obituaryTribute.findMany({
      where,
      select: {
        ...tributePublicSelect,
        status: true,
        user: { select: { id: true, email: true } },
        obituary: { select: { id: true, slug: true, translations: { select: { lang: true, name: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.obituaryTribute.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ ...r, obituary: { ...r.obituary, translations: byLang(r.obituary.translations) } })),
    total,
    p.page,
    p.limit
  );
}

// ---------------------------------------------------------------------------
// Admin / member views
// ---------------------------------------------------------------------------

const manageSelect = {
  id: true,
  slug: true,
  status: true,
  photoUrl: true,
  dateOfDeath: true,
  rejectionReason: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true } },
  _count: { select: { tributes: { where: { status: "PENDING" } } } },
} satisfies Prisma.ObituarySelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; q?: string; mine?: boolean }) {
  const where: Prisma.ObituaryWhereInput = {
    AND: [
      manageScope(actor, MANAGE, p.mine),
      p.status ? { status: p.status } : {},
      p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.obituary.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.obituary.count({ where }),
  ]);
  return toPage(
    rows.map(({ _count, ...r }) => ({ ...r, translations: byLang(r.translations), pendingTributes: _count.tributes })),
    total,
    p.page,
    p.limit
  );
}

/** Full record for the edit form. Submitters see their own notices; managers anything in scope. */
export async function getForManage(actor: Actor, id: string) {
  const row = await prisma.obituary.findUnique({
    where: { id },
    include: {
      translations: true,
      location: { select: { path: true } },
      gotra: { select: { id: true, nameEn: true, nameHi: true } },
      ceremonies: { select: ceremonySelect, orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] },
    },
  });
  const allowed = row && (row.createdById === actor.id || (can(actor, MANAGE) && inScope(actor, row)));
  if (!row || !allowed) throw ApiError.notFound("Obituary not found");
  return { ...row, translations: byLang(row.translations) };
}
