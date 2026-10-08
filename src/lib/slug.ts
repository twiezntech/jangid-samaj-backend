import { randomBytes } from "crypto";

// Devanagari -> Latin, just enough for readable URLs ("गोपाल जांगिड़" -> "gopal jangid").
const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh",
  ष: "sh", स: "s", ह: "h", ळ: "l",
};
const VOWELS: Record<string, string> = { अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au" };
const MATRAS: Record<string, string> = { "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const HALANT = "्";

export function transliterate(input: string): string {
  const chars = [...input.normalize("NFC").replace(/़/g, "")]; // drop nukta: ड़ -> ड
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (CONSONANTS[c]) {
      out += CONSONANTS[c];
      if (next === HALANT) i++;
      else if (next && MATRAS[next]) {
        out += MATRAS[next];
        i++;
      } else if (next && /[ऀ-ॿ]/.test(next)) out += "a"; // inherent vowel, dropped at the end of a word
    } else if (VOWELS[c]) out += VOWELS[c];
    else if (c === "ं" || c === "ँ") out += "n";
    else if (c === "ः") out += "h";
    else out += c;
  }
  return out;
}

/** ASCII slug. Devanagari is transliterated; anything else non-ASCII is dropped. */
export function slugify(input: string): string {
  return transliterate(input)
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
