import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, indianPhone, locationPath, slugParam } from "../../lib/validators";

export const CEREMONY_TYPES = ["ANTIM_YATRA", "UTHAVNA", "SHOK_SABHA", "PAGDI_RASM", "OTHER"] as const;
export const MAX_CEREMONIES = 6;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const translation = z.object({
  name: z.string().trim().min(2).max(120),
  relationLine: optionalText(200),
  nativePlace: optionalText(120),
  biography: optionalText(3000),
  familyMessage: optionalText(2000),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const day = z.coerce.date().min(new Date("1900-01-01")).max(new Date(Date.now() + 24 * 3600_000));

const ceremony = z
  .object({
    type: z.enum(CEREMONY_TYPES),
    startsAt: z.coerce.date().min(new Date("1950-01-01")).max(new Date(Date.now() + 366 * 24 * 3600_000)),
    venue: z.string().trim().min(2).max(200),
    address: optionalText(300),
    note: optionalText(300),
  })
  .strict();

const fields = {
  slug: slugParam.optional(),
  gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  photoUrl: imageUrl.nullable().optional(),
  dateOfBirth: day.nullable().optional(),
  dateOfDeath: day,
  ageYears: z.number().int().min(0).max(125).nullable().optional(),
  gotraId: z.string().trim().min(10).max(40).nullable().optional(),
  locationPath,
  contactName: z.string().trim().max(120).nullable().optional(),
  contactRelation: z.string().trim().max(60).nullable().optional(),
  contactPhone: indianPhone.nullable().optional(),
  isContactPublic: z.boolean().optional(),
  ceremonies: z.array(ceremony).max(MAX_CEREMONIES).optional(),
};

export const createObituarySchema = z.object({ ...fields, translations }).strict();

export const updateObituarySchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const obituaryListQuery = paginationQuery.extend({
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
});

export const obituaryManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export const tributeSchema = z
  .object({
    message: z.string().trim().min(3).max(500),
    relation: z.string().trim().max(60).optional(),
  })
  .strict();

export const tributeListQuery = paginationQuery;

export const tributeManageQuery = paginationQuery.extend({
  status: z.enum(["PENDING", "PUBLISHED", "HIDDEN"]).optional(),
  obituaryId: z.string().trim().min(10).max(40).optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateObituaryInput = z.infer<typeof createObituarySchema>;
export type UpdateObituaryInput = z.infer<typeof updateObituarySchema>;
export type TributeInput = z.infer<typeof tributeSchema>;
