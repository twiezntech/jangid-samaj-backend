import type { ContentStatus } from "@prisma/client";
import { ApiError } from "../utils/apiError";

export type WorkflowAction = "submit" | "publish" | "schedule" | "reject" | "archive" | "restore" | "unpublish";

/**
 * One editorial state machine shared by news, directory entries and leader profiles.
 * A transition that is not listed here is impossible, whoever asks for it.
 */
const transitions: Record<WorkflowAction, { from: ContentStatus[]; to: ContentStatus }> = {
  submit: { from: ["DRAFT", "REJECTED"], to: "PENDING_REVIEW" },
  publish: { from: ["DRAFT", "PENDING_REVIEW", "REJECTED", "SCHEDULED"], to: "PUBLISHED" },
  schedule: { from: ["DRAFT", "PENDING_REVIEW", "REJECTED"], to: "SCHEDULED" },
  reject: { from: ["PENDING_REVIEW"], to: "REJECTED" },
  archive: { from: ["DRAFT", "PENDING_REVIEW", "REJECTED", "SCHEDULED", "PUBLISHED"], to: "ARCHIVED" },
  restore: { from: ["ARCHIVED"], to: "DRAFT" },
  unpublish: { from: ["PUBLISHED", "SCHEDULED"], to: "DRAFT" },
};

export function nextStatus(current: ContentStatus, action: WorkflowAction): ContentStatus {
  const t = transitions[action];
  if (!t.from.includes(current)) {
    throw new ApiError(409, `Cannot ${action} content that is ${current}`, undefined, "INVALID_TRANSITION");
  }
  return t.to;
}

/** Statuses in which the original author may still edit. */
export const AUTHOR_EDITABLE: ContentStatus[] = ["DRAFT", "REJECTED", "PENDING_REVIEW"];
