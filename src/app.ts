import express, { NextFunction, Request, Response, Router } from "express";
import { randomUUID } from "crypto";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/prisma";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requireTrustedOrigin } from "./middleware/auth";
import { publicReadLimiter } from "./middleware/rateLimits";
import { authRouter } from "./modules/auth/auth.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { locationRouter } from "./modules/locations/location.routes";
import { taxonomyRouter } from "./modules/taxonomy/taxonomy.routes";
import { newsRouter } from "./modules/news/news.routes";
import { directoryRouter } from "./modules/directory/directory.routes";
import { leadersRouter } from "./modules/leaders/leaders.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { sitemapRouter } from "./modules/sitemap/sitemap.routes";
import { eventsRouter } from "./modules/events/events.routes";
import { businessRouter } from "./modules/business/business.routes";
import { achievementsRouter } from "./modules/achievements/achievements.routes";
import { gotraRouter } from "./modules/gotra/gotra.routes";
import { obituariesRouter } from "./modules/obituaries/obituaries.routes";
import { accountRouter } from "./modules/account/account.routes";
import { jobsRouter } from "./modules/jobs/jobs.routes";
import { galleryRouter } from "./modules/gallery/gallery.routes";
import { matrimonyRouter } from "./modules/matrimony/matrimony.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { adsRouter } from "./modules/ads/ads.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { serveUploads, uploadRouter } from "./modules/uploads/upload.routes";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.isProd ? 1 : false);

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
  })
);
app.use(helmet());
app.use(cors({ origin: env.corsOrigins, credentials: true, maxAge: 600 }));

// Article bodies are large; everything else stays tiny to shrink the abuse surface.
const smallJson = express.json({ limit: "16kb" });
const contentJson = express.json({ limit: "600kb" });
app.use((req: Request, res: Response, next: NextFunction) => (/^\/api\/v1\/(news|directory|leaders|events|business|achievements|obituaries|jobs|gallery|matrimony)/.test(req.path) ? contentJson : smallJson)(req, res, next));
app.use(cookieParser());

// Uploaded images (random, immutable names). Registered before the 404 handler.
app.use("/uploads", serveUploads);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

const v1 = Router();
v1.use(requireTrustedOrigin, publicReadLimiter);
v1.use("/auth", authRouter);
v1.use("/feedback", feedbackRouter);
v1.use("/locations", locationRouter);
v1.use("/", taxonomyRouter);
v1.use("/news", newsRouter);
v1.use("/directory", directoryRouter);
v1.use("/leaders", leadersRouter);
v1.use("/events", eventsRouter);
v1.use("/business", businessRouter);
v1.use("/achievements", achievementsRouter);
v1.use("/gotra", gotraRouter);
v1.use("/obituaries", obituariesRouter);
v1.use("/account", accountRouter);
v1.use("/jobs", jobsRouter);
v1.use("/gallery", galleryRouter);
v1.use("/matrimony", matrimonyRouter);
v1.use("/reports", reportsRouter);
v1.use("/ads", adsRouter);
v1.use("/analytics", analyticsRouter);
v1.use("/announcements", announcementsRouter);
v1.use("/uploads", uploadRouter);
v1.use("/admin", adminRouter);
v1.use("/sitemap", sitemapRouter);
app.use("/api/v1", v1);

app.use(notFoundHandler);
app.use(errorHandler);
