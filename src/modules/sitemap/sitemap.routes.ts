import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { publicCache } from "../../middleware/httpCache";
import * as news from "../news/news.service";
import * as directory from "../directory/directory.service";
import * as leaders from "../leaders/leaders.service";
import * as events from "../events/events.service";
import * as business from "../business/business.service";
import { prisma } from "../../config/prisma";

export const sitemapRouter = Router();

/** Everything the website needs to build sitemap.xml, in one cheap cached call. */
sitemapRouter.get(
  "/",
  publicCache(600),
  asyncHandler(async (_req, res) => {
    const [n, d, l, e, b, locations] = await Promise.all([
      news.listSitemap(),
      directory.listSitemap(),
      leaders.listSitemap(),
      events.listSitemap(),
      business.listSitemap(),
      prisma.location.findMany({ where: { isActive: true, level: { in: ["STATE", "DISTRICT", "CITY"] } }, select: { path: true, level: true }, orderBy: { path: "asc" } }),
    ]);
    res.json({ news: n, directory: d, leaders: l, events: e, businesses: b, locations });
  })
);
