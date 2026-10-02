import type { ContentStatus, Lang, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope } from "../../lib/access";
import { audit } from "../../lib/audit";
import { LANGS, byLang } from "../../lib/i18n";
import { toPage } from "../../lib/pagination";
import { cleanHtml, cleanText, stripHtml } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE, WorkflowAction, nextStatus } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState } from "../locations/location.service";
import type { CreateNewsInput, UpdateNewsInput } from "./news.schemas";

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  stateId: true,
  slug: true,
  isBreaking: true,
  isFeatured: true,
  coverImageUrl: true,
  videoUrl: true,
  sourceName: true,
  publishedAt: true,
  category: { select: { slug: true, nameHi: true, nameEn: true } },
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true, excerpt: true, imageAlt: true } },
} satisfies Prisma.NewsSelect;

const detailSelect = {
  ...listSelect,
  updatedAt: true,
  translations: { select: { lang: true, title: true, excerpt: true, body: true, imageAlt: true, metaTitle: true, metaDescription: true } },
  tags: { select: { tag: { select: { slug: true, nameHi: true, nameEn: true } } } },
} satisfies Prisma.NewsSelect;

const visible = (): Prisma.NewsWhereInput => ({ status: "PUBLISHED", publishedAt: { lte: new Date() } });

export interface PublicListParams {
  page: number;
  limit: number;
  location?: string;
  category?: string;
  tag?: string;
  q?: string;
  featured?: boolean;
  breaking?: boolean;
}

export async function listPublic(p: PublicListParams) {
  const where: Prisma.NewsWhereInput = {
    ...visible(),
    ...(await locationWhere(p.location)),
    ...(p.category ? { category: { slug: p.category } } : {}),
    ...(p.tag ? { tags: { some: { tag: { slug: p.tag } } } } : {}),
    ...(p.featured !== undefined ? { isFeatured: p.featured } : {}),
    ...(p.breaking !== undefined ? { isBreaking: p.breaking } : {}),
    ...(p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.news.findMany({
      where,
      select: listSelect,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.news.count({ where }),
  ]);

  return toPage((await withState(rows)).map((r) => ({ ...r, translations: byLang(r.translations) })), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.news.findFirst({ where: { slug, ...visible() }, select: detailSelect });
  if (!row) throw ApiError.notFound("Story not found");

  const statePath = row.location?.path.split("/")[0] ?? "";
  const relatedBy: Prisma.NewsWhereInput[] = [
    ...(row.category ? [{ category: { slug: row.category.slug } }] : []),
    ...(row.location ? [{ location: { is: { OR: [{ path: statePath }, { path: { startsWith: `${statePath}/` } }] } } }] : []),
  ];
  const related = relatedBy.length
    ? await prisma.news.findMany({
        where: { ...visible(), id: { not: row.id }, OR: relatedBy },
        select: listSelect,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 4,
      })
    : [];

  const [self] = await withState([row]);
  return {
    ...self,
    translations: byLang(row.translations),
    tags: row.tags.map((t) => t.tag),
    related: (await withState(related)).map((r) => ({ ...r, translations: byLang(r.translations) })),
  };
}

/** Slugs for sitemap generation (last modified included). */
export async function listSitemap(limit = 5000) {
  return prisma.news.findMany({
    where: visible(),
    select: { slug: true, updatedAt: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

type TranslationInput = NonNullable<CreateNewsInput["translations"][Lang]>;

function cleanTranslation(t: TranslationInput) {
  const title = cleanText(t.title);
  const body = cleanHtml(t.body);
  if (title.length < 3 || stripHtml(body).length < 1) throw ApiError.badRequest("Title and body must contain text", undefined, "EMPTY_CONTENT");
  return {
    title,
    body,
    excerpt: t.excerpt ? cleanText(t.excerpt) : stripHtml(body).slice(0, 200),
    imageAlt: t.imageAlt ? cleanText(t.imageAlt) : null,
    metaTitle: t.metaTitle ? cleanText(t.metaTitle) : null,
    metaDescription: t.metaDescription ? cleanText(t.metaDescription) : null,
  };
}

async function tagIds(slugs: string[] | undefined) {
  if (!slugs) return undefined;
  const unique = [...new Set(slugs)];
  const tags = await prisma.tag.findMany({ where: { slug: { in: unique } }, select: { id: true } });
  if (tags.length !== unique.length) throw ApiError.badRequest("Unknown tag", undefined, "INVALID_TAG");
  return tags.map((t) => t.id);
}

async function categoryId(slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (slug === null) return null;
  const c = await prisma.category.findFirst({ where: { slug, isActive: true }, select: { id: true } });
  if (!c) throw ApiError.badRequest("Unknown category", undefined, "INVALID_CATEGORY");
  return c.id;
}

function assertFlags(actor: Actor, input: { isBreaking?: boolean; isFeatured?: boolean }) {
  if ((input.isBreaking !== undefined || input.isFeatured !== undefined) && !can(actor, "news.review")) {
    throw ApiError.forbidden("Only editors can mark stories breaking or featured", "FORBIDDEN");
  }
}

export async function createNews(actor: Actor, input: CreateNewsInput, ip?: string) {
  assertFlags(actor, input);

  const refs = input.locationPath ? await resolveLocation(input.locationPath) : null;
  if (actor.isLocationScoped && (!refs || !inScope(actor, refs))) {
    throw ApiError.forbidden("You can only report inside your assigned area", "OUT_OF_SCOPE");
  }

  const slug = await uniqueSlug(input.slug ?? input.translations.en?.title ?? "news", async (s) => !!(await prisma.news.findUnique({ where: { slug: s }, select: { id: true } })));
  const [catId, tags] = await Promise.all([categoryId(input.categorySlug), tagIds(input.tags)]);

  const translations = LANGS.flatMap((lang) => (input.translations[lang] ? [{ lang, ...cleanTranslation(input.translations[lang]!) }] : []));

  return prisma.$transaction(async (tx) => {
    const news = await tx.news.create({
      data: {
        slug,
        status: "DRAFT",
        isBreaking: input.isBreaking ?? false,
        isFeatured: input.isFeatured ?? false,
        coverImageUrl: input.coverImageUrl ?? null,
        videoUrl: input.videoUrl ?? null,
        sourceName: input.sourceName ? cleanText(input.sourceName) : null,
        categoryId: catId ?? null,
        ...(refs ? { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId } : {}),
        authorId: actor.id,
        translations: { create: translations },
        tags: tags ? { create: tags.map((tagId) => ({ tagId })) } : undefined,
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "news.create", entityType: "News", entityId: news.id, ip });
    return news;
  });
}

async function loadForWrite(id: string) {
  const news = await prisma.news.findUnique({ where: { id } });
  if (!news) throw ApiError.notFound("Story not found");
  return news;
}

export async function updateNews(actor: Actor, id: string, input: UpdateNewsInput, ip?: string) {
  const news = await loadForWrite(id);
  assertFlags(actor, input);

  const isOwner = news.authorId === actor.id;
  const editAny = can(actor, "news.edit.any") && inScope(actor, news);
  if (!((isOwner && AUTHOR_EDITABLE.includes(news.status)) || editAny)) throw ApiError.forbidden("You cannot edit this story", "FORBIDDEN");

  let locationData = {};
  if (input.locationPath !== undefined) {
    if (input.locationPath === null) {
      if (actor.isLocationScoped) throw ApiError.forbidden("A location is required for your role", "OUT_OF_SCOPE");
      locationData = { locationId: null, stateId: null, districtId: null, cityId: null };
    } else {
      const refs = await resolveLocation(input.locationPath);
      if (!inScope(actor, refs)) throw ApiError.forbidden("You can only report inside your assigned area", "OUT_OF_SCOPE");
      locationData = { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId };
    }
  }

  const [catId, tags] = await Promise.all([categoryId(input.categorySlug), tagIds(input.tags)]);
  const translations = input.translations
    ? LANGS.flatMap((lang) => (input.translations![lang] ? [{ lang, ...cleanTranslation(input.translations![lang]!) }] : []))
    : [];

  return prisma.$transaction(async (tx) => {
    for (const t of translations) {
      const { lang, ...data } = t;
      await tx.newsTranslation.upsert({ where: { newsId_lang: { newsId: id, lang } }, create: { newsId: id, lang, ...data }, update: data });
    }
    if (tags) {
      await tx.newsTag.deleteMany({ where: { newsId: id } });
      await tx.newsTag.createMany({ data: tags.map((tagId) => ({ newsId: id, tagId })) });
    }
    const updated = await tx.news.update({
      where: { id },
      data: {
        ...locationData,
        ...(catId !== undefined ? { categoryId: catId } : {}),
        ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
        ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
        ...(input.sourceName !== undefined ? { sourceName: input.sourceName ? cleanText(input.sourceName) : null } : {}),
        ...(input.isBreaking !== undefined ? { isBreaking: input.isBreaking } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "news.update", entityType: "News", entityId: id, ip });
    return updated;
  });
}

export interface TransitionOptions {
  scheduledAt?: Date;
  reason?: string;
}

/** Author-side actions vs. reviewer-side actions are authorised differently; the state machine itself is shared. */
export async function transitionNews(actor: Actor, id: string, action: WorkflowAction, opts: TransitionOptions = {}, ip?: string) {
  const news = await loadForWrite(id);
  const isOwner = news.authorId === actor.id;
  const reviewer = can(actor, "news.review") && inScope(actor, news);

  const authorAction = action === "submit" || (action === "archive" && ["DRAFT", "REJECTED"].includes(news.status));
  if (!(reviewer || (isOwner && authorAction))) throw ApiError.forbidden("You cannot perform this action", "FORBIDDEN");

  const to: ContentStatus = nextStatus(news.status, action);
  const now = new Date();

  if (action === "schedule" && (!opts.scheduledAt || opts.scheduledAt.getTime() <= now.getTime())) {
    throw ApiError.badRequest("scheduledAt must be in the future", undefined, "INVALID_SCHEDULE");
  }
  if (action === "reject" && !opts.reason) throw ApiError.badRequest("A rejection reason is required");

  const translationCount = await prisma.newsTranslation.count({ where: { newsId: id } });
  if (["submit", "publish", "schedule"].includes(action) && translationCount === 0) {
    throw ApiError.badRequest("Story has no content", undefined, "EMPTY_CONTENT");
  }

  const data: Prisma.NewsUpdateInput = { status: to };
  if (action === "publish") Object.assign(data, { publishedAt: news.publishedAt ?? now, scheduledAt: null, reviewedById: actor.id, reviewedAt: now, rejectionReason: null });
  if (action === "schedule") Object.assign(data, { scheduledAt: opts.scheduledAt, reviewedById: actor.id, reviewedAt: now, rejectionReason: null });
  if (action === "reject") Object.assign(data, { rejectionReason: opts.reason, reviewedById: actor.id, reviewedAt: now });
  if (action === "submit") Object.assign(data, { rejectionReason: null });
  if (action === "unpublish") Object.assign(data, { scheduledAt: null });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.news.update({ where: { id }, data, select: { id: true, slug: true, status: true, publishedAt: true, scheduledAt: true } });
    await audit(tx, { actorId: actor.id, action: `news.${action}`, entityType: "News", entityId: id, meta: { from: news.status, to }, ip });
    return updated;
  });
}

/** Promotes due scheduled stories. One atomic statement: safe to run on every API instance. */
export async function publishDueNews(): Promise<number> {
  // Columns are timestamp-WITHOUT-tz holding UTC. Convert explicitly so the DB session timezone can never shift the comparison.
  const now = new Date();
  return prisma.$executeRaw`UPDATE "News" SET "status" = 'PUBLISHED', "publishedAt" = "scheduledAt", "scheduledAt" = NULL, "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC') WHERE "status" = 'SCHEDULED' AND ("scheduledAt" AT TIME ZONE 'UTC') <= ${now}::timestamptz`;
}

// ---------------------------------------------------------------------------
// Editorial queue
// ---------------------------------------------------------------------------

const manageSelect = {
  id: true,
  slug: true,
  status: true,
  isBreaking: true,
  isFeatured: true,
  updatedAt: true,
  publishedAt: true,
  scheduledAt: true,
  rejectionReason: true,
  author: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true } },
} satisfies Prisma.NewsSelect;

function scopeFilter(actor: Actor): Prisma.NewsWhereInput {
  if (!actor.isLocationScoped) return {};
  if (!actor.locationId) return { id: "__none__" };
  const id = actor.locationId;
  return { OR: [{ locationId: id }, { stateId: id }, { districtId: id }, { cityId: id }] };
}

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; q?: string; mine?: boolean }) {
  const reviewer = can(actor, "news.review") || can(actor, "news.edit.any");
  const where: Prisma.NewsWhereInput = {
    AND: [
      reviewer && !p.mine ? scopeFilter(actor) : { authorId: actor.id },
      p.status ? { status: p.status } : {},
      p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.news.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.news.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ ...r, translations: byLang(r.translations) })), total, p.page, p.limit);
}

export async function getForManage(actor: Actor, id: string) {
  const news = await prisma.news.findUnique({
    where: { id },
    include: { translations: true, tags: { select: { tag: { select: { slug: true } } } }, category: { select: { slug: true } }, location: { select: { path: true } } },
  });
  if (!news) throw ApiError.notFound("Story not found");
  const allowed = news.authorId === actor.id || ((can(actor, "news.review") || can(actor, "news.edit.any")) && inScope(actor, news));
  if (!allowed) throw ApiError.notFound("Story not found"); // do not reveal existence
  return { ...news, translations: byLang(news.translations), tags: news.tags.map((t) => t.tag.slug) };
}
