import type { ContentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope } from "../../lib/access";
import { audit } from "../../lib/audit";
import { byLang, translationRows } from "../../lib/i18n";
import { ModerationAction, authorizeTransition, initialStatus, manageScope, reviewFields } from "../../lib/moderation";
import { notifyReview } from "../../lib/notify";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState } from "../locations/location.service";
import type { CreateAlbumInput, UpdateAlbumInput } from "./gallery.schemas";

const MANAGE = "gallery.manage";
const visible: Prisma.AlbumWhereInput = { status: "PUBLISHED" };

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

const cardSelect = {
  slug: true,
  coverUrl: true,
  takenOn: true,
  isFeatured: true,
  updatedAt: true,
  stateId: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  event: { select: { slug: true, status: true, translations: { select: { lang: true, title: true } } } },
  translations: { select: { lang: true, title: true } },
  // First photo stands in for a missing cover.
  items: { where: { kind: "PHOTO" }, select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
} satisfies Prisma.AlbumSelect;

type CardRow = Prisma.AlbumGetPayload<{ select: typeof cardSelect }>;

async function counts(ids: string[]) {
  const rows = await prisma.galleryItem.groupBy({ by: ["albumId", "kind"], where: { albumId: { in: ids } }, _count: { _all: true } });
  const map = new Map<string, { photos: number; videos: number }>();
  for (const r of rows) {
    const c = map.get(r.albumId) ?? { photos: 0, videos: 0 };
    if (r.kind === "PHOTO") c.photos = r._count._all;
    else c.videos = r._count._all;
    map.set(r.albumId, c);
  }
  return map;
}

const publicEvent = (e: CardRow["event"]) => (e && e.status === "PUBLISHED" ? { slug: e.slug, translations: byLang(e.translations) } : null);

export async function listPublic(p: { page: number; limit: number; location?: string; event?: string; q?: string; featured?: boolean; videos?: boolean }) {
  const where: Prisma.AlbumWhereInput = {
    AND: [
      visible,
      await locationWhere(p.location),
      p.event ? { event: { slug: p.event } } : {},
      p.featured !== undefined ? { isFeatured: p.featured } : {},
      p.videos ? { items: { some: { kind: "VIDEO" } } } : {},
      p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.album.findMany({
      where,
      select: { id: true, ...cardSelect },
      orderBy: [{ isFeatured: "desc" }, { takenOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.album.count({ where }),
  ]);
  const c = await counts(rows.map((r) => r.id));
  const items = (await withState(rows)).map(({ id, translations, items: first, event, coverUrl, ...r }) => ({
    ...r,
    coverUrl: coverUrl ?? first[0]?.url ?? null,
    event: publicEvent(event),
    translations: byLang(translations),
    ...(c.get(id) ?? { photos: 0, videos: 0 }),
  }));
  return toPage(items, total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.album.findFirst({
    where: { slug, ...visible },
    select: {
      ...cardSelect,
      translations: { select: { lang: true, title: true, description: true } },
      items: { select: { id: true, kind: true, url: true, caption: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!row) throw ApiError.notFound("Album not found");
  const [{ translations, event, coverUrl, items, ...rest }] = await withState([row]);
  return { ...rest, coverUrl: coverUrl ?? items.find((i) => i.kind === "PHOTO")?.url ?? null, event: publicEvent(event), translations: byLang(translations), items };
}

export const listSitemap = (limit = 5000) => prisma.album.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateAlbumInput["translations"] | undefined) {
  return translationRows(input, (t) => {
    const title = cleanText(t.title);
    if (title.length < 3) throw ApiError.badRequest("Title must contain text", undefined, "EMPTY_CONTENT");
    return { title, description: t.description ? cleanText(t.description) || null : null };
  });
}

const cleanItems = (items: NonNullable<CreateAlbumInput["items"]>) =>
  items.map((it, i) => ({ kind: it.kind, url: it.url, caption: it.caption ? cleanText(it.caption) || null : null, sortOrder: i }));

async function resolveEvent(slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (slug === null) return null;
  const e = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (!e) throw ApiError.badRequest("Unknown event", undefined, "INVALID_EVENT");
  return e.id;
}

const denormalised = (r: Awaited<ReturnType<typeof resolveLocation>>) => ({ locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId });

export async function createAlbum(actor: Actor, input: CreateAlbumInput, ip?: string) {
  const refs = await resolveLocation(input.locationPath);
  const status = initialStatus(actor, MANAGE, refs);
  const manager = can(actor, MANAGE);
  if (!manager && input.isFeatured !== undefined) throw ApiError.forbidden("Only managers can feature albums", "FORBIDDEN");
  const eventId = await resolveEvent(input.eventSlug);
  const translations = cleanTranslations(input.translations);
  const base = input.slug ?? input.translations.en?.title ?? input.translations.hi?.title ?? "album";
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.album.findUnique({ where: { slug: s }, select: { id: true } })));

  return prisma.$transaction(async (tx) => {
    const created = await tx.album.create({
      data: {
        slug,
        status,
        coverUrl: input.coverUrl ?? null,
        takenOn: input.takenOn ?? null,
        eventId: eventId ?? null,
        isFeatured: manager && status === "PUBLISHED" ? input.isFeatured ?? false : false,
        ...denormalised(refs),
        createdById: actor.id,
        translations: { create: translations },
        items: { create: cleanItems(input.items ?? []) },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "album.create", entityType: "Album", entityId: created.id, meta: { items: input.items?.length ?? 0 }, ip });
    return created;
  });
}

async function loadForWrite(id: string) {
  const a = await prisma.album.findUnique({ where: { id } });
  if (!a) throw ApiError.notFound("Album not found");
  return a;
}

export async function updateAlbum(actor: Actor, id: string, input: UpdateAlbumInput, ip?: string) {
  const current = await loadForWrite(id);
  const manager = can(actor, MANAGE) && inScope(actor, current);
  const owner = current.createdById === actor.id && AUTHOR_EDITABLE.includes(current.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this album", "FORBIDDEN");
  if (!manager && input.isFeatured !== undefined) throw ApiError.forbidden("Only managers can feature albums", "FORBIDDEN");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = denormalised(refs);
  }
  const eventId = await resolveEvent(input.eventSlug);
  const translations = cleanTranslations(input.translations as CreateAlbumInput["translations"] | undefined);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.albumTranslation.upsert({ where: { albumId_lang: { albumId: id, lang } }, create: { albumId: id, lang, ...data }, update: data });
    }
    if (input.items) {
      await tx.galleryItem.deleteMany({ where: { albumId: id } });
      if (input.items.length) await tx.galleryItem.createMany({ data: cleanItems(input.items).map((it) => ({ ...it, albumId: id })) });
    }
    const updated = await tx.album.update({
      where: { id },
      data: {
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
        ...(input.takenOn !== undefined ? { takenOn: input.takenOn } : {}),
        ...(eventId !== undefined ? { eventId } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured && current.status === "PUBLISHED" } : {}),
        ...loc,
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "album.update", entityType: "Album", entityId: id, ip });
    return updated;
  });
}

export async function transitionAlbum(actor: Actor, id: string, action: ModerationAction, reason?: string, ip?: string) {
  const current = await loadForWrite(id);
  const to: ContentStatus = authorizeTransition(actor, MANAGE, current, action, reason);
  if (action === "publish" && (await prisma.galleryItem.count({ where: { albumId: id } })) === 0) {
    throw ApiError.badRequest("Add at least one photo or video before publishing", undefined, "EMPTY_ALBUM");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.album.update({
      where: { id },
      data: { status: to, ...reviewFields(actor, action, reason), ...(to !== "PUBLISHED" ? { isFeatured: false } : {}) },
      select: { id: true, slug: true, status: true, isFeatured: true },
    });
    await audit(tx, { actorId: actor.id, action: `album.${action}`, entityType: "Album", entityId: id, meta: { from: current.status, to }, ip });
    await notifyReview(tx, { userId: current.createdById, actorId: actor.id, kind: "album", action, reason, link: `/gallery/${updated.slug}` });
    return updated;
  });
}

export async function setFeatured(actor: Actor, id: string, featured: boolean, ip?: string) {
  const current = await loadForWrite(id);
  if (!(can(actor, MANAGE) && inScope(actor, current))) throw ApiError.forbidden("You cannot feature this album", "FORBIDDEN");
  if (featured && current.status !== "PUBLISHED") throw new ApiError(409, "Only published albums can be featured", undefined, "INVALID_TRANSITION");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.album.update({ where: { id }, data: { isFeatured: featured }, select: { id: true, slug: true, isFeatured: true } });
    await audit(tx, { actorId: actor.id, action: featured ? "album.feature" : "album.unfeature", entityType: "Album", entityId: id, ip });
    return updated;
  });
}

export async function deleteAlbum(actor: Actor, id: string, ip?: string) {
  const current = await prisma.album.findUnique({ where: { id }, include: { translations: { select: { lang: true, title: true } } } });
  if (!current) throw ApiError.notFound("Album not found");
  if (!can(actor, "gallery.delete")) throw ApiError.forbidden("You cannot delete albums", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    await tx.album.delete({ where: { id } });
    await audit(tx, { actorId: actor.id, action: "album.delete", entityType: "Album", entityId: id, meta: { slug: current.slug, status: current.status, titles: Object.fromEntries(current.translations.map((t) => [t.lang, t.title])) }, ip });
  });
  return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Admin / member views
// ---------------------------------------------------------------------------

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; q?: string; mine?: boolean }) {
  const where: Prisma.AlbumWhereInput = {
    AND: [manageScope(actor, MANAGE, p.mine), p.status ? { status: p.status } : {}, p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {}],
  };
  const [rows, total] = await Promise.all([
    prisma.album.findMany({
      where,
      select: {
        id: true,
        slug: true,
        status: true,
        isFeatured: true,
        coverUrl: true,
        takenOn: true,
        rejectionReason: true,
        updatedAt: true,
        createdBy: { select: { id: true, name: true } },
        location: { select: { path: true, nameHi: true, nameEn: true } },
        translations: { select: { lang: true, title: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.album.count({ where }),
  ]);
  return toPage(rows.map(({ _count, ...r }) => ({ ...r, translations: byLang(r.translations), itemCount: _count.items })), total, p.page, p.limit);
}

export async function getForManage(actor: Actor, id: string) {
  const row = await prisma.album.findUnique({
    where: { id },
    include: {
      translations: true,
      location: { select: { path: true } },
      event: { select: { slug: true, translations: { select: { lang: true, title: true } } } },
      items: { select: { kind: true, url: true, caption: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  const allowed = row && (row.createdById === actor.id || (can(actor, MANAGE) && inScope(actor, row)));
  if (!row || !allowed) throw ApiError.notFound("Album not found");
  return { ...row, translations: byLang(row.translations), event: row.event ? { slug: row.event.slug, translations: byLang(row.event.translations) } : null };
}
