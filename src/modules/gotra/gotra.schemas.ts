import { z } from "zod";
import { MAX_PAGE_SIZE } from "../../lib/pagination";
import { slugParam } from "../../lib/validators";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
const id = z.string().trim().min(10).max(40);

const nameEn = z.string().trim().min(2).max(80);
const nameHi = z.string().trim().min(1).max(80);

/** Directory pages show a dense grid, so the default page is bigger than the other modules'. */
const paging = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(48),
});

const filters = {
  q: z.string().trim().min(1).max(80).optional(),
  /** First letter of the English name. */
  letter: z.string().trim().toUpperCase().regex(/^[A-Z]$/).optional(),
  /** Rishi slug, or "none" for gotras with no rishi recorded yet. */
  rishi: z.union([slugParam, z.literal("none")]).optional(),
};

export const gotraListQuery = paging.extend(filters);
export const gotraManageQuery = paging.extend({ ...filters, active: boolQuery.optional() });

export const createGotraSchema = z
  .object({ nameEn, nameHi: nameHi.nullable().optional(), rishiId: id.nullable().optional(), isActive: z.boolean().optional() })
  .strict();

export const updateGotraSchema = createGotraSchema.partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const bulkGotraSchema = z
  .object({ ids: z.array(id).min(1).max(200), rishiId: id.nullable().optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => v.rishiId !== undefined || v.isActive !== undefined, "Nothing to update");

export const createRishiSchema = z
  .object({ slug: slugParam.optional(), nameEn, nameHi: nameHi.nullable().optional(), sortOrder: z.number().int().min(0).max(10_000).optional(), isActive: z.boolean().optional() })
  .strict();

export const updateRishiSchema = createRishiSchema.omit({ slug: true }).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const idParam = z.object({ id });

export type CreateGotraInput = z.infer<typeof createGotraSchema>;
export type UpdateGotraInput = z.infer<typeof updateGotraSchema>;
export type BulkGotraInput = z.infer<typeof bulkGotraSchema>;
export type CreateRishiInput = z.infer<typeof createRishiSchema>;
export type UpdateRishiInput = z.infer<typeof updateRishiSchema>;
export type GotraListQuery = z.infer<typeof gotraManageQuery>;
