import { z } from "zod";
import { env } from "../config/env";

export const slugParam = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug").max(120);

const locationSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** "rajasthan/jaipur" style materialised location path, 1..5 segments. */
export const locationPath = z
  .string()
  .trim()
  .toLowerCase()
  .refine((p) => {
    const parts = p.split("/");
    return parts.length >= 1 && parts.length <= 5 && parts.every((s) => locationSegment.test(s) && s.length <= 80);
  }, "Invalid location path");

export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^(\+91)?[6-9]\d{9}$|^0\d{9,11}$/.test(v), "Invalid phone number");

export const emailField = z.string().trim().toLowerCase().email().max(254);

/** Our own upload store. Built from env so a dev http:// origin works while production stays https-only. */
export const isUploadUrl = (u: string) => /^\/uploads\/[\w/-]+\.(jpg|png|webp)$/.test(u.slice(env.publicApiUrl.length)) && u.startsWith(`${env.publicApiUrl}/`);

/** Optional PDF documents (biodata) from our own upload store only. */
export const isDocumentUrl = (u: string) => /^\/uploads\/[\w/-]+\.pdf$/.test(u.slice(env.publicApiUrl.length)) && u.startsWith(`${env.publicApiUrl}/`);
export const documentUrl = z.string().trim().max(500).url().refine(isDocumentUrl, "Upload the PDF through the website");

/** Images must be our own uploads or https URLs from allow-listed hosts (no hot-linking arbitrary/tracking hosts). */
export const imageUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => {
    if (isUploadUrl(u)) return true;
    try {
      const url = new URL(u);
      return url.protocol === "https:" && env.imageHosts.includes(url.hostname);
    } catch {
      return false;
    }
  }, "Image host is not allowed");

/** Only YouTube videos are embedded (privacy-enhanced domain on output); stored as the canonical watch URL. */
export const youtubeUrl = z
  .string()
  .trim()
  .max(200)
  .transform((u, ctx) => {
    const m = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/);
    if (!m) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only YouTube links are supported" });
      return z.NEVER;
    }
    return `https://www.youtube.com/watch?v=${m[1]}`;
  });

export const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .url()
  .refine((u) => u.startsWith("https://"), "Only https links are allowed");

export const socials = z
  .object({
    facebook: httpsUrl.optional(),
    instagram: httpsUrl.optional(),
    twitter: httpsUrl.optional(),
    youtube: httpsUrl.optional(),
    whatsapp: z.string().trim().max(20).optional(),
  })
  .strict();

const trimmed = (max: number) => z.string().trim().min(1).max(max);
export const shortText = trimmed(200);
export const longText = z.string().trim().max(20_000);
