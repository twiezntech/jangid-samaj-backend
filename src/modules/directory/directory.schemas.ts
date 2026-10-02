import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { emailField, httpsUrl, imageUrl, indianPhone, locationPath, slugParam, socials } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
export const DIRECTORY_TYPES = ["ORGANIZATION", "COMMITTEE", "SAMAJ_BHAWAN", "CONTACT"] as const;

const translation = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().max(400).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const fields = {
  slug: slugParam.optional(),
  type: z.enum(DIRECTORY_TYPES),
  locationPath,
  pincode: z.string().trim().regex(/^\d{6}$/, "Invalid pincode").nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  phone: indianPhone.nullable().optional(),
  altPhone: indianPhone.nullable().optional(),
  email: emailField.nullable().optional(),
  website: httpsUrl.nullable().optional(),
  socials: socials.nullable().optional(),
  isContactPublic: z.boolean().optional(),
  coverImageUrl: imageUrl.nullable().optional(),
  establishedYear: z.number().int().min(1800).max(new Date().getFullYear()).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

export const createDirectorySchema = z
  .object({ ...fields, translations })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), "latitude and longitude go together");

export const updateDirectorySchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const directoryListQuery = paginationQuery.extend({
  type: z.enum(DIRECTORY_TYPES).optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  verified: boolQuery.optional(),
});

export const directoryManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  type: z.enum(DIRECTORY_TYPES).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateDirectoryInput = z.infer<typeof createDirectorySchema>;
export type UpdateDirectoryInput = z.infer<typeof updateDirectorySchema>;
