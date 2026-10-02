import type { Lang } from "@prisma/client";

export const LANGS: Lang[] = ["hi", "en"];

/** Turns translation rows [{lang:"hi",...},{lang:"en",...}] into { hi: {...}, en: {...} }. */
export function byLang<T extends { lang: Lang }>(rows: T[]): Partial<Record<Lang, Omit<T, "lang">>> {
  const out: Partial<Record<Lang, Omit<T, "lang">>> = {};
  for (const { lang, ...rest } of rows) out[lang] = rest;
  return out;
}

/** Runs `clean` for every language present in the input, returning rows ready for createMany/upsert. */
export function translationRows<I, O>(input: Partial<Record<Lang, I>> | undefined, clean: (t: I) => O): (O & { lang: Lang })[] {
  if (!input) return [];
  return LANGS.flatMap((lang) => (input[lang] ? [{ lang, ...clean(input[lang] as I) }] : []));
}
