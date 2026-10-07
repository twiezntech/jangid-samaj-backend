import { randomBytes } from "crypto";

/** ASCII slug. Devanagari-only input yields "" so callers fall back to a random suffix. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/** Identity of a name regardless of case, spaces and punctuation ("A-slia" == "Aslia"). */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export const randomSuffix = (bytes = 3) => randomBytes(bytes).toString("hex");

/** Returns a slug that does not exist yet according to `exists`. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  if (!(await exists(root))) return root;
  for (let i = 0; i < 5; i++) {
    const candidate = `${root}-${randomSuffix()}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${randomSuffix(6)}`;
}
