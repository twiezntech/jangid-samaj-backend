import { Prisma, type ContentStatus, type InterestStatus, type VerificationStatus } from "@prisma/client";
import { randomInt } from "crypto";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor, can, inScope, scopeWhere } from "../../lib/access";
import { audit } from "../../lib/audit";
import { notify, notifyReview } from "../../lib/notify";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { nextStatus } from "../../lib/workflow";
import { locationWhere, resolveLocation } from "../locations/location.service";
import type { CreateProfileInput, SearchQuery, UpdateProfileInput } from "./matrimony.schemas";

const MANAGE = "matrimony.manage";
const DAILY_INTERESTS = 20;
/** Legal minimum marriage age in India. */
const MIN_AGE = { MALE: 21, FEMALE: 18 } as const;
/** Changing these on a live profile sends it back for review. */
const SENSITIVE = ["name", "dateOfBirth", "gender", "photos"] as const;

const todayIst = () => new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
const yearsBefore = (d: Date, years: number) => new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));

export function ageOf(dob: Date, on = todayIst()) {
  let a = on.getUTCFullYear() - dob.getUTCFullYear();
  if (on.getUTCMonth() < dob.getUTCMonth() || (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate())) a -= 1;
  return a;
}

// ---------------------------------------------------------------------------
// Viewer context
// ---------------------------------------------------------------------------

const mineSelect = { id: true, code: true, status: true, isHidden: true, gender: true, gotraId: true, motherGotraId: true } as const;
type Mine = Prisma.MatrimonyProfileGetPayload<{ select: typeof mineSelect }>;

const myProfile = (userId: string) => prisma.matrimonyProfile.findUnique({ where: { userId }, select: mineSelect });

async function requireLiveProfile(actor: Actor): Promise<Mine> {
  const me = await myProfile(actor.id);
  if (!me) throw ApiError.forbidden("Create your matrimony profile first", "NO_PROFILE");
  if (me.status !== "PUBLISHED") throw ApiError.forbidden("Your profile is still under review", "PROFILE_NOT_LIVE");
  return me;
}

/** Profile ids hidden from me because one of us blocked the other. */
async function blockedIds(profileId: string) {
  const rows = await prisma.matrimonyBlock.findMany({ where: { OR: [{ ownerId: profileId }, { targetId: profileId }] }, select: { ownerId: true, targetId: true } });
  return [...new Set(rows.map((r) => (r.ownerId === profileId ? r.targetId : r.ownerId)))];
}

/** Profiles I have an accepted interest with (either direction): their photos and contact are open to me. */
async function acceptedWith(profileId: string, others: string[]) {
  if (!others.length) return new Set<string>();
  const rows = await prisma.matrimonyInterest.findMany({
    where: { status: "ACCEPTED", OR: [{ fromId: profileId, toId: { in: others } }, { toId: profileId, fromId: { in: others } }] },
    select: { fromId: true, toId: true },
  });
  return new Set(rows.map((r) => (r.fromId === profileId ? r.toId : r.fromId)));
}

// ---------------------------------------------------------------------------
// Cards and details
// ---------------------------------------------------------------------------

const gotraRef = { select: { id: true, nameEn: true, nameHi: true } } as const;

const cardSelect = {
  id: true,
  code: true,
  name: true,
  gender: true,
  dateOfBirth: true,
  heightCm: true,
  maritalStatus: true,
  educationLevel: true,
  education: true,
  profession: true,
  verification: true,
  photos: true,
  photoVisibility: true,
  lastActiveAt: true,
  gotra: gotraRef,
  location: { select: { path: true, nameHi: true, nameEn: true } },
} satisfies Prisma.MatrimonyProfileSelect;

type CardRow = Prisma.MatrimonyProfileGetPayload<{ select: typeof cardSelect }>;

function toCard({ dateOfBirth, photos, photoVisibility, ...r }: CardRow, open: boolean) {
  const showPhoto = photoVisibility === "MEMBERS" || open;
  return { ...r, age: ageOf(dateOfBirth), photo: showPhoto ? photos[0] ?? null : null, photoLocked: !showPhoto && photos.length > 0, photoCount: photos.length };
}

export async function search(actor: Actor, q: SearchQuery) {
  const me = await myProfile(actor.id);
  const today = todayIst();
  const hidden = me ? [me.id, ...(await blockedIds(me.id))] : [];
  const gender = q.gender ?? (me ? (me.gender === "MALE" ? "FEMALE" : "MALE") : undefined);
  const myGotras = me ? [me.gotraId, me.motherGotraId].filter((g): g is string => !!g) : [];

  const where: Prisma.MatrimonyProfileWhereInput = {
    AND: [
      { status: "PUBLISHED", isHidden: false },
      hidden.length ? { id: { notIn: hidden } } : {},
      gender ? { gender } : {},
      q.ageMin ? { dateOfBirth: { lte: yearsBefore(today, q.ageMin) } } : {},
      q.ageMax ? { dateOfBirth: { gt: yearsBefore(today, q.ageMax + 1) } } : {},
      await locationWhere(q.location),
      q.education?.length ? { educationLevel: { in: q.education } } : {},
      q.marital?.length ? { maritalStatus: { in: q.marital } } : {},
      q.manglik ? { manglik: q.manglik } : {},
      // Spelled out with explicit nulls: "NOT IN" alone would also drop profiles that left the gotra empty.
      q.excludeMyGotra && myGotras.length
        ? { AND: [{ OR: [{ gotraId: null }, { gotraId: { notIn: myGotras } }] }, { OR: [{ motherGotraId: null }, { motherGotraId: { notIn: myGotras } }] }] }
        : {},
      q.withPhoto ? { photos: { isEmpty: false } } : {},
      q.verified ? { verification: "VERIFIED" } : {},
      q.q ? { OR: [{ code: { equals: q.q.toUpperCase() } }, { profession: { contains: q.q, mode: "insensitive" } }, { education: { contains: q.q, mode: "insensitive" } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.matrimonyProfile.findMany({ where, select: cardSelect, orderBy: [{ verification: "desc" }, { lastActiveAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.matrimonyProfile.count({ where }),
  ]);
  const open = me ? await acceptedWith(me.id, rows.map((r) => r.id)) : new Set<string>();
  const shortlisted = me
    ? new Set((await prisma.matrimonyShortlist.findMany({ where: { ownerId: me.id, targetId: { in: rows.map((r) => r.id) } }, select: { targetId: true } })).map((s) => s.targetId))
    : new Set<string>();
  return {
    ...toPage(rows.map((r) => ({ ...toCard(r, open.has(r.id)), shortlisted: shortlisted.has(r.id) })), total, q.page, q.limit),
    me: me ? { code: me.code, status: me.status, isHidden: me.isHidden } : null,
  };
}

const detailSelect = {
  ...cardSelect,
  userId: true,
  status: true,
  isHidden: true,
  profileFor: true,
  manglik: true,
  income: true,
  nativePlace: true,
  fatherName: true,
  fatherOccupation: true,
  motherName: true,
  siblings: true,
  about: true,
  prefAgeMin: true,
  prefAgeMax: true,
  prefNotes: true,
  contactPhone: true,
  contactWhatsapp: true,
  motherGotra: gotraRef,
  createdAt: true,
} satisfies Prisma.MatrimonyProfileSelect;

/** Full profile for a signed-in member. Contact (and locked photos) only after an accepted interest. */
export async function getByCode(actor: Actor, code: string) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { code }, select: detailSelect });
  const me = await myProfile(actor.id);
  const own = p?.userId === actor.id;
  if (!p || (!own && (p.status !== "PUBLISHED" || p.isHidden))) throw ApiError.notFound("Profile not found");

  let relation = { sent: null as InterestStatus | null, received: null as InterestStatus | null, receivedId: null as string | null, shortlisted: false, blocked: false };
  if (me && !own) {
    const [sent, received, sl, block, blockedMe] = await Promise.all([
      prisma.matrimonyInterest.findUnique({ where: { fromId_toId: { fromId: me.id, toId: p.id } }, select: { status: true } }),
      prisma.matrimonyInterest.findUnique({ where: { fromId_toId: { fromId: p.id, toId: me.id } }, select: { id: true, status: true } }),
      prisma.matrimonyShortlist.findUnique({ where: { ownerId_targetId: { ownerId: me.id, targetId: p.id } } }),
      prisma.matrimonyBlock.findUnique({ where: { ownerId_targetId: { ownerId: me.id, targetId: p.id } } }),
      prisma.matrimonyBlock.findUnique({ where: { ownerId_targetId: { ownerId: p.id, targetId: me.id } } }),
    ]);
    if (blockedMe) throw ApiError.notFound("Profile not found");
    relation = { sent: sent?.status ?? null, received: received?.status ?? null, receivedId: received?.id ?? null, shortlisted: !!sl, blocked: !!block };
  }
  const open = own || relation.sent === "ACCEPTED" || relation.received === "ACCEPTED";
  const { userId, contactPhone, contactWhatsapp, photos, photoVisibility, dateOfBirth, ...rest } = p;
  void userId;
  const showPhotos = own || photoVisibility === "MEMBERS" || open;
  return {
    ...rest,
    age: ageOf(dateOfBirth),
    photos: showPhotos ? photos : [],
    photoLocked: !showPhotos && photos.length > 0,
    photoCount: photos.length,
    contact: open ? { phone: contactPhone, whatsapp: contactWhatsapp } : null,
    own,
    relation,
    canInterest: !own && !!me && me.status === "PUBLISHED",
  };
}

// ---------------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------------

function clean(input: Partial<CreateProfileInput>) {
  const t = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : cleanText(v) || null);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "locationPath") continue;
    out[k] = typeof v === "string" && !["gender", "maritalStatus", "manglik", "educationLevel", "income", "profileFor", "photoVisibility", "gotraId", "motherGotraId", "contactPhone", "contactWhatsapp"].includes(k) ? t(v) : v;
  }
  if (typeof out.name === "string" && out.name.length < 2) throw ApiError.badRequest("Name must contain text", undefined, "EMPTY_CONTENT");
  return out;
}

function checkAge(gender: "MALE" | "FEMALE", dob: Date) {
  const a = ageOf(dob);
  if (a < MIN_AGE[gender]) throw ApiError.badRequest(`Minimum age is ${MIN_AGE[gender]} years`, undefined, "UNDER_AGE");
  if (a > 80) throw ApiError.badRequest("Please check the date of birth", undefined, "INVALID_DOB");
}

async function checkGotras(...ids: (string | null | undefined)[]) {
  const want = ids.filter((x): x is string => !!x);
  if (!want.length) return;
  const found = await prisma.gotra.count({ where: { id: { in: want }, isActive: true } });
  if (found !== new Set(want).size) throw ApiError.badRequest("Unknown gotra", undefined, "INVALID_GOTRA");
}

async function newCode() {
  for (let i = 0; i < 10; i++) {
    const code = `JS${randomInt(10_000, 99_999)}`;
    if (!(await prisma.matrimonyProfile.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return `JS${randomInt(1_000_000, 9_999_999)}`;
}

const denormalised = (r: Awaited<ReturnType<typeof resolveLocation>>) => ({ locationId: r.locationId, stateId: r.stateId, districtId: r.districtId, cityId: r.cityId });

export async function getMine(actor: Actor) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { userId: actor.id }, include: { gotra: gotraRef, motherGotra: gotraRef, location: { select: { path: true } } } });
  if (!p) return { profile: null };
  const [received, sent, accepted] = await Promise.all([
    prisma.matrimonyInterest.count({ where: { toId: p.id, status: "PENDING" } }),
    prisma.matrimonyInterest.count({ where: { fromId: p.id, status: "PENDING" } }),
    prisma.matrimonyInterest.count({ where: { status: "ACCEPTED", OR: [{ fromId: p.id }, { toId: p.id }] } }),
  ]);
  return { profile: p, stats: { received, sent, accepted } };
}

export async function createProfile(actor: Actor, input: CreateProfileInput, ip?: string) {
  if (await myProfile(actor.id)) throw new ApiError(409, "You already have a matrimony profile", undefined, "PROFILE_EXISTS");
  checkAge(input.gender, input.dateOfBirth);
  await checkGotras(input.gotraId, input.motherGotraId);
  const refs = await resolveLocation(input.locationPath);
  const code = await newCode();
  const data = clean(input) as Omit<Prisma.MatrimonyProfileUncheckedCreateInput, "code" | "userId">;

  return prisma.$transaction(async (tx) => {
    const created = await tx.matrimonyProfile.create({
      data: { ...data, code, userId: actor.id, status: "PENDING_REVIEW", ...denormalised(refs) },
      select: { id: true, code: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "matrimony.create", entityType: "MatrimonyProfile", entityId: created.id, ip });
    return created;
  });
}

export async function updateMine(actor: Actor, input: UpdateProfileInput, ip?: string) {
  const current = await prisma.matrimonyProfile.findUnique({ where: { userId: actor.id } });
  if (!current) throw ApiError.notFound("Profile not found");
  if (current.status === "ARCHIVED") throw ApiError.forbidden("This profile was removed by the moderators", "FORBIDDEN");
  const gender = input.gender ?? current.gender;
  const dob = input.dateOfBirth ?? current.dateOfBirth;
  if (input.gender || input.dateOfBirth) checkAge(gender, dob);
  await checkGotras(input.gotraId, input.motherGotraId);
  const pMin = input.prefAgeMin !== undefined ? input.prefAgeMin : current.prefAgeMin;
  const pMax = input.prefAgeMax !== undefined ? input.prefAgeMax : current.prefAgeMax;
  if (pMin != null && pMax != null && pMin > pMax) throw ApiError.badRequest("Minimum age cannot be above the maximum");

  const loc = input.locationPath ? denormalised(await resolveLocation(input.locationPath)) : {};
  const sensitive = SENSITIVE.some((k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(current[k]));
  // A returned (or restored) profile goes back to the queue on any edit; a live one only when identity or photos change.
  const status: ContentStatus = current.status === "REJECTED" || current.status === "DRAFT" || (current.status === "PUBLISHED" && sensitive) ? "PENDING_REVIEW" : current.status;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.matrimonyProfile.update({
      where: { id: current.id },
      data: { ...(clean(input) as Prisma.MatrimonyProfileUncheckedUpdateInput), ...loc, status, ...(status === "PENDING_REVIEW" && current.status !== "PENDING_REVIEW" ? { verification: current.verification === "VERIFIED" && !sensitive ? "VERIFIED" : "UNVERIFIED" } : {}), lastActiveAt: new Date() },
      select: { id: true, code: true, status: true },
    });
    await audit(tx, { actorId: actor.id, action: "matrimony.update", entityType: "MatrimonyProfile", entityId: current.id, meta: { fields: Object.keys(input), status }, ip });
    return updated;
  });
}

export async function setHidden(actor: Actor, hidden: boolean, ip?: string) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!p) throw ApiError.notFound("Profile not found");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.matrimonyProfile.update({ where: { id: p.id }, data: { isHidden: hidden }, select: { id: true, isHidden: true } });
    await audit(tx, { actorId: actor.id, action: hidden ? "matrimony.hide" : "matrimony.unhide", entityType: "MatrimonyProfile", entityId: p.id, ip });
    return updated;
  });
}

/** Deletes the profile, its photos list, interests, shortlists and blocks (cascade). */
export async function deleteMine(actor: Actor, ip?: string) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { userId: actor.id }, select: { id: true, code: true } });
  if (!p) throw ApiError.notFound("Profile not found");
  await prisma.$transaction(async (tx) => {
    await tx.matrimonyProfile.delete({ where: { id: p.id } });
    await audit(tx, { actorId: actor.id, action: "matrimony.delete", entityType: "MatrimonyProfile", entityId: p.id, meta: { code: p.code }, ip });
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Interests, shortlist, block
// ---------------------------------------------------------------------------

async function liveTarget(code: string, me: Mine) {
  const t = await prisma.matrimonyProfile.findUnique({ where: { code }, select: { id: true, userId: true, status: true, isHidden: true, code: true, name: true } });
  if (!t || t.status !== "PUBLISHED" || t.isHidden || t.id === me.id) throw ApiError.notFound("Profile not found");
  if ((await blockedIds(me.id)).includes(t.id)) throw ApiError.notFound("Profile not found");
  return t;
}

export async function sendInterest(actor: Actor, code: string, message: string | undefined, ip?: string) {
  const me = await requireLiveProfile(actor);
  const target = await liveTarget(code, me);
  const reverse = await prisma.matrimonyInterest.findUnique({ where: { fromId_toId: { fromId: target.id, toId: me.id } }, select: { status: true } });
  if (reverse?.status === "PENDING" || reverse?.status === "ACCEPTED") throw new ApiError(409, "They have already sent you an interest — respond to it instead", undefined, "INTEREST_RECEIVED");
  const sentToday = await prisma.matrimonyInterest.count({ where: { fromId: me.id, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
  if (sentToday >= DAILY_INTERESTS) throw new ApiError(429, `You can send up to ${DAILY_INTERESTS} interests a day`, undefined, "INTEREST_LIMIT");

  const existing = await prisma.matrimonyInterest.findUnique({ where: { fromId_toId: { fromId: me.id, toId: target.id } } });
  if (existing && existing.status !== "WITHDRAWN") throw new ApiError(409, "Interest already sent", undefined, "ALREADY_SENT");
  const msg = message ? cleanText(message) || null : null;

  return prisma.$transaction(async (tx) => {
    const i = existing
      ? await tx.matrimonyInterest.update({ where: { id: existing.id }, data: { status: "PENDING", message: msg, respondedAt: null, createdAt: new Date() }, select: { id: true, status: true } })
      : await tx.matrimonyInterest.create({ data: { fromId: me.id, toId: target.id, message: msg }, select: { id: true, status: true } });
    await tx.matrimonyProfile.update({ where: { id: me.id }, data: { lastActiveAt: new Date() } });
    await notify(tx, target.userId, { type: "INTEREST", title: { hi: `${me.code} ने आपकी प्रोफाइल में रुचि दिखाई`, en: `${me.code} is interested in your profile` }, link: "/rishte/interests" });
    await audit(tx, { actorId: actor.id, action: "matrimony.interest.send", entityType: "MatrimonyInterest", entityId: i.id, meta: { to: target.code }, ip });
    return i;
  });
}

export async function withdrawInterest(actor: Actor, code: string, ip?: string) {
  const me = await requireLiveProfile(actor);
  const t = await prisma.matrimonyProfile.findUnique({ where: { code }, select: { id: true } });
  const i = t && (await prisma.matrimonyInterest.findUnique({ where: { fromId_toId: { fromId: me.id, toId: t.id } } }));
  if (!i || i.status !== "PENDING") throw ApiError.notFound("No pending interest to withdraw");
  return prisma.$transaction(async (tx) => {
    const u = await tx.matrimonyInterest.update({ where: { id: i.id }, data: { status: "WITHDRAWN" }, select: { id: true, status: true } });
    await audit(tx, { actorId: actor.id, action: "matrimony.interest.withdraw", entityType: "MatrimonyInterest", entityId: i.id, ip });
    return u;
  });
}

export async function respondInterest(actor: Actor, interestId: string, accept: boolean, ip?: string) {
  const me = await requireLiveProfile(actor);
  const i = await prisma.matrimonyInterest.findUnique({ where: { id: interestId }, include: { from: { select: { userId: true, code: true } } } });
  if (!i || i.toId !== me.id) throw ApiError.notFound("Interest not found");
  if (i.status !== "PENDING") throw new ApiError(409, "This interest was already answered", undefined, "INVALID_TRANSITION");
  return prisma.$transaction(async (tx) => {
    const u = await tx.matrimonyInterest.update({ where: { id: i.id }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() }, select: { id: true, status: true } });
    if (accept) {
      await notify(tx, i.from.userId, {
        type: "INTEREST_ACCEPTED",
        title: { hi: `${me.code} ने आपकी रुचि स्वीकार की — संपर्क विवरण देखें`, en: `${me.code} accepted your interest — contact details are now visible` },
        link: `/rishte/${me.code}`,
      });
    }
    await audit(tx, { actorId: actor.id, action: accept ? "matrimony.interest.accept" : "matrimony.interest.decline", entityType: "MatrimonyInterest", entityId: i.id, ip });
    return u;
  });
}

export async function listInterests(actor: Actor, p: { page: number; limit: number; box: "received" | "sent"; status?: InterestStatus }) {
  const me = await myProfile(actor.id);
  if (!me) return { ...toPage([], 0, p.page, p.limit) };
  const where: Prisma.MatrimonyInterestWhereInput = { ...(p.box === "received" ? { toId: me.id } : { fromId: me.id }), ...(p.status ? { status: p.status } : { status: { not: "WITHDRAWN" } }) };
  const other = p.box === "received" ? "from" : "to";
  const [rows, total] = await Promise.all([
    prisma.matrimonyInterest.findMany({ where, select: { id: true, status: true, message: true, createdAt: true, respondedAt: true, [other]: { select: cardSelect } }, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.matrimonyInterest.count({ where }),
  ]);
  const items = rows.map((r) => {
    const card = (r as unknown as Record<string, CardRow>)[other];
    return { id: r.id, status: r.status, message: r.message, createdAt: r.createdAt, respondedAt: r.respondedAt, profile: toCard(card, r.status === "ACCEPTED") };
  });
  return toPage(items, total, p.page, p.limit);
}

export async function setShortlist(actor: Actor, code: string, on: boolean) {
  const me = await requireLiveProfile(actor);
  const t = await liveTarget(code, me);
  if (on) await prisma.matrimonyShortlist.upsert({ where: { ownerId_targetId: { ownerId: me.id, targetId: t.id } }, create: { ownerId: me.id, targetId: t.id }, update: {} });
  else await prisma.matrimonyShortlist.deleteMany({ where: { ownerId: me.id, targetId: t.id } });
  return { shortlisted: on };
}

export async function listShortlist(actor: Actor, p: { page: number; limit: number }) {
  const me = await myProfile(actor.id);
  if (!me) return toPage([], 0, p.page, p.limit);
  const where: Prisma.MatrimonyShortlistWhereInput = { ownerId: me.id, target: { status: "PUBLISHED", isHidden: false } };
  const [rows, total] = await Promise.all([
    prisma.matrimonyShortlist.findMany({ where, select: { target: { select: cardSelect } }, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.matrimonyShortlist.count({ where }),
  ]);
  const open = await acceptedWith(me.id, rows.map((r) => r.target.id));
  return toPage(rows.map((r) => ({ ...toCard(r.target, open.has(r.target.id)), shortlisted: true })), total, p.page, p.limit);
}

/** Blocking also closes any pending interest between the two profiles. */
export async function setBlock(actor: Actor, code: string, on: boolean, ip?: string) {
  const me = await requireLiveProfile(actor);
  const t = await prisma.matrimonyProfile.findUnique({ where: { code }, select: { id: true } });
  if (!t || t.id === me.id) throw ApiError.notFound("Profile not found");
  await prisma.$transaction(async (tx) => {
    if (on) {
      await tx.matrimonyBlock.upsert({ where: { ownerId_targetId: { ownerId: me.id, targetId: t.id } }, create: { ownerId: me.id, targetId: t.id }, update: {} });
      await tx.matrimonyInterest.updateMany({ where: { status: "PENDING", OR: [{ fromId: me.id, toId: t.id }, { fromId: t.id, toId: me.id }] }, data: { status: "DECLINED", respondedAt: new Date() } });
      await tx.matrimonyShortlist.deleteMany({ where: { ownerId: me.id, targetId: t.id } });
    } else {
      await tx.matrimonyBlock.deleteMany({ where: { ownerId: me.id, targetId: t.id } });
    }
    await audit(tx, { actorId: actor.id, action: on ? "matrimony.block" : "matrimony.unblock", entityType: "MatrimonyProfile", entityId: t.id, ip });
  });
  return { blocked: on };
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export async function listForManage(actor: Actor, p: { page: number; limit: number; status?: ContentStatus; verification?: VerificationStatus; gender?: "MALE" | "FEMALE"; q?: string }) {
  if (!can(actor, MANAGE)) throw ApiError.forbidden("Insufficient permissions", "FORBIDDEN");
  const where: Prisma.MatrimonyProfileWhereInput = {
    AND: [
      scopeWhere(actor),
      p.status ? { status: p.status } : {},
      p.verification ? { verification: p.verification } : {},
      p.gender ? { gender: p.gender } : {},
      p.q ? { OR: [{ code: { equals: p.q.toUpperCase() } }, { name: { contains: p.q, mode: "insensitive" } }, { contactPhone: { contains: p.q } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.matrimonyProfile.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        gender: true,
        dateOfBirth: true,
        status: true,
        verification: true,
        isHidden: true,
        photos: true,
        rejectionReason: true,
        updatedAt: true,
        location: { select: { path: true, nameHi: true, nameEn: true } },
        user: { select: { email: true } },
        _count: { select: { receivedInterests: true, sentInterests: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.matrimonyProfile.count({ where }),
  ]);
  const reports = await prisma.contentReport.groupBy({ by: ["targetId"], where: { targetType: "MATRIMONY", status: { not: "CLOSED" }, targetId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const rc = new Map(reports.map((r) => [r.targetId, r._count._all]));
  return toPage(
    rows.map(({ dateOfBirth, photos, _count, ...r }) => ({ ...r, age: ageOf(dateOfBirth), photo: photos[0] ?? null, interests: _count.receivedInterests + _count.sentInterests, openReports: rc.get(r.id) ?? 0 })),
    total,
    p.page,
    p.limit
  );
}

export async function getForManage(actor: Actor, id: string) {
  const p = await prisma.matrimonyProfile.findUnique({
    where: { id },
    include: { gotra: gotraRef, motherGotra: gotraRef, location: { select: { path: true, nameHi: true, nameEn: true } }, user: { select: { id: true, email: true, name: true, createdAt: true } } },
  });
  if (!p || !(can(actor, MANAGE) && inScope(actor, p))) throw ApiError.notFound("Profile not found");
  const [interests, reports] = await Promise.all([
    prisma.matrimonyInterest.groupBy({ by: ["status"], where: { OR: [{ fromId: id }, { toId: id }] }, _count: { _all: true } }),
    prisma.contentReport.findMany({ where: { targetType: "MATRIMONY", targetId: id }, select: { id: true, reason: true, details: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { ...p, age: ageOf(p.dateOfBirth), interestStats: Object.fromEntries(interests.map((i) => [i.status, i._count._all])), reports };
}

export async function moderate(actor: Actor, id: string, action: "publish" | "reject" | "archive" | "restore", reason?: string, ip?: string) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { id } });
  if (!p || !(can(actor, MANAGE) && inScope(actor, p))) throw ApiError.notFound("Profile not found");
  if (action === "reject" && !reason) throw ApiError.badRequest("A rejection reason is required");
  const to = nextStatus(p.status, action);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.matrimonyProfile.update({
      where: { id },
      data: {
        status: to,
        ...(action === "publish" ? { reviewedById: actor.id, reviewedAt: now, rejectionReason: null } : {}),
        ...(action === "reject" ? { reviewedById: actor.id, reviewedAt: now, rejectionReason: reason } : {}),
        ...(to !== "PUBLISHED" ? { verification: p.verification === "VERIFIED" ? "UNVERIFIED" : p.verification } : {}),
      },
      select: { id: true, code: true, status: true, verification: true },
    });
    await audit(tx, { actorId: actor.id, action: `matrimony.${action}`, entityType: "MatrimonyProfile", entityId: id, meta: { from: p.status, to, ...(reason ? { reason } : {}) }, ip });
    await notifyReview(tx, { userId: p.userId, actorId: actor.id, kind: "matrimony", action, reason, link: `/rishte/${p.code}`, editLink: "/rishte/my-profile" });
    return updated;
  });
}

export async function setVerification(actor: Actor, id: string, verified: boolean, ip?: string) {
  const p = await prisma.matrimonyProfile.findUnique({ where: { id } });
  if (!p || !(can(actor, MANAGE) && inScope(actor, p))) throw ApiError.notFound("Profile not found");
  if (verified && p.status !== "PUBLISHED") throw new ApiError(409, "Only live profiles can be verified", undefined, "INVALID_TRANSITION");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.matrimonyProfile.update({ where: { id }, data: { verification: verified ? "VERIFIED" : "UNVERIFIED" }, select: { id: true, verification: true } });
    await audit(tx, { actorId: actor.id, action: verified ? "matrimony.verify" : "matrimony.unverify", entityType: "MatrimonyProfile", entityId: id, ip });
    return updated;
  });
}

export async function stats(actor: Actor) {
  if (!can(actor, MANAGE)) throw ApiError.forbidden("Insufficient permissions", "FORBIDDEN");
  const scope = scopeWhere(actor);
  const [live, pending, verified, interests30d, accepted30d, openReports] = await Promise.all([
    prisma.matrimonyProfile.count({ where: { ...scope, status: "PUBLISHED" } }),
    prisma.matrimonyProfile.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
    prisma.matrimonyProfile.count({ where: { ...scope, verification: "VERIFIED" } }),
    prisma.matrimonyInterest.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } } }),
    prisma.matrimonyInterest.count({ where: { status: "ACCEPTED", respondedAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } } }),
    prisma.contentReport.count({ where: { targetType: "MATRIMONY", status: { not: "CLOSED" } } }),
  ]);
  return { live, pending, verified, interests30d, accepted30d, openReports };
}
