import type { ContentStatus } from "@prisma/client";
import { ApiError } from "../utils/apiError";
import { Actor, LocationRefs, can, inScope, scopeWhere } from "./access";
import { WorkflowAction, nextStatus } from "./workflow";

/** Actions available on member-submitted content (no scheduling: these modules publish immediately). */
export type ModerationAction = Exclude<WorkflowAction, "schedule" | "unpublish">;

export const MODERATION_ACTIONS = ["publish", "archive", "restore", "submit", "reject"] as const satisfies readonly ModerationAction[];

interface Moderated extends LocationRefs {
  status: ContentStatus;
  createdById: string | null;
}

const WITHDRAWABLE: ContentStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

/**
 * Who may move a record to the next state:
 *  - managers (holding `manageKey`, inside their area) can do everything;
 *  - the creator can submit their own draft and withdraw (archive) it while it is still unpublished.
 * Returns the resulting status; throws 403 / 409 / 400 otherwise.
 */
export function authorizeTransition(actor: Actor, manageKey: string, record: Moderated, action: ModerationAction, reason?: string): ContentStatus {
  const manager = can(actor, manageKey) && inScope(actor, record);
  const owner = record.createdById === actor.id;
  const withdraw = owner && action === "archive" && WITHDRAWABLE.includes(record.status);
  if (!(manager || withdraw || (owner && action === "submit"))) throw ApiError.forbidden("You cannot perform this action", "FORBIDDEN");
  if (action === "reject" && !reason) throw ApiError.badRequest("A rejection reason is required");
  return nextStatus(record.status, action);
}

/** Review columns shared by every moderated model; spread into the Prisma update `data`. */
export function reviewFields(actor: Actor, action: ModerationAction, reason?: string) {
  const now = new Date();
  if (action === "publish") return { reviewedById: actor.id, reviewedAt: now, rejectionReason: null };
  if (action === "reject") return { reviewedById: actor.id, reviewedAt: now, rejectionReason: reason ?? null };
  return {};
}

/**
 * "Manage" list scope: managers see everything in their area; everybody else (or `mine=true`) sees only
 * what they created. Typed for the models that carry createdById + the location columns.
 */
export function manageScope(actor: Actor, manageKey: string, mine?: boolean): { OR?: LocationRefs[]; id?: string; createdById?: string } {
  return can(actor, manageKey) && !mine ? scopeWhere(actor) : { createdById: actor.id };
}

/** Creating: managers publish at once (inside their area); everyone else lands in the review queue. */
export function initialStatus(actor: Actor, manageKey: string, refs: LocationRefs): ContentStatus {
  if (!can(actor, manageKey)) return "PENDING_REVIEW";
  if (!inScope(actor, refs)) throw ApiError.forbidden("Outside your assigned area", "OUT_OF_SCOPE");
  return "PUBLISHED";
}
