import { prisma } from "../config/prisma";

export interface Actor {
  id: string;
  name: string | null;
  roleName: string | null;
  permissions: ReadonlySet<string>;
  locationId: string | null;
  isLocationScoped: boolean;
}

export interface LocationRefs {
  locationId?: string | null;
  stateId?: string | null;
  districtId?: string | null;
  cityId?: string | null;
}

const TTL_MS = 15_000;
const cache = new Map<string, { actor: Actor | null; expires: number }>();

/** Loads the acting user with role + permissions. Disabled / unverified accounts get no privileges at all. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.actor;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  const actor: Actor | null =
    !user || !user.isActive || user.isSuspended || !user.isEmailVerified
      ? null
      : {
          id: user.id,
          name: user.name,
          roleName: user.role?.name ?? null,
          permissions: new Set(user.role?.permissions.map((p) => p.permission.key) ?? []),
          locationId: user.locationId,
          isLocationScoped: user.role?.isLocationScoped ?? false,
        };

  cache.set(userId, { actor, expires: Date.now() + TTL_MS });
  if (cache.size > 5_000) cache.clear();
  return actor;
}

/** Call after changing a user's role/status so the change applies immediately. */
export function invalidateActor(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export const can = (actor: Actor | undefined | null, permission: string): boolean => !!actor && actor.permissions.has(permission);

/**
 * Prisma `where` fragment limiting a located model (anything with locationId/stateId/districtId/cityId)
 * to the actor's subtree. Unscoped roles get no restriction; a scoped role without a location sees nothing.
 */
export function scopeWhere(actor: Actor): { OR?: LocationRefs[]; id?: string } {
  if (!actor.isLocationScoped) return {};
  if (!actor.locationId) return { id: "__none__" };
  const id = actor.locationId;
  return { OR: [{ locationId: id }, { stateId: id }, { districtId: id }, { cityId: id }] };
}

/**
 * Location-scoped roles (district admin, city reporter) may only touch content located inside
 * their own subtree. Unscoped roles (super admin, editor) are unrestricted.
 */
export function inScope(actor: Actor, target: LocationRefs): boolean {
  if (!actor.isLocationScoped) return true;
  if (!actor.locationId) return false;
  return [target.locationId, target.stateId, target.districtId, target.cityId].includes(actor.locationId);
}
