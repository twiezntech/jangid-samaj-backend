import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, indianPhone, locationPath, slugParam } from "../../lib/validators";

export const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(60).optional(),
    mobile: indianPhone.nullable().optional(),
    avatarUrl: imageUrl.nullable().optional(),
    locationPath: locationPath.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(72).optional(),
    newPassword,
  })
  .strict();

export const deleteAccountSchema = z
  .object({
    password: z.string().max(72).optional(),
    /** Typed by the member to confirm: "DELETE". */
    confirm: z.literal("DELETE"),
  })
  .strict();

export const SAVED_TYPES = ["NEWS", "BUSINESS", "EVENT", "DIRECTORY", "LEADER", "ACHIEVEMENT", "OBITUARY"] as const;

export const savedSchema = z.object({ type: z.enum(SAVED_TYPES), slug: slugParam }).strict();
export const savedListQuery = paginationQuery.extend({ type: z.enum(SAVED_TYPES).optional() });
export const savedStatusQuery = z.object({ type: z.enum(SAVED_TYPES), slug: slugParam });

export const notificationsQuery = paginationQuery.extend({ unread: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SavedTypeName = (typeof SAVED_TYPES)[number];
