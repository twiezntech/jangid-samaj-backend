import type { Location, LocationLevel } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import type { LocationRefs } from "../../lib/access";

export interface ResolvedLocation extends LocationRefs {
  locationId: string;
  path: string;
}

const LEVEL_ORDER: LocationLevel[] = ["STATE", "DISTRICT", "CITY", "TEHSIL", "VILLAGE"];

export const toLocationDto = (l: Location) => ({
  slug: l.slug,
  path: l.path,
  level: l.level,
  nameHi: l.nameHi,
  nameEn: l.nameEn,
  parentPath: l.path.includes("/") ? l.path.slice(0, l.path.lastIndexOf("/")) : null,
});

const prefixes = (path: string) => {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/**
 * Validates a location and derives the denormalised state/district/city ids stored on content rows.
 * Every content write goes through this so the denormalised columns can never drift from the tree.
 */
export async function resolveLocation(path: string): Promise<ResolvedLocation> {
  const chain = await prisma.location.findMany({ where: { path: { in: prefixes(path) } } });
  const target = chain.find((l) => l.path === path);
  if (!target || chain.some((l) => !l.isActive)) throw ApiError.badRequest("Unknown or inactive location", undefined, "INVALID_LOCATION");

  const at = (level: LocationLevel) => chain.find((l) => l.level === level)?.id ?? null;
  return { locationId: target.id, path, stateId: at("STATE"), districtId: at("DISTRICT"), cityId: at("CITY") };
}

export async function findLocation(path: string) {
  return prisma.location.findUnique({ where: { path } });
}

/**
 * Prisma `where` fragment restricting any located entity (news, directory, leaders) to a location subtree.
 * State/district/city use indexed equality on denormalised ids; deeper levels fall back to a path prefix.
 */
export async function locationWhere(path: string | undefined) {
  if (!path) return {};
  const loc = await findLocation(path);
  if (!loc) throw ApiError.notFound("Location not found");

  switch (loc.level) {
    case "STATE":
      return { stateId: loc.id };
    case "DISTRICT":
      return { districtId: loc.id };
    case "CITY":
      return { cityId: loc.id };
    default:
      return { location: { is: { OR: [{ path: loc.path }, { path: { startsWith: `${loc.path}/` } }] } } };
  }
}

export async function listChildren(parentPath: string | undefined) {
  const where = parentPath
    ? { parent: { path: parentPath }, isActive: true }
    : { parentId: null, isActive: true };
  const rows = await prisma.location.findMany({ where, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] });
  return rows.map(toLocationDto);
}

export async function getWithAncestors(path: string) {
  const chain = await prisma.location.findMany({ where: { path: { in: prefixes(path) }, isActive: true } });
  const target = chain.find((l) => l.path === path);
  if (!target) throw ApiError.notFound("Location not found");
  const ancestors = chain.filter((l) => l.id !== target.id).sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  return {
    location: toLocationDto(target),
    ancestors: ancestors.map(toLocationDto),
    children: await listChildren(path),
  };
}

// ---------------------------------------------------------------------------
// State reference for content DTOs (list/detail show "Rajasthan" without a join per row)
// ---------------------------------------------------------------------------

export interface StateRef {
  path: string;
  nameHi: string;
  nameEn: string;
}

let stateCache: { at: number; map: Map<string, StateRef> } | null = null;

async function stateMap() {
  if (stateCache && Date.now() - stateCache.at < 5 * 60_000) return stateCache.map;
  const rows = await prisma.location.findMany({ where: { level: "STATE" }, select: { id: true, path: true, nameHi: true, nameEn: true } });
  const map = new Map(rows.map((r) => [r.id, { path: r.path, nameHi: r.nameHi, nameEn: r.nameEn }]));
  stateCache = { at: Date.now(), map };
  return map;
}

export async function withState<T extends { stateId: string | null }>(rows: T[]): Promise<(Omit<T, "stateId"> & { state: StateRef | null })[]> {
  const map = await stateMap();
  return rows.map(({ stateId, ...rest }) => ({ ...rest, state: stateId ? map.get(stateId) ?? null : null }));
}
