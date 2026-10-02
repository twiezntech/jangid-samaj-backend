import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { emailField, httpsUrl, imageUrl, indianPhone, locationPath, slugParam, socials } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
const STATUSES = ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"] as const;

const translation = z.object({
  name: z.string().trim().min(2).max(160),
  tagline: z.string().trim().max(160).optional(),
  description: z.string().trim().max(3000).optional(),
  address: z.string().trim().max(400).optional(),
  offers: z.string().trim().max(500).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const fields = {
  slug: slugParam.optional(),
  categorySlug: slugParam,
  locationPath,
  pincode: z.string().trim().regex(/^\d{6}$/, "Invalid pincode").nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  phone: indianPhone.nullable().optional(),
  whatsapp: indianPhone.nullable().optional(),
  email: emailField.nullable().optional(),
  website: httpsUrl.nullable().optional(),
  socials: socials.nullable().optional(),
  logoUrl: imageUrl.nullable().optional(),
  coverImageUrl: imageUrl.nullable().optional(),
  gallery: z.array(imageUrl).max(12).nullable().optional(),
  establishedYear: z.number().int().min(1800).max(new Date().getFullYear()).nullable().optional(),
  // manager-only fields (enforced in the service)
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isFeatured: z.boolean().optional(),
  featuredUntil: z.coerce.date().nullable().optional(),
};

const pairCoords = (v: { latitude?: number | null; longitude?: number | null }) => (v.latitude == null) === (v.longitude == null);

export const createBusinessSchema = z
  .object({ ...fields, translations })
  .strict()
  .refine(pairCoords, "latitude and longitude go together")
  .refine((v) => !!(v.phone || v.whatsapp || v.email), { message: "Add at least one way to contact the business", path: ["phone"] });

export const updateBusinessSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine(pairCoords, "latitude and longitude go together")
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const businessListQuery = paginationQuery.extend({
  category: slugParam.optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  verified: boolQuery.optional(),
  featured: boolQuery.optional(),
});

export const businessManageQuery = paginationQuery.extend({
  status: z.enum(STATUSES).optional(),
  category: slugParam.optional(),
  q: z.string().trim().min(2).max(100).optional(),
});

export const enquirySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: indianPhone,
    email: emailField.optional(),
    message: z.string().trim().min(5).max(1000),
    // bot defence fields, consumed by requireHuman
    turnstileToken: z.string().max(2048).optional(),
    website: z.string().max(200).optional(),
  })
  .strict();

export const enquiryListQuery = paginationQuery.extend({
  status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional(),
  businessId: z.string().trim().min(10).max(40).optional(),
});

export const enquiryUpdateSchema = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]) }).strict();

export const categorySchema = z
  .object({
    slug: slugParam,
    nameHi: z.string().trim().min(1).max(80),
    nameEn: z.string().trim().min(1).max(80),
    icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type EnquiryInput = z.infer<typeof enquirySchema>;
