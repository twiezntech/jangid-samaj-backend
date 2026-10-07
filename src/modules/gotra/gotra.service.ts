import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { Actor } from "../../lib/access";
import { audit } from "../../lib/audit";
import { toPage } from "../../lib/pagination";
import { cleanText } from "../../lib/sanitize";
import { nameKey, uniqueSlug } from "../../lib/slug";
import type { BulkGotraInput, CreateGotraInput, CreateRishiInput, GotraListQuery, UpdateGotraInput, UpdateRishiInput } from "./gotra.schemas";

const clean = (s: string) => cleanText(s).replace(/\s+/g, " ");

const gotraSelect = {
  id: true,
  nameEn: true,
  nameHi: true,
  isActive: true,
  rishi: { select: { id: true, slug: true, nameEn: true, nameHi: true } },
} satisfies Prisma.GotraSelect;

function listWhere(p: Pick<GotraListQuery, "q" | "letter" | "rishi">, activeOnly: boolean, active?: boolean): Prisma.GotraWhereInput {
  const search = p.q ? { OR: [{ nameEn: { contains: p.q, mode: "insensitive" as const } }, { nameHi: { contains: p.q, mode: "insensitive" as const } }] } : {};
  return {
    ...(activeOnly ? { isActive: true } : active !== undefined ? { isActive: active } : {}),
    ...(p.letter ? { nameEn: { startsWith: p.letter, mode: "insensitive" } } : {}),
    ...(p.rishi === "none" ? { rishiId: null } : p.rishi ? { rishi: { slug: p.rishi } } : {}),
    ...search,
  };
}

async function page(where: Prisma.GotraWhereInput, p: { page: number; limit: number }) {
  const [items, total] = await Promise.all([
    prisma.gotra.findMany({ where, select: gotraSelect, orderBy: [{ nameEn: "asc" }, { id: "asc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
    prisma.gotra.count({ where }),
  ]);
  return toPage(items, total, p.page, p.limit);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export const listPublic = (p: GotraListQuery) => page(listWhere(p, true), p);

/** Active rishis with the number of visible gotras under each. */
export async function listPublicRishis() {
  const rows = await prisma.rishi.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: { slug: true, nameEn: true, nameHi: true, _count: { select: { gotras: { where: { isActive: true } } } } },
  });
  const total = await prisma.gotra.count({ where: { isActive: true } });
  const withoutRishi = await prisma.gotra.count({ where: { isActive: true, rishiId: null } });
  return { total, withoutRishi, items: rows.map(({ _count, ...r }) => ({ ...r, count: _count.gotras })) };
}

// ---------------------------------------------------------------------------
// Manage: gotras
// ---------------------------------------------------------------------------

export const listForManage = (p: GotraListQuery) => page(listWhere(p, false, p.active), p);

async function assertRishi(id: string | null | undefined) {
  if (!id) return;
  if (!(await prisma.rishi.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.badRequest("Unknown rishi", undefined, "INVALID_RISHI");
}

async function assertNameFree(key: string, exceptId?: string) {
  const hit = await prisma.gotra.findUnique({ where: { nameKey: key }, select: { id: true, nameEn: true } });
  if (hit && hit.id !== exceptId) throw new ApiError(409, `Gotra "${hit.nameEn}" already exists`, { existingId: hit.id }, "DUPLICATE_GOTRA");
}

/** A unique-index race (two admins adding the same name at once) surfaces as the same friendly 409. */
function duplicateGuard(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "This gotra already exists", undefined, "DUPLICATE_GOTRA");
  throw e;
}

export async function createGotra(actor: Actor, input: CreateGotraInput, ip?: string) {
  const nameEn = clean(input.nameEn);
  const key = nameKey(nameEn);
  if (!key) throw ApiError.badRequest("Name must contain letters", undefined, "EMPTY_CONTENT");
  await Promise.all([assertNameFree(key), assertRishi(input.rishiId)]);

  return prisma
    .$transaction(async (tx) => {
      const row = await tx.gotra.create({
        data: { nameEn, nameKey: key, nameHi: input.nameHi ? clean(input.nameHi) : null, rishiId: input.rishiId ?? null, isActive: input.isActive ?? true },
        select: gotraSelect,
      });
      await audit(tx, { actorId: actor.id, action: "gotra.create", entityType: "Gotra", entityId: row.id, meta: { nameEn }, ip });
      return row;
    })
    .catch(duplicateGuard);
}

export async function updateGotra(actor: Actor, id: string, input: UpdateGotraInput, ip?: string) {
  const current = await prisma.gotra.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Gotra not found");

  const data: Prisma.GotraUncheckedUpdateInput = {};
  if (input.nameEn !== undefined) {
    const nameEn = clean(input.nameEn);
    const key = nameKey(nameEn);
    if (!key) throw ApiError.badRequest("Name must contain letters", undefined, "EMPTY_CONTENT");
    await assertNameFree(key, id);
    Object.assign(data, { nameEn, nameKey: key });
  }
  if (input.nameHi !== undefined) data.nameHi = input.nameHi ? clean(input.nameHi) : null;
  if (input.rishiId !== undefined) {
    await assertRishi(input.rishiId);
    data.rishiId = input.rishiId;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma
    .$transaction(async (tx) => {
      const row = await tx.gotra.update({ where: { id }, data, select: gotraSelect });
      await audit(tx, { actorId: actor.id, action: "gotra.update", entityType: "Gotra", entityId: id, meta: { nameEn: row.nameEn, fields: Object.keys(input) }, ip });
      return row;
    })
    .catch(duplicateGuard);
}

/** Set the rishi and/or visibility of many gotras at once (completing the list of gotras that have no rishi yet). */
export async function bulkUpdateGotras(actor: Actor, input: BulkGotraInput, ip?: string) {
  await assertRishi(input.rishiId);
  const ids = [...new Set(input.ids)];
  const data: Prisma.GotraUncheckedUpdateManyInput = {
    ...(input.rishiId !== undefined ? { rishiId: input.rishiId } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.gotra.updateMany({ where: { id: { in: ids } }, data });
    await audit(tx, { actorId: actor.id, action: "gotra.bulk_update", entityType: "Gotra", meta: { count, fields: Object.keys(data), rishiId: input.rishiId ?? null }, ip });
    return { updated: count };
  });
}

export async function deleteGotra(actor: Actor, id: string, ip?: string) {
  const current = await prisma.gotra.findUnique({ where: { id }, include: { rishi: { select: { slug: true } } } });
  if (!current) throw ApiError.notFound("Gotra not found");

  await prisma
    .$transaction(async (tx) => {
      await tx.gotra.delete({ where: { id } });
      await audit(tx, { actorId: actor.id, action: "gotra.delete", entityType: "Gotra", entityId: id, meta: { nameEn: current.nameEn, nameHi: current.nameHi, rishi: current.rishi?.slug ?? null }, ip });
    })
    .catch((e) => {
      // Once profiles reference a gotra, the foreign key stops the delete: hide it instead.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw ApiError.conflict("This gotra is used by profiles. Hide it instead of deleting it.");
      throw e;
    });
  return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Manage: rishis
// ---------------------------------------------------------------------------

/** Rishis (with gotra counts) plus the headline numbers for the admin overview. */
export async function listRishisForManage() {
  const [rows, total, withoutRishi, hidden] = await Promise.all([
    prisma.rishi.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { id: true, slug: true, nameEn: true, nameHi: true, sortOrder: true, isActive: true, _count: { select: { gotras: true } } },
    }),
    prisma.gotra.count(),
    prisma.gotra.count({ where: { rishiId: null } }),
    prisma.gotra.count({ where: { isActive: false } }),
  ]);
  return { summary: { total, withoutRishi, hidden }, items: rows.map(({ _count, ...r }) => ({ ...r, count: _count.gotras })) };
}

export async function createRishi(actor: Actor, input: CreateRishiInput, ip?: string) {
  const nameEn = clean(input.nameEn);
  const slug = input.slug ?? (await uniqueSlug(nameEn, async (s) => !!(await prisma.rishi.findUnique({ where: { slug: s }, select: { id: true } }))));
  if (await prisma.rishi.findUnique({ where: { slug }, select: { id: true } })) throw new ApiError(409, "A rishi with this URL name already exists", undefined, "DUPLICATE_RISHI");

  return prisma.$transaction(async (tx) => {
    const row = await tx.rishi.create({
      data: { slug, nameEn, nameHi: input.nameHi ? clean(input.nameHi) : null, sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true },
      select: { id: true, slug: true, nameEn: true, nameHi: true, sortOrder: true, isActive: true },
    });
    await audit(tx, { actorId: actor.id, action: "rishi.create", entityType: "Rishi", entityId: row.id, meta: { nameEn }, ip });
    return row;
  });
}

export async function updateRishi(actor: Actor, id: string, input: UpdateRishiInput, ip?: string) {
  if (!(await prisma.rishi.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.notFound("Rishi not found");
  const data: Prisma.RishiUpdateInput = {
    ...(input.nameEn !== undefined ? { nameEn: clean(input.nameEn) } : {}),
    ...(input.nameHi !== undefined ? { nameHi: input.nameHi ? clean(input.nameHi) : null } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const row = await tx.rishi.update({ where: { id }, data, select: { id: true, slug: true, nameEn: true, nameHi: true, sortOrder: true, isActive: true } });
    await audit(tx, { actorId: actor.id, action: "rishi.update", entityType: "Rishi", entityId: id, meta: { nameEn: row.nameEn, fields: Object.keys(input) }, ip });
    return row;
  });
}

export async function deleteRishi(actor: Actor, id: string, ip?: string) {
  const current = await prisma.rishi.findUnique({ where: { id }, include: { _count: { select: { gotras: true } } } });
  if (!current) throw ApiError.notFound("Rishi not found");
  if (current._count.gotras > 0) throw ApiError.conflict(`${current._count.gotras} gotras belong to this rishi. Move them to another rishi first, or hide the rishi instead.`);

  await prisma.$transaction(async (tx) => {
    await tx.rishi.delete({ where: { id } });
    await audit(tx, { actorId: actor.id, action: "rishi.delete", entityType: "Rishi", entityId: id, meta: { slug: current.slug, nameEn: current.nameEn }, ip });
  });
  return { id, deleted: true };
}
