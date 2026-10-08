import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, locationPath, slugParam, youtubeUrl } from "../../lib/validators";

export const MAX_ITEMS = 200;

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const translation = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const caption = z.string().trim().max(300).optional();

/** Photos must be our uploads / allow-listed hosts; videos must be YouTube links. */
const item = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PHOTO"), url: imageUrl, caption }).strict(),
  z.object({ kind: z.literal("VIDEO"), url: youtubeUrl, caption }).strict(),
]);

const fields = {
  slug: slugParam.optional(),
  coverUrl: imageUrl.nullable().optional(),
  takenOn: z.coerce.date().min(new Date("1950-01-01")).max(new Date(Date.now() + 24 * 3600_000)).nullable().optional(),
  eventSlug: slugParam.nullable().optional(),
  locationPath,
  isFeatured: z.boolean().optional(),
  items: z.array(item).max(MAX_ITEMS).optional(),
};

export const createAlbumSchema = z.object({ ...fields, translations }).strict();

export const updateAlbumSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const albumListQuery = paginationQuery.extend({
  location: locationPath.optional(),
  event: slugParam.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  featured: boolQuery.optional(),
  /** Only albums that contain at least one video. */
  videos: boolQuery.optional(),
});

export const albumManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;
