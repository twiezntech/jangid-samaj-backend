import { z } from "zod";
import { paginationQuery } from "../../lib/pagination";
import { emailField, httpsUrl, indianPhone, locationPath, slugParam } from "../../lib/validators";

export const JOB_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FREELANCE", "BUSINESS_OPPORTUNITY"] as const;
export const WORK_MODES = ["ONSITE", "REMOTE", "HYBRID"] as const;

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const translation = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(20, "Describe the role in at least 20 characters").max(5000),
  requirements: z.string().trim().max(3000).optional(),
});

const translations = z
  .object({ hi: translation.optional(), en: translation.optional() })
  .strict()
  .refine((t) => !!t.hi || !!t.en, "Provide at least one language");

const salary = z.number().int().min(0).max(10_000_000);

const fields = {
  slug: slugParam.optional(),
  type: z.enum(JOB_TYPES),
  workMode: z.enum(WORK_MODES).optional(),
  organisationName: z.string().trim().min(2).max(160),
  businessSlug: slugParam.nullable().optional(),
  locationPath,
  salaryMin: salary.nullable().optional(),
  salaryMax: salary.nullable().optional(),
  experienceYears: z.number().int().min(0).max(50).nullable().optional(),
  vacancies: z.number().int().min(1).max(10_000).nullable().optional(),
  lastDate: z.coerce.date().nullable().optional(),
  applyUrl: httpsUrl.nullable().optional(),
  applyEmail: emailField.nullable().optional(),
  applyPhone: indianPhone.nullable().optional(),
  isFeatured: z.boolean().optional(),
};

const salaryOrder = (v: { salaryMin?: number | null; salaryMax?: number | null }) => v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax;

export const createJobSchema = z
  .object({ ...fields, translations })
  .strict()
  .refine(salaryOrder, { message: "Minimum salary cannot be above the maximum", path: ["salaryMin"] });

export const updateJobSchema = z
  .object({ ...fields, translations: translations.optional() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(salaryOrder, { message: "Minimum salary cannot be above the maximum", path: ["salaryMin"] });

export const jobListQuery = paginationQuery.extend({
  type: z.enum(JOB_TYPES).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  location: locationPath.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  featured: boolQuery.optional(),
});

export const jobManageQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PUBLISHED", "REJECTED", "ARCHIVED"]).optional(),
  type: z.enum(JOB_TYPES).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mine: boolQuery.optional(),
});

export const applySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: indianPhone,
    email: emailField.optional(),
    message: z.string().trim().min(10, "Tell the employer a little about yourself").max(2000),
  })
  .strict();

export const applicationsQuery = paginationQuery.extend({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]).optional() });
export const applicationStatusSchema = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]) }).strict();

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const idParam = z.object({ id: z.string().trim().min(10).max(40) });
export const slugRouteParam = z.object({ slug: slugParam });

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type ApplyInput = z.infer<typeof applySchema>;
