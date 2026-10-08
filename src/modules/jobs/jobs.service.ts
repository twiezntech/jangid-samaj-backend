import { Prisma, type ContentStatus, type InboxStatus, type JobType, type WorkMode } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope } from "../../lib/access";
import { audit } from "../../lib/audit";
import { byLang, translationRows } from "../../lib/i18n";
import { ModerationAction, authorizeTransition, initialStatus, manageScope, reviewFields } from "../../lib/moderation";
import { notify, notifyReview } from "../../lib/notify";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { AUTHOR_EDITABLE } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState } from "../locations/location.service";
import type { ApplyInput, CreateJobInput, UpdateJobInput } from "./jobs.schemas";

const MANAGE = "job.manage";

/** Today's date in India; a job stays open through its last date. */
const todayIst = () => new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
const openWhere = (): Prisma.JobWhereInput => ({ status: "PUBLISHED", OR: [{ lastDate: null }, { lastDate: { gte: todayIst() } }] });
const isOpen = (j: { status: ContentStatus; lastDate: Date | null }) => j.status === "PUBLISHED" && (!j.lastDate || j.lastDate >= todayIst());

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

const cardSelect = {
  slug: true,
  type: true,
  workMode: true,
  organisationName: true,
  salaryMin: true,
  salaryMax: true,
  experienceYears: true,
  vacancies: true,
  lastDate: true,
  isFeatured: true,
  createdAt: true,
  updatedAt: true,
  stateId: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true } },
} satisfies Prisma.JobSelect;

const detailSelect = {
  ...cardSelect,
  id: true,
  status: true,
  applyUrl: true,
  applyEmail: true,
  applyPhone: true,
  business: { select: { slug: true, status: true, translations: { select: { lang: true, name: true } } } },
  translations: { select: { lang: true, title: true, description: true, requirements: true } },
} satisfies Prisma.JobSelect;

export async function listPublic(p: { page: number; limit: number; type?: JobType; workMode?: WorkMode; location?: string; q?: string; featured?: boolean }) {
  const where: Prisma.JobWhereInput = {
    AND: [
      openWhere(),
      await locationWhere(p.location),
      p.type ? { type: p.type } : {},
      p.workMode ? { workMode: p.workMode } : {},
      p.featured !== undefined ? { isFeatured: p.featured } : {},
      p.q
        ? { OR: [{ organisationName: { contains: p.q, mode: "insensitive" } }, { translations: { some: { OR: [{ title: { contains: p.q, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }] } } }] }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.job.findMany({ where, select: cardSelect, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.job.count({ where }),
  ]);
  return toPage((await withState(rows)).map(({ translations, ...r }) => ({ ...r, translations: byLang(translations) })), total, p.page, p.limit);
}

/** Expired posts still open (marked closed) so shared links keep working; drafts and archived ones do not. */
export async function getPublicBySlug(slug: string) {
  const row = await prisma.job.findFirst({ where: { slug, status: "PUBLISHED" }, select: detailSelect });
  if (!row) throw ApiError.notFound("Job not found");
  const [{ translations, business, status, ...rest }] = await withState([row]);
  return {
    ...rest,
    isOpen: isOpen({ status, lastDate: rest.lastDate }),
    translations: byLang(translations),
    business: business?.status === "PUBLISHED" ? { slug: business.slug, translations: byLang(business.translations) } : null,
  };
}

export const listSitemap = (limit = 5000) => prisma.job.findMany({ where: openWhere(), select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model
// ---------------------------------------------------------------------------

function cleanTranslations(input: CreateJobInput["translations"] | undefined) {
  return translationRows(input, (t) => {
    const title = cleanText(t.title);
    const description = cleanText(t.description);
    if (title.length < 3 || description.length < 20) throw ApiError.badRequest("Title and description must contain text", undefined, "EMPTY_CONTENT");
    return { title, description, requirements: t.requirements ? cleanText(t.requirements) || null : null };
  });
}

/** Members may only link their own published business; managers any published one. */
async function resolveBusiness(actor: Actor, slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (slug === null) return null;
  const b = await prisma.business.findUnique({ where: { slug }, select: { id: true, ownerId: true, status: true } });
  if (!b || b.status !== "PUBLISHED") throw ApiError.badRequest("Unknown business", undefined, "INVALID_BUSINESS");
  if (b.ownerId !== actor.id && !can(actor, MANAGE)) throw ApiError.forbidden("You can only link your own business", "FORBIDDEN");
  return b.id;
}

function scalarFields(input: Partial<CreateJobInput>) {
  const s = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : cleanText(v) || null);
  return {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.workMode !== undefined ? { workMode: input.workMode } : {}),
    ...(input.organisationName !== undefined ? { organisationName: cleanText(input.organisationName) } : {}),
    ...(input.salaryMin !== undefined ? { salaryMin: input.salaryMin } : {}),
    ...(input.salaryMax !== undefined ? { salaryMax: input.salaryMax } : {}),
    ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
    ...(input.vacancies !== undefined ? { vacancies: input.vacancies } : {}),
    ...(input.lastDate !== undefined ? { lastDate: input.lastDate } : {}),
    ...(input.applyUrl !== undefined ? { applyUrl: input.applyUrl } : {}),
    ...(input.applyEmail !== undefined ? { applyEmail: input.applyEmail } : {}),
    ...(input.applyPhone !== undefined ? { applyPhone: s(input.applyPhone) } : {}),
  };
}

const denormalised = (r: Awaited<ReturnType<typeof resolveLocation>>) => ({ locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId });

function checkLastDate(d: Date | null | undefined) {
  if (d && d < todayIst()) throw ApiError.badRequest("Last date cannot be in the past", undefined, "INVALID_DATE");
}

export async function createJob(actor: Actor, input: CreateJobInput, ip?: string) {
  checkLastDate(input.lastDate);
  const refs = await resolveLocation(input.locationPath);
  const status = initialStatus(actor, MANAGE, refs);
  const manager = can(actor, MANAGE);
  if (!manager && input.isFeatured !== undefined) throw ApiError.forbidden("Only managers can feature jobs", "FORBIDDEN");
  const businessId = await resolveBusiness(actor, input.businessSlug);
  const translations = cleanTranslations(input.translations);
  const base = input.slug ?? input.translations.en?.title ?? input.translations.hi?.title ?? "job";
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.job.findUnique({ where: { slug: s }, select: { id: true } })));

  return prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        ...scalarFields(input),
        type: input.type,
        organisationName: cleanText(input.organisationName),
        slug,
        status,
        businessId: businessId ?? null,
        isFeatured: manager && status === "PUBLISHED" ? input.isFeatured ?? false : false,
        ...denormalised(refs),
        createdById: actor.id,
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "job.create", entityType: "Job", entityId: created.id, ip });
    return created;
  });
}

async function loadForWrite(id: string) {
  const j = await prisma.job.findUnique({ where: { id } });
  if (!j) throw ApiError.notFound("Job not found");
  return j;
}

export async function updateJob(actor: Actor, id: string, input: UpdateJobInput, ip?: string) {
  const current = await loadForWrite(id);
  const manager = can(actor, MANAGE) && inScope(actor, current);
  const owner = current.createdById === actor.id && AUTHOR_EDITABLE.includes(current.status);
  if (!(manager || owner)) throw ApiError.forbidden("You cannot edit this job", "FORBIDDEN");
  if (!manager && input.isFeatured !== undefined) throw ApiError.forbidden("Only managers can feature jobs", "FORBIDDEN");
  checkLastDate(input.lastDate);
  const min = input.salaryMin !== undefined ? input.salaryMin : current.salaryMin;
  const max = input.salaryMax !== undefined ? input.salaryMax : current.salaryMax;
  if (min != null && max != null && min > max) throw ApiError.badRequest("Minimum salary cannot be above the maximum");

  let loc = {};
  if (input.locationPath) {
    const refs = await resolveLocation(input.locationPath);
    if (manager && !inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
    loc = denormalised(refs);
  }
  const businessId = await resolveBusiness(actor, input.businessSlug);
  const translations = cleanTranslations(input.translations as CreateJobInput["translations"] | undefined);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.jobTranslation.upsert({ where: { jobId_lang: { jobId: id, lang } }, create: { jobId: id, lang, ...data }, update: data });
    }
    const updated = await tx.job.update({
      where: { id },
      data: {
        ...scalarFields(input as Partial<CreateJobInput>),
        ...(businessId !== undefined ? { businessId } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured && current.status === "PUBLISHED" } : {}),
        ...loc,
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "job.update", entityType: "Job", entityId: id, ip });
    return updated;
  });
}

export async function transitionJob(actor: Actor, id: string, action: ModerationAction, reason?: string, ip?: string) {
  const current = await loadForWrite(id);
  const to: ContentStatus = authorizeTransition(actor, MANAGE, current, action, reason);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.job.update({
      where: { id },
      data: { status: to, ...reviewFields(actor, action, reason), ...(to !== "PUBLISHED" ? { isFeatured: false } : {}) },
      select: { id: true, slug: true, status: true, isFeatured: true },
    });
    await audit(tx, { actorId: actor.id, action: `job.${action}`, entityType: "Job", entityId: id, meta: { from: current.status, to }, ip });
    await notifyReview(tx, { userId: current.createdById, actorId: actor.id, kind: "job", action, reason, link: `/jobs/${updated.slug}` });
    return updated;
  });
}

export async function setFeatured(actor: Actor, id: string, featured: boolean, ip?: string) {
  const current = await loadForWrite(id);
  if (!(can(actor, MANAGE) && inScope(actor, current))) throw ApiError.forbidden("You cannot feature this job", "FORBIDDEN");
  if (featured && current.status !== "PUBLISHED") throw new ApiError(409, "Only published jobs can be featured", undefined, "INVALID_TRANSITION");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.job.update({ where: { id }, data: { isFeatured: featured }, select: { id: true, slug: true, isFeatured: true } });
    await audit(tx, { actorId: actor.id, action: featured ? "job.feature" : "job.unfeature", entityType: "Job", entityId: id, ip });
    return updated;
  });
}

export async function deleteJob(actor: Actor, id: string, ip?: string) {
  const current = await prisma.job.findUnique({ where: { id }, include: { translations: { select: { lang: true, title: true } } } });
  if (!current) throw ApiError.notFound("Job not found");
  if (!can(actor, "job.delete")) throw ApiError.forbidden("You cannot delete jobs", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    await tx.job.delete({ where: { id } });
    await audit(tx, { actorId: actor.id, action: "job.delete", entityType: "Job", entityId: id, meta: { slug: current.slug, status: current.status, titles: Object.fromEntries(current.translations.map((t) => [t.lang, t.title])) }, ip });
  });
  return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function apply(actor: Actor, jobId: string, input: ApplyInput, ip?: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, slug: true, status: true, lastDate: true, createdById: true, translations: { select: { lang: true, title: true } } } });
  if (!job || job.status !== "PUBLISHED") throw ApiError.notFound("Job not found");
  if (!isOpen(job)) throw new ApiError(409, "Applications for this job are closed", undefined, "JOB_CLOSED");
  if (job.createdById === actor.id) throw ApiError.badRequest("You cannot apply to your own post", undefined, "OWN_JOB");

  try {
    return await prisma.$transaction(async (tx) => {
      const a = await tx.jobApplication.create({
        data: { jobId, userId: actor.id, name: cleanText(input.name), phone: input.phone, email: input.email ?? null, message: cleanText(input.message) },
        select: { id: true, createdAt: true },
      });
      const title = byLang(job.translations);
      await notify(tx, job.createdById, {
        type: "JOB_APPLICATION",
        title: { hi: `"${title.hi?.title ?? title.en?.title}" के लिए नया आवेदन`, en: `New application for "${title.en?.title ?? title.hi?.title}"` },
        body: { hi: cleanText(input.name), en: cleanText(input.name) },
        link: "/account",
      });
      await audit(tx, { actorId: actor.id, action: "job.apply", entityType: "JobApplication", entityId: a.id, meta: { jobId }, ip });
      return a;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "You have already applied for this job", undefined, "ALREADY_APPLIED");
    throw e;
  }
}

export async function myApplication(actor: Actor, jobId: string) {
  return prisma.jobApplication.findUnique({ where: { jobId_userId: { jobId, userId: actor.id } }, select: { id: true, status: true, createdAt: true } });
}

/** The poster and managers in scope read applications. */
async function canReadApplications(actor: Actor, jobId: string) {
  const job = await loadForWrite(jobId);
  if (!(job.createdById === actor.id || (can(actor, MANAGE) && inScope(actor, job)))) throw ApiError.notFound("Job not found");
  return job;
}

export async function listApplications(actor: Actor, jobId: string, p: { page: number; limit: number; status?: InboxStatus }) {
  await canReadApplications(actor, jobId);
  const where: Prisma.JobApplicationWhereInput = { jobId, ...(p.status ? { status: p.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.jobApplication.findMany({ where, select: { id: true, name: true, phone: true, email: true, message: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.jobApplication.count({ where }),
  ]);
  return toPage(items, total, p.page, p.limit);
}

export async function setApplicationStatus(actor: Actor, applicationId: string, status: InboxStatus, ip?: string) {
  const a = await prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { id: true, jobId: true } });
  if (!a) throw ApiError.notFound("Application not found");
  await canReadApplications(actor, a.jobId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.jobApplication.update({ where: { id: a.id }, data: { status }, select: { id: true, status: true } });
    await audit(tx, { actorId: actor.id, action: "job.application.status", entityType: "JobApplication", entityId: a.id, meta: { status }, ip });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Admin / member views
// ---------------------------------------------------------------------------

const manageSelect = {
  id: true,
  slug: true,
  type: true,
  status: true,
  isFeatured: true,
  organisationName: true,
  lastDate: true,
  rejectionReason: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.JobSelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; type?: JobType; q?: string; mine?: boolean }) {
  const where: Prisma.JobWhereInput = {
    AND: [
      manageScope(actor, MANAGE, p.mine),
      p.status ? { status: p.status } : {},
      p.type ? { type: p.type } : {},
      p.q ? { OR: [{ organisationName: { contains: p.q, mode: "insensitive" } }, { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.job.findMany({ where, select: manageSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.job.count({ where }),
  ]);
  return toPage(
    rows.map(({ _count, ...r }) => ({ ...r, translations: byLang(r.translations), applications: _count.applications, isOpen: isOpen(r) })),
    total,
    p.page,
    p.limit
  );
}

export async function getForManage(actor: Actor, id: string) {
  const row = await prisma.job.findUnique({
    where: { id },
    include: { translations: true, location: { select: { path: true } }, business: { select: { slug: true } }, _count: { select: { applications: true } } },
  });
  const allowed = row && (row.createdById === actor.id || (can(actor, MANAGE) && inScope(actor, row)));
  if (!row || !allowed) throw ApiError.notFound("Job not found");
  const { _count, ...rest } = row;
  return { ...rest, translations: byLang(row.translations), applications: _count.applications };
}
