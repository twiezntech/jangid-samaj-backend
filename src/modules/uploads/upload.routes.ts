import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import express, { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { requireActor, requirePermission } from "../../middleware/auth";
import { noStore } from "../../middleware/httpCache";

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const uploadRoot = path.resolve(env.uploadDir);

/** Identify the real format from magic bytes; the client-declared MIME type and file name are ignored. */
function sniff(buf: Buffer): { ext: "jpg" | "png" | "webp"; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

/** 60 images / 15 min per account: plenty for an editor, a hard stop for abuse. */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "anon",
  message: { error: { message: "Too many uploads. Please try again later.", code: "RATE_LIMITED" } },
  skip: () => process.env.NODE_ENV === "test",
});

export const uploadRouter = Router();

uploadRouter.post(
  "/image",
  requireActor,
  noStore,
  uploadLimiter,
  requirePermission("media.upload"),
  (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(ApiError.badRequest(err.code === "LIMIT_FILE_SIZE" ? "Image must be 3 MB or smaller" : "Invalid upload", undefined, "INVALID_UPLOAD"));
      }
      next(err as Error | undefined);
    }),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest("Attach an image in the 'file' field", undefined, "INVALID_UPLOAD");
    const kind = sniff(file.buffer);
    if (!kind) throw ApiError.badRequest("Only JPG, PNG or WebP images are allowed", undefined, "INVALID_UPLOAD");

    const now = new Date();
    const rel = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), `${randomBytes(12).toString("hex")}.${kind.ext}`);
    const abs = path.join(uploadRoot, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.buffer, { flag: "wx" });

    const url = `${env.publicApiUrl}/uploads/${rel}`;
    const media = await prisma.media.create({ data: { url, mime: kind.mime, size: file.size, uploadedById: req.actor!.id }, select: { id: true, url: true, mime: true, size: true } });
    res.status(201).json(media);
  })
);

/** PDF documents (matrimony biodata). Only real PDFs by magic bytes, 2 MB max. */
uploadRouter.post(
  "/document",
  requireActor,
  noStore,
  uploadLimiter,
  requirePermission("media.upload"),
  (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(ApiError.badRequest(err.code === "LIMIT_FILE_SIZE" ? "Document must be 2 MB or smaller" : "Invalid upload", undefined, "INVALID_UPLOAD"));
      }
      next(err as Error | undefined);
    }),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest("Attach a PDF in the 'file' field", undefined, "INVALID_UPLOAD");
    if (file.size > MAX_DOCUMENT_BYTES) throw ApiError.badRequest("Document must be 2 MB or smaller", undefined, "INVALID_UPLOAD");
    if (file.buffer.length < 5 || file.buffer.toString("ascii", 0, 5) !== "%PDF-") throw ApiError.badRequest("Only PDF documents are allowed", undefined, "INVALID_UPLOAD");

    const now = new Date();
    const rel = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), `${randomBytes(12).toString("hex")}.pdf`);
    const abs = path.join(uploadRoot, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.buffer, { flag: "wx" });

    const url = `${env.publicApiUrl}/uploads/${rel}`;
    const media = await prisma.media.create({ data: { url, mime: "application/pdf", size: file.size, uploadedById: req.actor!.id }, select: { id: true, url: true, mime: true, size: true } });
    res.status(201).json(media);
  })
);

/**
 * Static serving for uploaded files. Names are random and never reused, so they can be cached forever.
 * The sandbox CSP + nosniff mean even a crafted file can never execute as a page on our origin.
 */
export const serveUploads = express.static(uploadRoot, {
  index: false,
  dotfiles: "deny",
  immutable: true,
  maxAge: "365d",
  fallthrough: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".pdf")) res.setHeader("Content-Disposition", 'attachment; filename="biodata.pdf"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});
