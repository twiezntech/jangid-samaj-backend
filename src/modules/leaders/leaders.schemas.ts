import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { emailField, imageUrl, indianPhone, locationPath, slugParam, socials } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const LEADER_CATEGORIES = ["SARPANCH", "ELECTED_REPRESENTATIVE", "SOCIAL_WORKER", "PRESIDENT", "COMMITTEE_MEMBER", "OTHER"] as const;

const translation = z.object({
  name: z.string().trim().min(2).max(120),
  designation: z.string().trim().max(200).optional(),
  bio: z.string().trim().max(3000).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const isoDate = z.coerce.date().min(new Date("1950-01-01")).max(new Date("2100-01-01"));

const fields = {
  slug: slugParam.optional(),
  category: z.enum(LEADER_CATEGORIES),
  locationPath,
  organizationSlug: slugParam.nullable().optional(),
  photoUrl: imageUrl.nullable().optional(),
  termStart: isoDate.nullable().optional(),
  termEnd: isoDate.nullable().optional(),
  phone: indianPhone.nullable().optional(),
  email: emailField.nullable().optional(),
  socials: socials.nullable().optional(),
  isContactPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

const termOrder = (v: { termStart?: Date | null; termEnd?: Date | null }) => !v.termStart || !v.termEnd || v.termEnd >= v.termStart;

export const createLeaderSchema = z
  .object({ ...fields, translations })
  .strict()
  .refine(termOrder, "termEnd must not be before termStart");

export const updateLeaderSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(termOrder, "termEnd must not be before termStart");

export const leaderListQuery = paginationQuery.extend({
  category: z.enum(LEADER_CATEGORIES).optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  verified: boolQuery.optional(),
});

export const leaderManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  category: z.enum(LEADER_CATEGORIES).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateLeaderInput = z.infer<typeof createLeaderSchema>;
export type UpdateLeaderInput = z.infer<typeof updateLeaderSchema>;
