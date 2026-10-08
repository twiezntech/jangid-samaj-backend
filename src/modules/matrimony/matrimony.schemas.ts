import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { imageUrl, indianPhone, locationPath } from "../../lib/validators";

export const MARITAL = ["NEVER_MARRIED", "DIVORCED", "WIDOWED", "AWAITING_DIVORCE"] as const;
export const PROFILE_FOR = ["SELF", "SON", "DAUGHTER", "BROTHER", "SISTER", "RELATIVE"] as const;
export const MANGLIK = ["NO", "YES", "ANSHIK", "DONT_KNOW"] as const;
export const EDUCATION = ["SCHOOL", "DIPLOMA", "GRADUATE", "POST_GRADUATE", "DOCTORATE", "PROFESSIONAL"] as const;
export const INCOME = ["UNDER_3L", "L3_TO_6L", "L6_TO_10L", "L10_TO_20L", "ABOVE_20L", "NOT_SPECIFIED"] as const;
export const MAX_PHOTOS = 5;

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const id = z.string().trim().min(10).max(40);
const age = z.number().int().min(18).max(80);

const fields = {
  profileFor: z.enum(PROFILE_FOR).optional(),
  name: z.string().trim().min(2).max(80),
  gender: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.coerce.date(),
  heightCm: z.number().int().min(120).max(220).nullable().optional(),
  maritalStatus: z.enum(MARITAL).optional(),
  manglik: z.enum(MANGLIK).optional(),
  gotraId: id.nullable().optional(),
  motherGotraId: id.nullable().optional(),
  educationLevel: z.enum(EDUCATION).nullable().optional(),
  education: text(160),
  profession: text(160),
  income: z.enum(INCOME).optional(),
  locationPath,
  nativePlace: text(120),
  fatherName: text(80),
  fatherOccupation: text(120),
  motherName: text(80),
  siblings: text(300),
  about: text(2000),
  prefAgeMin: age.nullable().optional(),
  prefAgeMax: age.nullable().optional(),
  prefNotes: text(1000),
  photos: z.array(imageUrl).max(MAX_PHOTOS).optional(),
  photoVisibility: z.enum(["MEMBERS", "ON_ACCEPT"]).optional(),
  contactPhone: indianPhone,
  contactWhatsapp: indianPhone.nullable().optional(),
};

const prefOrder = (v: { prefAgeMin?: number | null; prefAgeMax?: number | null }) => v.prefAgeMin == null || v.prefAgeMax == null || v.prefAgeMin <= v.prefAgeMax;

export const createProfileSchema = z.object(fields).strict().refine(prefOrder, { message: "Minimum age cannot be above the maximum", path: ["prefAgeMin"] });

export const updateProfileSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(prefOrder, { message: "Minimum age cannot be above the maximum", path: ["prefAgeMin"] });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));

export const searchQuery = paginationQuery.extend({
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  ageMin: z.coerce.number().int().min(18).max(80).optional(),
  ageMax: z.coerce.number().int().min(18).max(80).optional(),
  location: locationPath.optional(),
  education: csv(EDUCATION).optional(),
  marital: csv(MARITAL).optional(),
  manglik: z.enum(MANGLIK).optional(),
  /** Hide profiles that share my (or my mother's) gotra. */
  excludeMyGotra: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  withPhoto: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  verified: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  q: z.string().trim().min(2).max(60).optional(),
});

export const interestSchema = z.object({ message: z.string().trim().max(300).optional() }).strict();
export const respondSchema = z.object({ accept: z.boolean() }).strict();
export const interestsQuery = paginationQuery.extend({
  box: z.enum(["received", "sent"]).default("received"),
  status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"]).optional(),
});

export const manageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  verification: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]).optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  q: z.string().trim().min(2).max(60).optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id });
export const codeParam = z.object({ code: z.string().trim().regex(/^JS\d{5,7}$/i, "Invalid profile code").transform((c) => c.toUpperCase()) });

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SearchQuery = z.infer<typeof searchQuery>;
