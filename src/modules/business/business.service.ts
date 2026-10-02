import { Prisma } from "@prisma/client";
import type { ContentStatus, InboxStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope, scopeWhere } from "../../lib/access";
import { audit } from "../../lib/audit";
import { byLang, translationRows } from "../../lib/i18n";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE, WorkflowAction, nextStatus } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState } from "../locations/location.service";
import type { CreateBusinessInput, EnquiryInput, UpdateBusinessInput } from "./business.schemas";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories() {
  const rows = await prisma.businessCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: { slug: true, nameHi: true, nameEn: true, icon: true, _count: { select: { businesses: { where: { status: "PUBLISHED" } } } } },
  });
  return { items: rows.map(({ _count, ...c }) => ({ ...c, count: _count.businesses })) };
}

async function categoryId(slug: string) {
  const c = await prisma.businessCategory.findFirst({ where: { slug, isActive: true }, select: { id: true } });
  if (!c) throw ApiError.badRequest("Unknown category", undefined, "INVALID_CATEGORY");
  return c.id;
}

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  slug: true,
  stateId: true,
  verification: true,
  isFeatured: true,
  logoUrl: true,
  coverImageUrl: true,
  phone: true,
  whatsapp: true,
  establishedYear: true,
  category: { select: { slug: true, nameHi: true, nameEn: true, icon: true } },
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true, tagline: true, offers: true } },
} satisfies Prisma.BusinessSelect;

const detailSelect = {
  ...listSelect,
  email: true,
  website: true,
  socials: true,
  gallery: true,
  pincode: true,
  latitude: true,
  longitude: true,
  verifiedAt: true,
  updatedAt: true,
  translations: { select: { lang: true, name: true, tagline: true, description: true, address: true, offers: true } },
} satisfies Prisma.BusinessSelect;

const visible: Prisma.BusinessWhereInput = { status: "PUBLISHED" };

export async function listPublic(p: { page: number; limit: number; category?: string; location?: string; q?: string; verified?: boolean; featured?: boolean }) {
  const where: Prisma.BusinessWhereInput = {
    AND: [
      visible,
      await locationWhere(p.location),
      p.category ? { category: { slug: p.category } } : {},
      p.verified ? { verification: "VERIFIED" } : {},
      p.featured !== undefined ? { isFeatured: p.featured } : {},
      p.q
        ? {
            OR: [
              { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } },
              { translations: { some: { tagline: { contains: p.q, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.business.findMany({
      where,
      select: listSelect,
      // paid placements first, then curated order, then most recently verified
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { verifiedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.business.count({ where }),
  ]);
  return toPage((await withState(rows)).map((r) => ({ ...r, translations: byLang(r.translations) })), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.business.findFirst({ where: { slug, ...visible }, select: detailSelect });
  if (!row) throw ApiError.notFound("Business not found");
  const [self] = await withState([row]);
  return { ...self, translations: byLang(row.translations), gallery: Array.isArray(row.gallery) ? row.gallery : [] };
}

export const listSitemap = (limit = 5000) =>
  prisma.business.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

/** Expired paid placements drop back to normal ordering. Atomic; safe on every instance. */
export async function expireFeatured(): Promise<number> {
  const now = new Date();
  return prisma.$executeRaw`UPDATE "Business" SET "isFeatured" = false, "featuredUntil" = NULL, "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC') WHERE "isFeatured" = true AND "featuredUntil" IS NOT NULL AND ("featuredUntil" AT TIME ZONE 'UTC') <= ${now}::timestamptz`;
}

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

type TranslationInput = NonNullable<CreateBusinessInput["translations"]["hi"]>;

function cleanTranslation(t: TranslationInput) {
  const name = cleanText(t.name);
  if (name.length < 2) throw ApiError.badRequest("Name must contain text", undefined, "EMPTY_CONTENT");
  const opt = (v?: string) => (v ? cleanText(v) || null : null);
  return { name, tagline: opt(t.tagline), description: opt(t.description), address: opt(t.address), offers: opt(t.offers) };
}

const MANAGER_ONLY = ["sortOrder", "isFeatured", "featuredUntil"] as const;

function scalars(input: Partial<CreateBusinessInput>) {
  const out: Record<string, unknown> = {};
  const keys = ["pincode", "latitude", "longitude", "phone", "whatsapp", "email", "website", "logoUrl", "coverImageUrl", "establishedYear", ...MANAGER_ONLY] as const;
  for (const k of keys) if (input[k] !== undefined) out[k] = input[k];
  if (input.socials !== undefined) out.socials = input.socials === null ? Prisma.DbNull : (input.socials as Prisma.InputJsonValue);
  if (input.gallery !== undefined) out.gallery = input.gallery === null ? Prisma.DbNull : [...new Set(input.gallery)];
  return out;
}

const isManager = (actor: Actor, target?: Parameters<typeof inScope>[1]) => can(actor, "business.manage") && (!target || inScope(actor, target));

export async function createBusiness(actor: Actor, input: CreateBusinessInput, ip?: string) {
  const refs = await resolveLocation(input.locationPath);
  const manager = isManager(actor);
  if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
  if (!manager && MANAGER_ONLY.some((k) => input[k] !== undefined)) throw ApiError.forbidden("Only managers can feature or order listings", "FORBIDDEN");

  // Members may hold a handful of listings, not flood the directory.
  if (!manager && (await prisma.business.count({ where: { ownerId: actor.id, status: { not: "ARCHIVED" } } })) >= 5) {
    throw new ApiError(409, "You can list up to 5 businesses. Contact support to add more.", undefined, "LISTING_LIMIT");
  }

  const [catId, slug] = await Promise.all([
    categoryId(input.categorySlug),
    uniqueSlug(input.slug ?? input.translations.en?.name ?? "business", async (s) => !!(await prisma.business.findUnique({ where: { slug: s }, select: { id: true } }))),
  ]);
  const translations = translationRows(input.translations, cleanTranslation);

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        ...(scalars(input) as Prisma.BusinessUncheckedCreateInput),
        slug,
        categoryId: catId,
        status: manager ? "PUBLISHED" : "PENDING_REVIEW",
        locationId: refs.locationId,
        stateId: refs.stateId,
        districtId: refs.districtId,
        cityId: refs.cityId,
        ownerId: actor.id,
        ...(manager ? { reviewedById: actor.id, reviewedAt: new Date() } : {}),
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "business.create", entityType: "Business", entityId: business.id, ip });
    return business;
  });
}

async function loadForWrite(id: string) {
  const b = await prisma.business.findUnique({ where: { id } });
  if (!b) throw ApiError.notFound("Business not found");
  return b;
}

export async function updateBusiness(actor: Actor, id: string, input: UpdateBusinessInput, ip?: string) {
  const b = await loadForWrite(id);
  const manager = isManager(actor, b);
  const owner = b.ownerId === actor.id && AUTHOR_EDITABLE.includes(b.status);
  if (!(manager || owner)) {
    throw ApiError.forbidden(
      b.ownerId === actor.id ? "Published listings are edited by the samaj team. Send the changes through feedback." : "You cannot edit this listing",
      "FORBIDDEN"
    );
  }
  if (!manager && MANAGER_ONLY.some((k) => input[k] !== undefined)) throw ApiError.forbidden("Only managers can feature or order listings", "FORBIDDEN");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId };
  }
  const catId = input.categorySlug ? await categoryId(input.categorySlug) : undefined;
  const translations = translationRows(input.translations, cleanTranslation);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.businessTranslation.upsert({ where: { businessId_lang: { businessId: id, lang } }, create: { businessId: id, lang, ...data }, update: data });
    }
    const updated = await tx.business.update({
      where: { id },
      data: { ...(scalars(input) as Prisma.BusinessUncheckedUpdateInput), ...loc, ...(catId ? { categoryId: catId } : {}) },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "business.update", entityType: "Business", entityId: id, ip });
    return updated;
  });
}

export type BusinessAction = Extract<WorkflowAction, "submit" | "publish" | "reject" | "archive" | "restore">;

export async function transitionBusiness(actor: Actor, id: string, action: BusinessAction, reason?: string, ip?: string) {
  const b = await loadForWrite(id);
  const manager = isManager(actor, b);
  const owner = b.ownerId === actor.id;
  const ownerAllowed = owner && (action === "submit" || (action === "archive" && ["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(b.status)));
  if (!(manager || ownerAllowed)) throw ApiError.forbidden("You cannot perform this action", "FORBIDDEN");
  if (action === "reject" && !reason) throw ApiError.badRequest("A rejection reason is required");

  const to: ContentStatus = nextStatus(b.status, action);
  const now = new Date();
  const data: Prisma.BusinessUpdateInput = { status: to };
  if (action === "publish") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: null });
  if (action === "reject") Object.assign(data, { reviewedById: actor.id, reviewedAt: now, rejectionReason: reason });
  if (action === "submit") Object.assign(data, { rejectionReason: null });
  if (action === "archive" || action === "restore") Object.assign(data, { verification: "UNVERIFIED", verifiedAt: null, isFeatured: false, featuredUntil: null });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.business.update({ where: { id }, data, select: { id: true, slug: true, status: true, verification: true } });
    await audit(tx, { actorId: actor.id, action: `business.${action}`, entityType: "Business", entityId: id, meta: { from: b.status, to, ...(reason ? { reason } : {}) }, ip });
    return updated;
  });
}

export async function setVerification(actor: Actor, id: string, verified: boolean, ip?: string) {
  const b = await loadForWrite(id);
  if (!isManager(actor, b)) throw ApiError.forbidden("You cannot verify this listing", "FORBIDDEN");
  if (verified && b.status !== "PUBLISHED") throw new ApiError(409, "Only published listings can be verified", undefined, "INVALID_TRANSITION");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.business.update({
      where: { id },
      data: verified ? { verification: "VERIFIED", verifiedAt: new Date(), reviewedById: actor.id } : { verification: "UNVERIFIED", verifiedAt: null },
      select: { id: true, slug: true, verification: true },
    });
    await audit(tx, { actorId: actor.id, action: verified ? "business.verify" : "business.unverify", entityType: "Business", entityId: id, ip });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Management lists
// ---------------------------------------------------------------------------

const manageSelect = {
  id: true,
  slug: true,
  status: true,
  verification: true,
  isFeatured: true,
  featuredUntil: true,
  rejectionReason: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  category: { select: { slug: true, nameHi: true, nameEn: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, name: true } },
  _count: { select: { enquiries: { where: { status: "NEW" } } } },
} satisfies Prisma.BusinessSelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; category?: string; q?: string }) {
  if (!isManager(actor)) throw ApiError.forbidden("Insufficient permissions", "FORBIDDEN");
  const where: Prisma.BusinessWhereInput = {
    AND: [
      scopeWhere(actor),
      p.status ? { status: p.status } : {},
      p.category ? { category: { slug: p.category } } : {},
      p.q ? { translations: { some: { name: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.business.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.business.count({ where }),
  ]);
  return toPage(
    rows.map(({ _count, ...r }) => ({ ...r, newEnquiries: _count.enquiries, translations: byLang(r.translations) })),
    total,
    p.page,
    p.limit
  );
}

export async function getForEdit(actor: Actor, id: string) {
  const b = await prisma.business.findUnique({
    where: { id },
    include: { translations: true, category: { select: { slug: true } }, location: { select: { path: true } } },
  });
  if (!b || !(b.ownerId === actor.id || isManager(actor, b))) throw ApiError.notFound("Business not found");
  return { ...b, translations: byLang(b.translations), gallery: Array.isArray(b.gallery) ? b.gallery : [] };
}

/** Listings owned by the signed-in member (account page). */
export async function myListings(actor: Actor) {
  const rows = await prisma.business.findMany({
    where: { ownerId: actor.id, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      status: true,
      verification: true,
      rejectionReason: true,
      updatedAt: true,
      category: { select: { nameHi: true, nameEn: true } },
      translations: { select: { lang: true, name: true } },
      _count: { select: { enquiries: true } },
    },
  });
  return { items: rows.map(({ _count, ...r }) => ({ ...r, enquiries: _count.enquiries, translations: byLang(r.translations) })) };
}

// ---------------------------------------------------------------------------
// Enquiries (leads)
// ---------------------------------------------------------------------------

export async function createEnquiry(businessId: string, input: EnquiryInput, userId: string | undefined, ip?: string) {
  const b = await prisma.business.findFirst({ where: { id: businessId, ...visible }, select: { id: true } });
  if (!b) throw ApiError.notFound("Business not found");

  // The same person asking the same business twice within a day is almost always a double submit.
  const dup = await prisma.businessEnquiry.findFirst({
    where: { businessId, phone: input.phone, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  if (dup) return { id: dup.id, duplicate: true };

  const e = await prisma.businessEnquiry.create({
    data: {
      businessId,
      userId: userId ?? null,
      name: cleanText(input.name),
      phone: input.phone,
      email: input.email ?? null,
      message: cleanText(input.message),
      ip: ip ?? null,
    },
    select: { id: true },
  });
  return { id: e.id, duplicate: false };
}

const enquirySelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  message: true,
  status: true,
  createdAt: true,
  business: { select: { id: true, slug: true, translations: { select: { lang: true, name: true } } } },
} satisfies Prisma.BusinessEnquirySelect;

/** Managers see every enquiry in scope; a business owner sees only enquiries for their own listings. */
export async function listEnquiries(actor: Actor, p: { page: number; limit: number; status?: InboxStatus; businessId?: string }, { ownOnly = false } = {}) {
  const manager = !ownOnly && can(actor, "business.manage");
  const where: Prisma.BusinessEnquiryWhereInput = {
    AND: [
      manager ? { business: scopeWhere(actor) as Prisma.BusinessWhereInput } : { business: { ownerId: actor.id } },
      p.status ? { status: p.status } : {},
      p.businessId ? { businessId: p.businessId } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.businessEnquiry.findMany({ where, select: enquirySelect, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.businessEnquiry.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ ...r, business: { ...r.business, translations: byLang(r.business.translations) } })), total, p.page, p.limit);
}

export async function updateEnquiry(actor: Actor, id: string, status: InboxStatus, ip?: string) {
  const e = await prisma.businessEnquiry.findUnique({ where: { id }, include: { business: true } });
  if (!e) throw ApiError.notFound("Enquiry not found");
  const allowed = e.business.ownerId === actor.id || isManager(actor, e.business);
  if (!allowed) throw ApiError.notFound("Enquiry not found");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.businessEnquiry.update({ where: { id }, data: { status }, select: { id: true, status: true } });
    await audit(tx, { actorId: actor.id, action: "business.enquiry.update", entityType: "BusinessEnquiry", entityId: id, meta: { status }, ip });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Category management (taxonomy.manage)
// ---------------------------------------------------------------------------

export async function upsertCategory(actor: Actor, input: { slug: string; nameHi: string; nameEn: string; icon?: string | null; sortOrder?: number; isActive?: boolean }, ip?: string) {
  const data = {
    nameHi: cleanText(input.nameHi),
    nameEn: cleanText(input.nameEn),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const c = await tx.businessCategory.upsert({ where: { slug: input.slug }, create: { slug: input.slug, ...data }, update: data });
    await audit(tx, { actorId: actor.id, action: "business.category.upsert", entityType: "BusinessCategory", entityId: c.id, meta: { slug: c.slug }, ip });
    return { slug: c.slug, nameHi: c.nameHi, nameEn: c.nameEn, icon: c.icon, sortOrder: c.sortOrder, isActive: c.isActive };
  });
}
