import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, locationPath, slugParam, youtubeUrl } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const translation = z.object({
  title: z.string().trim().min(3).max(200),
  excerpt: z.string().trim().max(400).optional(),
  body: z.string().trim().min(1).max(60_000),
  imageAlt: z.string().trim().max(200).optional(),
  metaTitle: z.string().trim().max(70).optional(),
  metaDescription: z.string().trim().max(170).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const fields = {
  slug: slugParam.optional(),
  categorySlug: slugParam.nullable().optional(),
  locationPath: locationPath.nullable().optional(),
  coverImageUrl: imageUrl.nullable().optional(),
  videoUrl: youtubeUrl.nullable().optional(),
  sourceName: z.string().trim().max(120).nullable().optional(),
  tags: z.array(slugParam).max(10).optional(),
  isBreaking: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
};

export const createNewsSchema = z.object({ ...fields, translations }).strict();

export const updateNewsSchema = z
  .object({ ...fields, translations: translations.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const publicListQuery = paginationQuery.extend({
  location: locationPath.optional(),
  category: slugParam.optional(),
  tag: slugParam.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  featured: boolQuery.optional(),
  breaking: boolQuery.optional(),
});

export const manageListQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const scheduleSchema = z.object({ scheduledAt: z.coerce.date() }).strict();
export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateNewsInput = z.infer<typeof createNewsSchema>;
export type UpdateNewsInput = z.infer<typeof updateNewsSchema>;
