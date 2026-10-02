import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { emailField, httpsUrl, imageUrl, indianPhone, locationPath, slugParam } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const EVENT_CATEGORIES = [
  "MEETING",
  "CONFERENCE",
  "PARICHAY_SAMMELAN",
  "CULTURAL",
  "RELIGIOUS",
  "BLOOD_DONATION",
  "SOCIAL_SERVICE",
  "EDUCATION",
  "SPORTS",
  "OTHER",
] as const;

const translation = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(400).optional(),
  description: z.string().trim().max(20_000).optional(),
  venue: z.string().trim().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  feeNote: z.string().trim().max(200).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const fields = {
  slug: slugParam.optional(),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  isOnline: z.boolean().optional(),
  onlineUrl: httpsUrl.nullable().optional(),
  locationPath: locationPath.nullable().optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, "Invalid pincode").nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  coverImageUrl: imageUrl.nullable().optional(),
  gallery: z.array(imageUrl).max(30).nullable().optional(),
  organizerName: z.string().trim().max(160).nullable().optional(),
  organizerPhone: indianPhone.nullable().optional(),
  organizerEmail: emailField.nullable().optional(),
  isContactPublic: z.boolean().optional(),
  organizationSlug: slugParam.nullable().optional(),
  registrationEnabled: z.boolean().optional(),
  registrationDeadline: z.coerce.date().nullable().optional(),
  capacity: z.number().int().min(1).max(100_000).nullable().optional(),
  feeAmount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  isFeatured: z.boolean().optional(),
};

type Dates = { startsAt?: Date; endsAt?: Date | null; registrationDeadline?: Date | null; latitude?: number | null; longitude?: number | null };
const checkDates = (v: Dates, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
  if (v.startsAt && v.registrationDeadline && v.registrationDeadline > (v.endsAt ?? v.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["registrationDeadline"], message: "Registration must close before the event ends" });
  }
  if ((v.latitude == null) !== (v.longitude == null)) ctx.addIssue({ code: "custom", path: ["latitude"], message: "latitude and longitude go together" });
};

export const createEventSchema = z.object({ ...fields, translations }).strict().superRefine(checkDates);

export const updateEventSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .superRefine(checkDates)
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const eventListQuery = paginationQuery.extend({
  when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  category: z.enum(EVENT_CATEGORIES).optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  featured: boolQuery.optional(),
});

export const eventManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  when: z.enum(["upcoming", "past", "all"]).default("all"),
  q: z.string().trim().min(2).max(100).optional(),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: indianPhone,
    attendees: z.number().int().min(1).max(10).default(1),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const registrationsQuery = paginationQuery.extend({
  status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
