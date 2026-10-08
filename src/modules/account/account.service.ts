import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { hashToken } from "../../utils/jwt";
import { invalidateActor } from "../../lib/access";
import { audit } from "../../lib/audit";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { resolveLocation } from "../locations/location.service";
import type { SavedTypeName, UpdateProfileInput } from "./account.schemas";

const BCRYPT_COST = 12;
const MAX_SAVED = 500;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSelect = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  avatarUrl: true,
  isEmailVerified: true,
  passwordHash: true,
  googleId: true,
  createdAt: true,
  role: { select: { name: true } },
  location: { select: { path: true, nameHi: true, nameEn: true } },
} satisfies Prisma.UserSelect;

function toProfile({ passwordHash, googleId, role, ...u }: Prisma.UserGetPayload<{ select: typeof profileSelect }>) {
  return { ...u, role: role?.name ?? "MEMBER", hasPassword: !!passwordHash, googleLinked: !!googleId };
}

export async function getProfile(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!u) throw ApiError.unauthorized();
  return toProfile(u);
}

export async function updateProfile(userId: string, input: UpdateProfileInput, ip?: string) {
  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name);
    if (name.length < 2) throw ApiError.badRequest("Name is too short");
    data.name = name;
  }
  if (input.mobile !== undefined) data.mobile = input.mobile;
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
  if (input.locationPath !== undefined) {
    data.location = input.locationPath ? { connect: { id: (await resolveLocation(input.locationPath)).locationId } } : { disconnect: true };
  }

  // A member's own location is only a preference; it never widens a staff member's authority.
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { role: { select: { isLocationScoped: true } } } });
  if (current?.role?.isLocationScoped && input.locationPath !== undefined) {
    throw ApiError.forbidden("Your area is assigned by an administrator", "OUT_OF_SCOPE");
  }

  try {
    const u = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data, select: profileSelect });
      await audit(tx, { actorId: userId, action: "account.update", entityType: "User", entityId: userId, meta: { fields: Object.keys(input) }, ip });
      return updated;
    });
    invalidateActor(userId);
    return toProfile(u);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "This mobile number is already linked to another account", undefined, "MOBILE_TAKEN");
    }
    throw e;
  }
}

/**
 * Members with a password must confirm it; Google-only members may set one for the first time.
 * Every other session is signed out; the current one stays.
 */
export async function changePassword(userId: string, input: { currentPassword?: string; newPassword: string }, currentRefresh: string | undefined, ip?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.unauthorized();
  if (user.passwordHash) {
    const ok = !!input.currentPassword && (await bcrypt.compare(input.currentPassword, user.passwordHash));
    if (!ok) throw ApiError.badRequest("Current password is incorrect", undefined, "WRONG_PASSWORD");
  }
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  const keep = currentRefresh ? await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(currentRefresh) }, select: { familyId: true } }) : null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null, ...(keep ? { familyId: { not: keep.familyId } } : {}) }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: userId, action: user.passwordHash ? "account.password.change" : "account.password.set", entityType: "User", entityId: userId, ip });
  });
  return { ok: true };
}

/**
 * "Delete my account": the person disappears (name, email, mobile, photo, bookmarks, matrimony
 * profile, inbox), while community content they published stays without their identity.
 */
export async function deleteAccount(userId: string, password: string | undefined, ip?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { name: true } } } });
  if (!user) throw ApiError.unauthorized();
  if (user.role && user.role.name !== "MEMBER") throw ApiError.forbidden("Staff accounts are removed by a super admin", "FORBIDDEN");
  if (user.passwordHash && !(password && (await bcrypt.compare(password, user.passwordHash)))) {
    throw ApiError.badRequest("Password is incorrect", undefined, "WRONG_PASSWORD");
  }

  await prisma.$transaction(async (tx) => {
    await tx.savedItem.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.matrimonyProfile.deleteMany({ where: { userId } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.update({
      where: { id: userId },
      data: { name: "Former member", email: null, mobile: null, passwordHash: null, googleId: null, avatarUrl: null, locationId: null, isActive: false },
    });
    await audit(tx, { actorId: userId, action: "account.delete", entityType: "User", entityId: userId, ip });
  });
  invalidateActor(userId);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Saved items (bookmarks)
// ---------------------------------------------------------------------------

type Tr = { lang: string; title?: string; name?: string }[];
const pickTitle = (t: Tr) => {
  const row = t.find((x) => x.lang === "hi") ?? t[0];
  return row?.title ?? row?.name ?? "";
};
const live = { status: "PUBLISHED" as const };

/** Confirms the item is public and captures what the "Saved" list shows. */
async function snapshot(type: SavedTypeName, slug: string): Promise<{ title: string; imageUrl: string | null } | null> {
  const where = { slug, ...live };
  switch (type) {
    case "NEWS": {
      const r = await prisma.news.findFirst({ where, select: { coverImageUrl: true, translations: { select: { lang: true, title: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.coverImageUrl };
    }
    case "BUSINESS": {
      const r = await prisma.business.findFirst({ where, select: { logoUrl: true, coverImageUrl: true, translations: { select: { lang: true, name: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.logoUrl ?? r.coverImageUrl };
    }
    case "EVENT": {
      const r = await prisma.event.findFirst({ where, select: { coverImageUrl: true, translations: { select: { lang: true, title: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.coverImageUrl };
    }
    case "DIRECTORY": {
      const r = await prisma.directoryEntry.findFirst({ where, select: { coverImageUrl: true, translations: { select: { lang: true, name: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.coverImageUrl };
    }
    case "LEADER": {
      const r = await prisma.leaderProfile.findFirst({ where, select: { photoUrl: true, translations: { select: { lang: true, name: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.photoUrl };
    }
    case "ACHIEVEMENT": {
      const r = await prisma.achievement.findFirst({ where, select: { photoUrl: true, translations: { select: { lang: true, title: true } } } });
      return r && { title: pickTitle(r.translations), imageUrl: r.photoUrl };
    }
    case "OBITUARY": {
      const r = await prisma.obituary.findFirst({ where, select: { photoUrl: true, translations: { select: { lang: true, name: true } } } });
      return r && { title: `स्व. ${pickTitle(r.translations)}`, imageUrl: r.photoUrl };
    }
  }
}

export async function save(userId: string, type: SavedTypeName, slug: string) {
  const snap = await snapshot(type, slug);
  if (!snap) throw ApiError.notFound("This item is not available");
  const count = await prisma.savedItem.count({ where: { userId } });
  if (count >= MAX_SAVED) throw new ApiError(409, `You can save up to ${MAX_SAVED} items`, undefined, "SAVED_LIMIT");
  return prisma.savedItem.upsert({
    where: { userId_type_slug: { userId, type, slug } },
    create: { userId, type, slug, ...snap },
    update: snap,
    select: { id: true, type: true, slug: true, title: true, imageUrl: true, createdAt: true },
  });
}

export async function unsave(userId: string, type: SavedTypeName, slug: string) {
  await prisma.savedItem.deleteMany({ where: { userId, type, slug } });
  return { saved: false };
}

export async function isSaved(userId: string, type: SavedTypeName, slug: string) {
  return { saved: !!(await prisma.savedItem.findUnique({ where: { userId_type_slug: { userId, type, slug } }, select: { id: true } })) };
}

export async function listSaved(userId: string, p: { page: number; limit: number; type?: SavedTypeName }) {
  const where = { userId, ...(p.type ? { type: p.type } : {}) };
  const [items, total] = await Promise.all([
    prisma.savedItem.findMany({ where, select: { id: true, type: true, slug: true, title: true, imageUrl: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.savedItem.count({ where }),
  ]);
  return toPage(items, total, p.page, p.limit);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const notificationSelect = { id: true, type: true, titleHi: true, titleEn: true, bodyHi: true, bodyEn: true, link: true, readAt: true, createdAt: true } satisfies Prisma.NotificationSelect;

export async function listNotifications(userId: string, p: { page: number; limit: number; unread?: boolean }) {
  const where: Prisma.NotificationWhereInput = { userId, ...(p.unread ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, select: notificationSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { ...toPage(items, total, p.page, p.limit), unread };
}

export const unreadCount = async (userId: string) => ({ unread: await prisma.notification.count({ where: { userId, readAt: null } }) });

export async function markRead(userId: string, id?: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  return unreadCount(userId);
}
