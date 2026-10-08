import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { publicCache } from "../../middleware/httpCache";
import * as news from "../news/news.service";
import * as directory from "../directory/directory.service";
import * as leaders from "../leaders/leaders.service";
import * as events from "../events/events.service";
import * as business from "../business/business.service";
import * as achievements from "../achievements/achievements.service";
import * as obituaries from "../obituaries/obituaries.service";
import * as jobs from "../jobs/jobs.service";
import * as gallery from "../gallery/gallery.service";
import { prisma } from "../../config/prisma";

export const sitemapRouter = Router();

type Refs = { stateId: string | null; districtId: string | null; cityId: string | null };
const refSelect = { stateId: true, districtId: true, cityId: true } as const;
const refDistinct: ("stateId" | "districtId" | "cityId")[] = ["stateId", "districtId", "cityId"];
const live = { status: "PUBLISHED" as const };

/** Location ids (state, district and city) that hold at least one published record. */
const usedIds = (rows: Refs[]) => new Set(rows.flatMap((r) => [r.stateId, r.districtId, r.cityId]).filter((id): id is string => !!id));

/**
 * Everything the website needs to build sitemap.xml, in one cheap cached call.
 * `places` lists, per section, only the state/district/city pages that actually have content,
 * so the sitemap never advertises empty (thin) location pages.
 */
sitemapRouter.get(
  "/",
  publicCache(600),
  asyncHandler(async (_req, res) => {
    const [n, d, l, e, b, a, o, j, g, locations, refs] = await Promise.all([
      news.listSitemap(),
      directory.listSitemap(),
      leaders.listSitemap(),
      events.listSitemap(),
      business.listSitemap(),
      achievements.listSitemap(),
      obituaries.listSitemap(),
      jobs.listSitemap(),
      gallery.listSitemap(),
      prisma.location.findMany({ where: { isActive: true, level: { in: ["STATE", "DISTRICT", "CITY"] } }, select: { id: true, path: true, level: true }, orderBy: { path: "asc" } }),
      Promise.all([
        prisma.news.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.directoryEntry.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.leaderProfile.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.event.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.business.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.achievement.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.obituary.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.job.findMany({ where: live, select: refSelect, distinct: refDistinct }),
        prisma.album.findMany({ where: live, select: refSelect, distinct: refDistinct }),
      ]),
    ]);

    const sections = ["news", "directory", "leaders", "events", "business", "achievements", "obituaries", "jobs", "gallery"] as const;
    const places = Object.fromEntries(
      sections.map((s, i) => {
        const ids = usedIds(refs[i]);
        return [s, locations.filter((loc) => ids.has(loc.id)).map((loc) => loc.path)];
      })
    );

    res.json({
      news: n,
      directory: d,
      leaders: l,
      events: e,
      businesses: b,
      achievements: a,
      obituaries: o,
      jobs: j,
      albums: g,
      locations: locations.map(({ path, level }) => ({ path, level })),
      places,
    });
  })
);
