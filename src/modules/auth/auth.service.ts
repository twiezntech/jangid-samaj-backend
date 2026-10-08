import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import type { User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { hashToken, newOpaqueToken, signAccessToken } from "../../utils/jwt";
import { alreadyRegisteredMail, passwordResetMail, sendMail, verificationMail } from "../../utils/mailer";
import { loadActor } from "../../lib/access";

const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Compared against when the account doesn't exist so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-password", BCRYPT_COST);

const googleClient = new OAuth2Client();

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export function toPublicUser(u: User & { role?: { name: string } | null }) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    isEmailVerified: u.isEmailVerified,
    role: u.role?.name ?? "MEMBER",
  };
}

async function issueSession(userId: string, meta: SessionMeta, familyId: string = randomUUID()) {
  const refresh = newOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.hash,
      familyId,
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 24 * 60 * 60 * 1000),
      userAgent: meta.userAgent?.slice(0, 255),
      ip: meta.ip,
    },
  });
  return { accessToken: signAccessToken(userId), refreshToken: refresh.token };
}

function assertUsable(user: User) {
  if (!user.isActive || user.isSuspended) throw ApiError.forbidden("This account has been disabled");
}

const withRole = { role: true } as const;

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Creates a fresh verification link and emails it. Never throws: callers must not leak whether mail went out. */
async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name">) {
  if (!user.email) return;
  try {
    const recent = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    });
    if (recent) return;

    await prisma.emailVerificationToken.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] } });
    const { token, hash } = newOpaqueToken();
    await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + VERIFY_TTL_MS) } });
    await sendMail({ to: user.email, ...verificationMail(user.name, `${env.appUrl}/verify-email?token=${token}`) });
  } catch (err) {
    console.error("[verification-email] failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Sign-up never reveals whether an email is already registered: every case returns the same response.
 * The mailbox owner learns the truth from the email itself.
 */
export async function register(input: { name: string; email: string; password: string }) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST); // same cost on every path (timing)
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    if (existing.isEmailVerified) {
      if (existing.email) await sendMail({ to: existing.email, ...alreadyRegisteredMail() }).catch(() => undefined);
    } else if (existing.passwordHash) {
      await sendVerificationEmail(existing);
    }
    return { needsVerification: true as const };
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: { connectOrCreate: { where: { name: "MEMBER" }, create: { name: "MEMBER", description: "Regular community member" } } },
    },
  });
  await sendVerificationEmail(user);
  return { needsVerification: true as const };
}

export async function verifyEmail(token: string, meta: SessionMeta) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.expiresAt < new Date()) {
    throw ApiError.badRequest("This verification link is invalid or has expired.", undefined, "INVALID_TOKEN");
  }

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { isEmailVerified: true, lastLoginAt: new Date() },
    include: withRole,
  });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  assertUsable(user);
  return { user: toPublicUser(user), ...(await issueSession(user.id, meta)) };
}

/** Always resolves the same way so it can't be used to discover registered emails. */
export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.isEmailVerified && user.passwordHash) await sendVerificationEmail(user);
}

export async function login(input: { email: string; password: string }, meta: SessionMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: withRole });
  const invalid = () => ApiError.unauthorized("Invalid email or password");

  if (!user || !user.passwordHash) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(429, "Too many failed attempts. Please try again in a few minutes.");
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data:
        failed >= MAX_FAILED_LOGINS
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
          : { failedLogins: failed },
    });
    throw invalid();
  }
  assertUsable(user);
  if (!user.isEmailVerified) {
    throw ApiError.forbidden("Please verify your email before logging in.", "EMAIL_NOT_VERIFIED");
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return { user: toPublicUser(user), ...(await issueSession(user.id, meta)) };
}

export async function loginWithGoogle(credential: string, meta: SessionMeta) {
  if (!env.googleClientId) throw ApiError.badRequest("Google sign-in is not configured");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized("Google sign-in failed");
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw ApiError.unauthorized("Google account email is not verified");
  }

  const email = payload.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { googleId: payload.sub }, include: withRole });

  if (!user) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Google has verified this email. If the existing account was never email-verified, drop its password
      // so someone who pre-registered a victim's address can't keep access.
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: payload.sub,
          isEmailVerified: true,
          avatarUrl: existing.avatarUrl ?? payload.picture,
          ...(existing.isEmailVerified ? {} : { passwordHash: null }),
        },
        include: withRole,
      });
    } else {
      user = await prisma.user.create({
        data: {
          name: payload.name ?? email.split("@")[0],
          email,
          googleId: payload.sub,
          avatarUrl: payload.picture,
          isEmailVerified: true,
          role: { connectOrCreate: { where: { name: "MEMBER" }, create: { name: "MEMBER", description: "Regular community member" } } },
        },
        include: withRole,
      });
    }
  }
  assertUsable(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user: toPublicUser(user), ...(await issueSession(user.id, meta)) };
}

/** Rotates the refresh token. Presenting an already-used token revokes the whole session family (theft signal). */
export async function refreshSession(token: string, meta: SessionMeta) {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record) throw ApiError.unauthorized();

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw ApiError.unauthorized();
  }
  if (record.expiresAt < new Date()) throw ApiError.unauthorized();

  const claimed = await prisma.refreshToken.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (claimed.count === 0) throw ApiError.unauthorized();

  const user = await prisma.user.findUnique({ where: { id: record.userId }, include: withRole });
  if (!user) throw ApiError.unauthorized();
  assertUsable(user);

  return { user: toPublicUser(user), ...(await issueSession(user.id, meta, record.familyId)) };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: withRole });
  if (!user) throw ApiError.unauthorized();
  assertUsable(user);
  const actor = await loadActor(userId);
  return { ...toPublicUser(user), permissions: [...(actor?.permissions ?? [])].sort() };
}

const RESET_TTL_MS = 60 * 60 * 1000;

/** Always resolves the same way so it cannot be used to discover registered emails. */
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || user.isSuspended || !user.email) return;
  try {
    const recent = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } } });
    if (recent) return;
    await prisma.passwordResetToken.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] } });
    const { token, hash } = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    await sendMail({ to: user.email, ...passwordResetMail(user.name, `${env.appUrl}/reset-password?token=${token}`) });
  } catch (err) {
    console.error("[password-reset] failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Sets a new password from an emailed link. Opening the link proves the mailbox, so the email
 * becomes verified; every existing session is signed out and the lockout is cleared.
 */
export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.expiresAt < new Date()) {
    throw ApiError.badRequest("This reset link is invalid or has expired.", undefined, "INVALID_TOKEN");
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash, isEmailVerified: true, failedLogins: 0, lockedUntil: null } });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId } });
    await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: record.userId, action: "account.password.reset", entityType: "User", entityId: record.userId } });
  });
  return { ok: true };
}
