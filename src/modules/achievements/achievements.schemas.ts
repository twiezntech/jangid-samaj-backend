import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, locationPath, slugParam } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const ACHIEVEMENT_CATEGORIES = ["STUDENT", "PROFESSIONAL", "ENTREPRENEUR", "SPORTS", "SOCIAL", "OTHER"] as const;

const translation = z.object({
  personName: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const achievedOn = z.coerce.date().min(new Date("1950-01-01")).max(new Date(Date.now() + 24 * 3600_000));

const fields = {
  slug: slugParam.optional(),
  category: z.enum(ACHIEVEMENT_CATEGORIES),
  locationPath,
  photoUrl: imageUrl.nullable().optional(),
  achievedOn: achievedOn.nullable().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

export const createAchievementSchema = z.object({ ...fields, translations }).strict();

export const updateAchievementSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const achievementListQuery = paginationQuery.extend({
  category: z.enum(ACHIEVEMENT_CATEGORIES).optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  featured: boolQuery.optional(),
});

export const achievementManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  category: z.enum(ACHIEVEMENT_CATEGORIES).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateAchievementInput = z.infer<typeof createAchievementSchema>;
export type UpdateAchievementInput = z.infer<typeof updateAchievementSchema>;
