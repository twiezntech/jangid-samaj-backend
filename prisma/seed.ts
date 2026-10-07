/**
 * Idempotent seed. Safe to run repeatedly.
 *  - RBAC (permissions + roles) and location master data are always seeded.
 *  - Demo content + dev accounts are seeded outside production only (or with SEED_DEMO=true).
 *  - In production a super admin is created only from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PrismaClient, type LocationLevel } from "@prisma/client";
import { demo } from "./seed-data";
import { GOTRAS, RISHIS } from "./gotra-data";
import { nameKey } from "../src/lib/slug";

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === "production";

const PERMISSIONS: Record<string, string> = {
  "news.create": "Write news stories",
  "news.edit.any": "Edit any story in scope",
  "news.review": "Review, publish, schedule and feature stories",
  "directory.submit": "Submit directory entries for review",
  "directory.manage": "Manage, approve and verify directory entries",
  "leader.submit": "Submit leader profiles for review",
  "leader.manage": "Manage, approve and verify leader profiles",
  "location.manage": "Manage the location hierarchy",
  "taxonomy.manage": "Manage categories and tags",
  "event.manage": "Create, publish and manage events and registrations",
  "business.submit": "Submit a business listing for review",
  "business.manage": "Approve, verify and feature business listings; read enquiries",
  "achievement.submit": "Submit community achievements for review",
  "achievement.manage": "Manage, approve and feature community achievements",
  "achievement.delete": "Permanently delete community achievements (super admin only)",
  "gotra.manage": "Manage gotra and rishi master data",
  "feedback.read": "Read and respond to feedback messages",
  "media.upload": "Upload images",
  "dashboard.view": "Open the admin panel",
  "user.manage": "Manage users and roles",
  "audit.read": "Read the audit log",
};

const ALL = Object.keys(PERMISSIONS);
const ROLES: { name: string; description: string; scoped: boolean; permissions: string[] }[] = [
  { name: "SUPER_ADMIN", description: "Full access", scoped: false, permissions: ALL },
  {
    name: "CONTENT_EDITOR",
    description: "Runs the newsroom, directory and leadership listings",
    scoped: false,
    permissions: [
      "news.create", "news.edit.any", "news.review", "directory.manage", "leader.manage", "taxonomy.manage",
      "event.manage", "business.manage", "achievement.manage", "gotra.manage", "feedback.read", "media.upload", "dashboard.view",
    ],
  },
  {
    name: "DISTRICT_ADMIN",
    description: "Manages content inside their district",
    scoped: true,
    permissions: ["news.create", "news.edit.any", "news.review", "directory.manage", "leader.manage", "event.manage", "business.manage", "achievement.manage", "media.upload", "dashboard.view"],
  },
  {
    name: "CITY_REPORTER",
    description: "Reports from their city",
    scoped: true,
    permissions: ["news.create", "directory.submit", "leader.submit", "business.submit", "achievement.submit", "media.upload", "dashboard.view"],
  },
  {
    name: "SALES_MANAGER",
    description: "Business listings, featured placements and enquiries",
    scoped: false,
    permissions: ["business.manage", "media.upload", "dashboard.view"],
  },
  { name: "SUPPORT", description: "Answers member feedback and support requests", scoped: false, permissions: ["feedback.read", "dashboard.view"] },
  { name: "MEMBER", description: "Registered community member", scoped: false, permissions: ["directory.submit", "leader.submit", "business.submit", "achievement.submit", "media.upload"] },
];

async function seedRbac() {
  for (const [key, label] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, label }, update: { label } });
  }
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      create: { name: r.name, description: r.description, isLocationScoped: r.scoped },
      update: { description: r.description, isLocationScoped: r.scoped },
    });
    const perms = await prisma.permission.findMany({ where: { key: { in: r.permissions } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }
}

const LEVELS: LocationLevel[] = ["STATE", "DISTRICT", "CITY", "TEHSIL", "VILLAGE"];

async function seedLocations() {
  // node: [slug, nameHi, nameEn, children?]
  type Node = [string, string, string, Node[]?];
  const tree: Node[] = demo.locations;

  const walk = async (nodes: Node[], parent: { id: string; path: string; depth: number } | null) => {
    let order = 0;
    for (const [slug, nameHi, nameEn, children] of nodes) {
      const path = parent ? `${parent.path}/${slug}` : slug;
      const depth = parent ? parent.depth + 1 : 0;
      const loc = await prisma.location.upsert({
        where: { path },
        create: { slug, path, nameHi, nameEn, level: LEVELS[depth], parentId: parent?.id ?? null, sortOrder: order },
        update: { nameHi, nameEn, sortOrder: order },
      });
      order += 1;
      if (children) await walk(children, { id: loc.id, path, depth });
    }
  };
  await walk(tree, null);
}

async function seedTaxonomy() {
  let order = 0;
  for (const [slug, nameHi, nameEn] of demo.categories) {
    await prisma.category.upsert({ where: { slug }, create: { slug, nameHi, nameEn, sortOrder: order }, update: { nameHi, nameEn, sortOrder: order } });
    order += 1;
  }
  for (const [slug, nameHi, nameEn] of demo.tags) {
    await prisma.tag.upsert({ where: { slug }, create: { slug, nameHi, nameEn }, update: { nameHi, nameEn } });
  }
  order = 0;
  for (const [slug, nameHi, nameEn, icon] of demo.businessCategories) {
    await prisma.businessCategory.upsert({ where: { slug }, create: { slug, nameHi, nameEn, icon, sortOrder: order }, update: { nameHi, nameEn, icon, sortOrder: order } });
    order += 1;
  }
}

async function refsFor(path: string) {
  const parts = path.split("/");
  const chain = await prisma.location.findMany({ where: { path: { in: parts.map((_, i) => parts.slice(0, i + 1).join("/")) } } });
  const target = chain.find((l) => l.path === path);
  if (!target) throw new Error(`Seed location missing: ${path}`);
  const at = (lvl: LocationLevel) => chain.find((l) => l.level === lvl)?.id ?? null;
  return { locationId: target.id, stateId: at("STATE"), districtId: at("DISTRICT"), cityId: at("CITY") };
}

/** resetPassword: dev only — lets SEED_DEV_PASSWORD re-key existing dev accounts so their password is known again. */
async function seedAccount(email: string, name: string, password: string, roleName: string, locationPath?: string, resetPassword = false) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const locationId = locationPath ? (await refsFor(locationPath)).locationId : null;
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, isEmailVerified: true, roleId: role.id, locationId },
    update: { name, roleId: role.id, locationId, isEmailVerified: true, isSuspended: false, isActive: true, ...(resetPassword ? { passwordHash, failedLogins: 0, lockedUntil: null } : {}) },
  });
}

async function seedDemoContent(authorId: string) {
  for (const n of demo.news) {
    const refs = n.location ? await refsFor(n.location) : {};
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: n.category } });
    const tags = await prisma.tag.findMany({ where: { slug: { in: n.tags ?? [] } }, select: { id: true } });
    const data = {
      status: "PUBLISHED" as const,
      isBreaking: !!n.breaking,
      isFeatured: !!n.featured,
      coverImageUrl: n.image,
      sourceName: "जांगिड़ समाज संवाददाता",
      categoryId: cat.id,
      authorId,
      publishedAt: new Date(n.publishedAt),
      ...refs,
    };
    const news = await prisma.news.upsert({ where: { slug: n.slug }, create: { slug: n.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = n[lang];
      const body = t.body.map((p) => `<p>${p}</p>`).join("");
      const row = { title: t.title, excerpt: t.excerpt, body, imageAlt: t.imageAlt };
      await prisma.newsTranslation.upsert({ where: { newsId_lang: { newsId: news.id, lang } }, create: { newsId: news.id, lang, ...row }, update: row });
    }
    await prisma.newsTag.deleteMany({ where: { newsId: news.id } });
    if (tags.length) await prisma.newsTag.createMany({ data: tags.map((t) => ({ newsId: news.id, tagId: t.id })) });
  }

  for (const d of demo.directory) {
    const refs = await refsFor(d.location);
    const data = {
      type: d.type,
      status: "PUBLISHED" as const,
      verification: d.verified ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
      verifiedAt: d.verified ? new Date() : null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      website: d.website ?? null,
      pincode: d.pincode ?? null,
      latitude: d.lat ?? null,
      longitude: d.lng ?? null,
      coverImageUrl: d.image ?? null,
      establishedYear: d.year ?? null,
      isContactPublic: d.type !== "CONTACT" || !!d.publicContact,
      sortOrder: d.order ?? 0,
      submittedById: authorId,
      ...refs,
    };
    const entry = await prisma.directoryEntry.upsert({ where: { slug: d.slug }, create: { slug: d.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = d[lang];
      await prisma.directoryTranslation.upsert({ where: { entryId_lang: { entryId: entry.id, lang } }, create: { entryId: entry.id, lang, ...t }, update: t });
    }
  }

  for (const l of demo.leaders) {
    const refs = await refsFor(l.location);
    const org = l.org ? await prisma.directoryEntry.findUnique({ where: { slug: l.org }, select: { id: true } }) : null;
    const data = {
      category: l.category,
      status: "PUBLISHED" as const,
      verification: l.verified ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
      verifiedAt: l.verified ? new Date() : null,
      organizationId: org?.id ?? null,
      termStart: l.termStart ? new Date(l.termStart) : null,
      termEnd: l.termEnd ? new Date(l.termEnd) : null,
      isContactPublic: false,
      sortOrder: l.order ?? 0,
      createdById: authorId,
      ...refs,
    };
    const leader = await prisma.leaderProfile.upsert({ where: { slug: l.slug }, create: { slug: l.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = l[lang];
      await prisma.leaderTranslation.upsert({ where: { leaderId_lang: { leaderId: leader.id, lang } }, create: { leaderId: leader.id, lang, ...t }, update: t });
    }
  }
}

/** Master data, safe to re-run: only missing rows are inserted, so admin edits are never overwritten and names are never duplicated. */
async function seedGotra() {
  await prisma.rishi.createMany({ data: RISHIS, skipDuplicates: true });
  const idBySlug = new Map((await prisma.rishi.findMany({ select: { id: true, slug: true } })).map((r) => [r.slug, r.id]));
  const data = Object.entries(GOTRAS).flatMap(([rishi, names]) => names.map((nameEn) => ({ nameEn, nameKey: nameKey(nameEn), rishiId: (rishi && idBySlug.get(rishi)) || null })));
  const { count } = await prisma.gotra.createMany({ data, skipDuplicates: true });
  console.log(`Gotra master data: ${count} added, ${data.length - count} already present`);
}

async function seedAchievements(authorId: string) {
  for (const a of demo.achievements) {
    const refs = await refsFor(a.location);
    const data = {
      category: a.category,
      status: "PUBLISHED" as const,
      photoUrl: a.image ?? null,
      achievedOn: new Date(a.on),
      isFeatured: !!a.featured,
      createdById: authorId,
      ...refs,
    };
    const row = await prisma.achievement.upsert({ where: { slug: a.slug }, create: { slug: a.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = a[lang];
      await prisma.achievementTranslation.upsert({ where: { achievementId_lang: { achievementId: row.id, lang } }, create: { achievementId: row.id, lang, ...t }, update: t });
    }
  }
}

async function seedEventsAndBusinesses(authorId: string) {
  for (const e of demo.events) {
    const refs = await refsFor(e.location);
    const org = e.org ? await prisma.directoryEntry.findUnique({ where: { slug: e.org }, select: { id: true } }) : null;
    const data = {
      category: e.category,
      status: "PUBLISHED" as const,
      startsAt: new Date(e.startsAt),
      endsAt: e.endsAt ? new Date(e.endsAt) : null,
      coverImageUrl: e.image,
      organizerName: e.organizer.name,
      organizerPhone: e.organizer.phone ?? null,
      organizationId: org?.id ?? null,
      registrationEnabled: !!e.registration,
      capacity: e.registration?.capacity ?? null,
      registrationDeadline: e.registration?.deadline ? new Date(e.registration.deadline) : null,
      feeAmount: e.registration?.fee ?? null,
      isFeatured: !!e.featured,
      createdById: authorId,
      publishedAt: new Date(),
      ...refs,
    };
    const event = await prisma.event.upsert({ where: { slug: e.slug }, create: { slug: e.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = e[lang];
      await prisma.eventTranslation.upsert({ where: { eventId_lang: { eventId: event.id, lang } }, create: { eventId: event.id, lang, ...t }, update: t });
    }
  }

  for (const b of demo.businesses) {
    const refs = await refsFor(b.location);
    const category = await prisma.businessCategory.findUniqueOrThrow({ where: { slug: b.category } });
    const data = {
      categoryId: category.id,
      status: "PUBLISHED" as const,
      verification: b.verified ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
      verifiedAt: b.verified ? new Date() : null,
      coverImageUrl: b.image ?? null,
      phone: b.phone ?? null,
      whatsapp: b.whatsapp ?? null,
      website: b.website ?? null,
      establishedYear: b.year ?? null,
      isFeatured: !!b.featured,
      ownerId: authorId,
      ...refs,
    };
    const business = await prisma.business.upsert({ where: { slug: b.slug }, create: { slug: b.slug, ...data }, update: data });
    for (const lang of ["hi", "en"] as const) {
      const t = { offers: null, ...b[lang] };
      await prisma.businessTranslation.upsert({ where: { businessId_lang: { businessId: business.id, lang } }, create: { businessId: business.id, lang, ...t }, update: t });
    }
  }
}

async function main() {
  await seedRbac();
  await seedLocations();
  await seedTaxonomy();
  await seedGotra();

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (isProd) {
    if (adminEmail && adminPassword) {
      if (adminPassword.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters in production");
      await seedAccount(adminEmail.toLowerCase(), "Super Admin", adminPassword, "SUPER_ADMIN");
      console.log(`Super admin ready: ${adminEmail}`);
    } else {
      console.log("Production seed: RBAC + locations done. Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD to create the first super admin.");
    }
    if (process.env.SEED_DEMO !== "true") return;
  }

  const fixed = !!process.env.SEED_DEV_PASSWORD;
  const password = process.env.SEED_DEV_PASSWORD || `Dev-${randomBytes(6).toString("hex")}`;
  const admin = await seedAccount((adminEmail ?? "admin@jangidsamaj.local").toLowerCase(), "Site Admin", adminPassword ?? password, "SUPER_ADMIN", undefined, fixed || !!adminPassword);
  await seedAccount("editor@jangidsamaj.local", "Chief Editor", password, "CONTENT_EDITOR", undefined, fixed);
  await seedAccount("district@jangidsamaj.local", "Jaipur District Admin", password, "DISTRICT_ADMIN", "rajasthan/jaipur", fixed);
  await seedAccount("reporter@jangidsamaj.local", "Jaipur Reporter", password, "CITY_REPORTER", "rajasthan/jaipur/jaipur", fixed);
  await seedAccount("sales@jangidsamaj.local", "Sales Manager", password, "SALES_MANAGER", undefined, fixed);
  await seedAccount("support@jangidsamaj.local", "Support Desk", password, "SUPPORT", undefined, fixed);
  await seedDemoContent(admin.id);
  await seedEventsAndBusinesses(admin.id);
  await seedAchievements(admin.id);

  console.log("\nSeed complete. Dev accounts (all verified):");
  console.log(`  admin@jangidsamaj.local  password: ${adminPassword || fixed ? "(from .env)" : password}`);
  console.log(`  editor@ / district@ / reporter@ / sales@ / support@jangidsamaj.local  password: ${fixed ? "(SEED_DEV_PASSWORD from .env)" : password}${fixed ? "" : "  (random; set SEED_DEV_PASSWORD to fix it)"}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
