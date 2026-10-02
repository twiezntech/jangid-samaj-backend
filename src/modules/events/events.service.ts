import { Prisma } from "@prisma/client";
import type { ContentStatus, EventCategory } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope, scopeWhere } from "../../lib/access";
import { audit } from "../../lib/audit";
import { byLang, translationRows } from "../../lib/i18n";
import { toPage } from "../../lib/pagination";
import { cleanHtml, cleanText, stripHtml } from "../../lib/sanitize";
import { uniqueSlug } from "../../lib/slug";
import { WorkflowAction, nextStatus } from "../../lib/workflow";
import { locationWhere, resolveLocation, withState } from "../locations/location.service";
import type { CreateEventInput, RegisterInput, UpdateEventInput } from "./events.schemas";

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  slug: true,
  stateId: true,
  category: true,
  startsAt: true,
  endsAt: true,
  isOnline: true,
  coverImageUrl: true,
  isFeatured: true,
  registrationEnabled: true,
  registrationDeadline: true,
  capacity: true,
  seatsTaken: true,
  feeAmount: true,
  location: { select: { path: true, level: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true, summary: true, venue: true } },
} satisfies Prisma.EventSelect;

const detailSelect = {
  ...listSelect,
  onlineUrl: true,
  pincode: true,
  latitude: true,
  longitude: true,
  gallery: true,
  organizerName: true,
  organizerPhone: true,
  organizerEmail: true,
  isContactPublic: true,
  updatedAt: true,
  organization: { select: { slug: true, status: true, translations: { select: { lang: true, name: true } } } },
  translations: { select: { lang: true, title: true, summary: true, description: true, venue: true, address: true, feeNote: true } },
} satisfies Prisma.EventSelect;

type Timing = { startsAt: Date; endsAt: Date | null; registrationEnabled: boolean; registrationDeadline: Date | null; capacity: number | null; seatsTaken: number };

/** Registration is open while enabled, before the deadline (or the start), and while seats remain. */
export function registrationState(e: Timing, now = new Date()) {
  const closesAt = e.registrationDeadline ?? e.startsAt;
  const seatsLeft = e.capacity === null ? null : Math.max(0, e.capacity - e.seatsTaken);
  const open = e.registrationEnabled && closesAt > now && seatsLeft !== 0;
  return { open, closesAt, seatsLeft, isFull: seatsLeft === 0 };
}

const ended = (e: { startsAt: Date; endsAt: Date | null }, now = new Date()) => (e.endsAt ?? e.startsAt) < now;

function toListItem<T extends Timing & { translations: { lang: "hi" | "en" }[] }>(row: T) {
  const { seatsTaken: _seats, ...rest } = row;
  return { ...rest, translations: byLang(row.translations), registration: registrationState(row), isPast: ended(row) };
}

const whenWhere = (when: "upcoming" | "past" | "all", now = new Date()): Prisma.EventWhereInput =>
  when === "upcoming"
    ? { OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] }
    : when === "past"
      ? { OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }] }
      : {};

export async function listPublic(p: { page: number; limit: number; when: "upcoming" | "past" | "all"; category?: EventCategory; location?: string; q?: string; featured?: boolean }) {
  const where: Prisma.EventWhereInput = {
    AND: [
      { status: "PUBLISHED" },
      whenWhere(p.when),
      await locationWhere(p.location),
      p.category ? { category: p.category } : {},
      p.featured !== undefined ? { isFeatured: p.featured } : {},
      p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const order: Prisma.SortOrder = p.when === "past" ? "desc" : "asc";
  const [rows, total] = await Promise.all([
    prisma.event.findMany({ where, select: listSelect, orderBy: [{ startsAt: order }, { id: "asc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.event.count({ where }),
  ]);
  return toPage((await withState(rows)).map(toListItem), total, p.page, p.limit);
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.event.findFirst({ where: { slug, status: "PUBLISHED" }, select: detailSelect });
  if (!row) throw ApiError.notFound("Event not found");
  const [self] = await withState([row]);
  const { isContactPublic, organizerPhone, organizerEmail, organization, ...rest } = self;
  return {
    ...toListItem(rest),
    ...(isContactPublic ? { organizerPhone, organizerEmail } : {}),
    contactHidden: !isContactPublic,
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    organization:
      organization && organization.status === "PUBLISHED"
        ? { slug: organization.slug, translations: byLang(organization.translations) }
        : null,
  };
}

export const listSitemap = (limit = 5000) =>
  prisma.event.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true }, orderBy: { startsAt: "desc" }, take: limit });

// ---------------------------------------------------------------------------
// Write model (event.manage)
// ---------------------------------------------------------------------------

type TranslationInput = NonNullable<CreateEventInput["translations"]["hi"]>;

function cleanTranslation(t: TranslationInput) {
  const title = cleanText(t.title);
  if (title.length < 3) throw ApiError.badRequest("Title must contain text", undefined, "EMPTY_CONTENT");
  const description = t.description ? cleanHtml(t.description) : null;
  return {
    title,
    summary: t.summary ? cleanText(t.summary) : description ? stripHtml(description).slice(0, 200) || null : null,
    description: description && stripHtml(description) ? description : null,
    venue: t.venue ? cleanText(t.venue) : null,
    address: t.address ? cleanText(t.address) : null,
    feeNote: t.feeNote ? cleanText(t.feeNote) : null,
  };
}

async function organizationId(slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (slug === null) return null;
  const org = await prisma.directoryEntry.findFirst({ where: { slug, status: "PUBLISHED" }, select: { id: true } });
  if (!org) throw ApiError.badRequest("Unknown organisation", undefined, "INVALID_ORGANIZATION");
  return org.id;
}

function assertManager(actor: Actor, target?: Parameters<typeof inScope>[1]) {
  if (!can(actor, "event.manage") || (target && !inScope(actor, target))) throw ApiError.forbidden("You cannot manage this event", "FORBIDDEN");
}

function scalars(input: Partial<CreateEventInput>) {
  const out: Record<string, unknown> = {};
  const keys = [
    "category", "startsAt", "endsAt", "isOnline", "onlineUrl", "pincode", "latitude", "longitude", "coverImageUrl",
    "organizerPhone", "organizerEmail", "isContactPublic", "registrationEnabled", "registrationDeadline", "capacity", "feeAmount", "isFeatured",
  ] as const;
  for (const k of keys) if (input[k] !== undefined) out[k] = input[k];
  if (input.organizerName !== undefined) out.organizerName = input.organizerName ? cleanText(input.organizerName) : null;
  if (input.gallery !== undefined) out.gallery = input.gallery === null ? Prisma.DbNull : [...new Set(input.gallery)];
  return out;
}

async function locationData(actor: Actor, path: string | null | undefined) {
  if (path === undefined) return {};
  if (path === null) {
    if (actor.isLocationScoped) throw ApiError.forbidden("A location is required for your role", "OUT_OF_SCOPE");
    return { locationId: null, stateId: null, districtId: null, cityId: null };
  }
  const refs = await resolveLocation(path);
  if (!inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
  return { locationId: refs.locationId, stateId: refs.stateId, districtId: refs.districtId, cityId: refs.cityId };
}

export async function createEvent(actor: Actor, input: CreateEventInput, ip?: string) {
  assertManager(actor);
  if (!input.isOnline && !input.locationPath) throw ApiError.badRequest("Choose a location or mark the event as online", undefined, "INVALID_LOCATION");
  if (input.isOnline && !input.onlineUrl && !input.locationPath) throw ApiError.badRequest("Online events need a join link", undefined, "INVALID_ONLINE_URL");

  const [loc, orgId] = await Promise.all([locationData(actor, input.locationPath ?? null), organizationId(input.organizationSlug)]);
  const slug = await uniqueSlug(input.slug ?? input.translations.en?.title ?? "event", async (s) => !!(await prisma.event.findUnique({ where: { slug: s }, select: { id: true } })));
  const translations = translationRows(input.translations, cleanTranslation);

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        ...(scalars(input) as Prisma.EventUncheckedCreateInput),
        ...loc,
        slug,
        category: input.category,
        startsAt: input.startsAt,
        status: "DRAFT",
        organizationId: orgId ?? null,
        createdById: actor.id,
        translations: { create: translations },
      },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "event.create", entityType: "Event", entityId: event.id, ip });
    return event;
  });
}

async function loadForWrite(id: string) {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw ApiError.notFound("Event not found");
  return event;
}

export async function updateEvent(actor: Actor, id: string, input: UpdateEventInput, ip?: string) {
  const event = await loadForWrite(id);
  assertManager(actor, event);

  // Validate the merged result, not just the patch: moving only the start must still keep end >= start.
  const startsAt = input.startsAt ?? event.startsAt;
  const endsAt = input.endsAt !== undefined ? input.endsAt : event.endsAt;
  const deadline = input.registrationDeadline !== undefined ? input.registrationDeadline : event.registrationDeadline;
  if (endsAt && endsAt < startsAt) throw ApiError.badRequest("End must be after start", undefined, "INVALID_DATES");
  if (deadline && deadline > (endsAt ?? startsAt)) throw ApiError.badRequest("Registration must close before the event ends", undefined, "INVALID_DATES");
  if (input.capacity != null && input.capacity < event.seatsTaken) {
    throw ApiError.badRequest(`Capacity cannot be below the ${event.seatsTaken} seats already booked`, undefined, "CAPACITY_TOO_LOW");
  }

  const [loc, orgId] = await Promise.all([locationData(actor, input.locationPath), organizationId(input.organizationSlug)]);
  const translations = translationRows(input.translations, cleanTranslation);

  return prisma.$transaction(async (tx) => {
    for (const { lang, ...data } of translations) {
      await tx.eventTranslation.upsert({ where: { eventId_lang: { eventId: id, lang } }, create: { eventId: id, lang, ...data }, update: data });
    }
    const updated = await tx.event.update({
      where: { id },
      data: { ...(scalars(input) as Prisma.EventUncheckedUpdateInput), ...loc, ...(orgId !== undefined ? { organizationId: orgId } : {}) },
      select: { id: true, slug: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "event.update", entityType: "Event", entityId: id, ip });
    return updated;
  });
}

export type EventAction = Extract<WorkflowAction, "publish" | "unpublish" | "archive" | "restore">;

export async function transitionEvent(actor: Actor, id: string, action: EventAction, ip?: string) {
  const event = await loadForWrite(id);
  assertManager(actor, event);
  const to: ContentStatus = nextStatus(event.status, action);
  if (action === "publish" && (await prisma.eventTranslation.count({ where: { eventId: id } })) === 0) {
    throw ApiError.badRequest("Event has no content", undefined, "EMPTY_CONTENT");
  }
  const now = new Date();
  const data: Prisma.EventUpdateInput = { status: to };
  if (action === "publish") Object.assign(data, { publishedAt: event.publishedAt ?? now, reviewedById: actor.id, reviewedAt: now });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({ where: { id }, data, select: { id: true, slug: true, status: true } });
    await audit(tx, { actorId: actor.id, action: `event.${action}`, entityType: "Event", entityId: id, meta: { from: event.status, to }, ip });
    return updated;
  });
}

const manageSelect = {
  id: true,
  slug: true,
  status: true,
  category: true,
  startsAt: true,
  endsAt: true,
  isFeatured: true,
  registrationEnabled: true,
  capacity: true,
  seatsTaken: true,
  updatedAt: true,
  location: { select: { path: true, nameHi: true, nameEn: true } },
  translations: { select: { lang: true, title: true } },
  _count: { select: { registrations: { where: { status: "CONFIRMED" } } } },
} satisfies Prisma.EventSelect;

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; when: "upcoming" | "past" | "all"; q?: string }) {
  assertManager(actor);
  const where: Prisma.EventWhereInput = {
    AND: [
      scopeWhere(actor),
      whenWhere(p.when),
      p.status ? { status: p.status } : {},
      p.q ? { translations: { some: { title: { contains: p.q, mode: "insensitive" } } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.event.findMany({ where, select: manageSelect, orderBy: [{ startsAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.event.count({ where }),
  ]);
  return toPage(
    rows.map(({ _count, ...r }) => ({ ...r, registrations: _count.registrations, translations: byLang(r.translations) })),
    total,
    p.page,
    p.limit
  );
}

export async function getForManage(actor: Actor, id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: { translations: true, location: { select: { path: true } }, organization: { select: { slug: true } } },
  });
  if (!event || !can(actor, "event.manage") || !inScope(actor, event)) throw ApiError.notFound("Event not found");
  return { ...event, translations: byLang(event.translations), gallery: Array.isArray(event.gallery) ? event.gallery : [] };
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

export async function register(actor: Actor, eventId: string, input: RegisterInput, ip?: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") throw ApiError.notFound("Event not found");
  const state = registrationState(event);
  if (!event.registrationEnabled || state.closesAt <= new Date()) throw new ApiError(409, "Registration is closed for this event", undefined, "REGISTRATION_CLOSED");

  const existing = await prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } } });
  if (existing?.status === "CONFIRMED") throw new ApiError(409, "You are already registered for this event", undefined, "ALREADY_REGISTERED");

  const name = cleanText(input.name);
  const note = input.note ? cleanText(input.note) : null;

  return prisma.$transaction(async (tx) => {
    // One atomic statement reserves the seats, so two people can never take the last seat together.
    const reserved = await tx.$executeRaw`UPDATE "Event" SET "seatsTaken" = "seatsTaken" + ${input.attendees}, "updatedAt" = NOW() WHERE "id" = ${eventId} AND ("capacity" IS NULL OR "seatsTaken" + ${input.attendees} <= "capacity")`;
    if (reserved === 0) throw new ApiError(409, "Sorry, the event is full", undefined, "EVENT_FULL");

    const data = { name, phone: input.phone, attendees: input.attendees, note, status: "CONFIRMED" as const, cancelledAt: null };
    const reg = existing
      ? await tx.eventRegistration.update({ where: { id: existing.id }, data })
      : await tx.eventRegistration.create({ data: { ...data, eventId, userId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "event.register", entityType: "EventRegistration", entityId: reg.id, meta: { eventId, attendees: input.attendees }, ip });
    return { id: reg.id, status: reg.status, attendees: reg.attendees, createdAt: reg.createdAt };
  });
}

export async function cancelRegistration(actor: Actor, eventId: string, ip?: string) {
  const reg = await prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } }, include: { event: { select: { startsAt: true } } } });
  if (!reg || reg.status !== "CONFIRMED") throw ApiError.notFound("No active registration");
  if (reg.event.startsAt <= new Date()) throw new ApiError(409, "The event has already started", undefined, "REGISTRATION_CLOSED");

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Event" SET "seatsTaken" = GREATEST(0, "seatsTaken" - ${reg.attendees}), "updatedAt" = NOW() WHERE "id" = ${eventId}`;
    const updated = await tx.eventRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelledAt: new Date() }, select: { id: true, status: true } });
    await audit(tx, { actorId: actor.id, action: "event.unregister", entityType: "EventRegistration", entityId: reg.id, meta: { eventId }, ip });
    return updated;
  });
}

/** The signed-in member's own registrations (account page). */
export async function myRegistrations(actor: Actor) {
  const rows = await prisma.eventRegistration.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      attendees: true,
      createdAt: true,
      event: { select: { id: true, slug: true, status: true, startsAt: true, endsAt: true, coverImageUrl: true, translations: { select: { lang: true, title: true, venue: true } } } },
    },
  });
  return {
    items: rows
      .filter((r) => r.event.status === "PUBLISHED")
      .map((r) => ({ ...r, event: { ...r.event, translations: byLang(r.event.translations), isPast: ended(r.event) } })),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function listRegistrations(actor: Actor, eventId: string, p: { page: number; limit: number; status?: "CONFIRMED" | "CANCELLED"; format: "json" | "csv" }) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, slug: true, locationId: true, stateId: true, districtId: true, cityId: true } });
  if (!event) throw ApiError.notFound("Event not found");
  assertManager(actor, event);

  const where: Prisma.EventRegistrationWhereInput = { eventId, ...(p.status ? { status: p.status } : {}) };
  const select = { id: true, name: true, phone: true, attendees: true, note: true, status: true, createdAt: true, cancelledAt: true, user: { select: { email: true } } } as const;

  if (p.format === "csv") {
    const rows = await prisma.eventRegistration.findMany({ where, select, orderBy: { createdAt: "asc" }, take: 20_000 });
    const header = ["Name", "Phone", "Email", "Attendees", "Status", "Registered at", "Note"];
    const lines = rows.map((r) => [r.name, r.phone, r.user.email, r.attendees, r.status, r.createdAt.toISOString(), r.note].map(csvCell).join(","));
    await audit(prisma, { actorId: actor.id, action: "event.registrations.export", entityType: "Event", entityId: eventId, meta: { rows: rows.length } });
    return { csv: [header.map(csvCell).join(","), ...lines].join("\r\n"), filename: `${event.slug}-registrations.csv` };
  }

  const [rows, total, sums] = await Promise.all([
    prisma.eventRegistration.findMany({ where, select, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.eventRegistration.count({ where }),
    prisma.eventRegistration.aggregate({ where: { eventId, status: "CONFIRMED" }, _sum: { attendees: true }, _count: true }),
  ]);
  return {
    ...toPage(rows.map(({ user, ...r }) => ({ ...r, email: user.email })), total, p.page, p.limit),
    summary: { confirmed: sums._count, attendees: sums._sum.attendees ?? 0 },
  };
}
