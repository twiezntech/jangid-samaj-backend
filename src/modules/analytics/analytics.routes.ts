import { Router } from "express";
import rateLimit from "express-rate-limit";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { noStore } from "../../middleware/httpCache";
import { optionalActor, requireActor, requirePermission } from "../../middleware/auth";
import { logger } from "../../config/logger";

/**
 * Privacy-friendly analytics: the website reports a page path (no cookies, no IP stored, no user id)
 * and the API keeps one counter per day and path. Search terms are counted the same way.
 * Signed-in members additionally get one "was active" row per day (no page, no search), which feeds retention.
 */

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse/i;
const PATH = /^\/[a-z0-9/_-]{0,180}$/;

const viewSchema = z
  .object({
    path: z.string().trim().max(200),
    q: z.string().trim().min(2).max(60).optional(),
  })
  .strict();

const overviewQuery = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) });

const todayIst = () => new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
const DAY = 24 * 3600_000;

const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });

export const analyticsRouter = Router();

analyticsRouter.post(
  "/view",
  viewLimiter,
  optionalActor,
  asyncHandler(async (req, res) => {
    res.status(204).end();
    if (BOT.test(req.headers["user-agent"] ?? "")) return;
    const parsed = viewSchema.safeParse(req.body);
    if (!parsed.success) return;
    // Detail pages are grouped by their URL; query strings never reach the counter.
    const path = parsed.data.path.split("?")[0].toLowerCase();
    if (!PATH.test(path)) return;
    const section = path.split("/")[1] || "home";
    const day = todayIst();
    try {
      // Signed-in members only: one row per member per day, for retention. Never tied to a page or a search.
      if (req.actor) await prisma.userActivityDay.upsert({ where: { userId_day: { userId: req.actor.id, day } }, create: { userId: req.actor.id, day }, update: {} });
      await prisma.dailyPageView.upsert({ where: { day_path: { day, path } }, create: { day, path, section, views: 1 }, update: { views: { increment: 1 } } });
      if (parsed.data.q) {
        const term = parsed.data.q.toLowerCase().replace(/\s+/g, " ");
        await prisma.dailySearch.upsert({ where: { day_term: { day, term } }, create: { day, term, count: 1 }, update: { count: { increment: 1 } } });
      }
    } catch (e) {
      // The response is already sent. Two first-views racing on the insert just lose one count.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) logger.warn({ err: e }, "page view not counted");
    }
  })
);

analyticsRouter.get(
  "/overview",
  requireActor,
  requirePermission("analytics.read"),
  noStore,
  asyncHandler(async (req, res) => {
    const { days } = overviewQuery.parse(req.query);
    const to = todayIst();
    const from = new Date(to.getTime() - (days - 1) * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);
    const range = { gte: from, lte: to };

    const [daily, sections, pages, searches, prev, signups, interests, ads, contacts] = await Promise.all([
      prisma.dailyPageView.groupBy({ by: ["day"], where: { day: range }, _sum: { views: true }, orderBy: { day: "asc" } }),
      prisma.dailyPageView.groupBy({ by: ["section"], where: { day: range }, _sum: { views: true }, orderBy: { _sum: { views: "desc" } } }),
      prisma.dailyPageView.groupBy({ by: ["path"], where: { day: range }, _sum: { views: true }, orderBy: { _sum: { views: "desc" } }, take: 15 }),
      prisma.dailySearch.groupBy({ by: ["term"], where: { day: range }, _sum: { count: true }, orderBy: { _sum: { count: "desc" } }, take: 15 }),
      prisma.dailyPageView.aggregate({ where: { day: { gte: prevFrom, lt: from } }, _sum: { views: true } }),
      prisma.user.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      prisma.matrimonyInterest.count({ where: { createdAt: { gte: from } } }),
      prisma.ad.aggregate({ _sum: { impressions: true, clicks: true } }),
      Promise.all([
        prisma.businessEnquiry.count({ where: { createdAt: { gte: from } } }),
        prisma.jobApplication.count({ where: { createdAt: { gte: from } } }),
        prisma.eventRegistration.count({ where: { createdAt: { gte: from } } }),
      ]),
    ]);

    // Fill gaps so the chart has one point per day.
    const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d._sum.views ?? 0]));
    const signupByDay = new Map<string, number>();
    for (const u of signups) {
      const k = new Date(u.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      signupByDay.set(k, (signupByDay.get(k) ?? 0) + 1);
    }
    const series = Array.from({ length: days }, (_, i) => {
      const k = new Date(from.getTime() + i * DAY).toISOString().slice(0, 10);
      return { day: k, views: byDay.get(k) ?? 0, signups: signupByDay.get(k) ?? 0 };
    });
    const total = series.reduce((s, d) => s + d.views, 0);

    const retention = await retentionStats(days);

    res.json({
      days,
      totals: {
        views: total,
        previousViews: prev._sum.views ?? 0,
        signups: signups.length,
        interests,
        enquiries: contacts[0],
        jobApplications: contacts[1],
        registrations: contacts[2],
        adImpressions: ads._sum.impressions ?? 0,
        adClicks: ads._sum.clicks ?? 0,
      },
      series,
      sections: sections.map((s) => ({ section: s.section, views: s._sum.views ?? 0 })),
      topPages: pages.map((p) => ({ path: p.path, views: p._sum.views ?? 0 })),
      topSearches: searches.map((s) => ({ term: s.term, count: s._sum.count ?? 0 })),
      retention,
    });
  })
);

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10);
const WEEK = 7 * DAY;
const COHORTS = 6;

/**
 * Active members (today / 7 / 30 days), members who came back on a second day, and weekly sign-up cohorts:
 * the share of each cohort that returned in each of the following three weeks.
 */
export async function retentionStats(days: number) {
  const to = todayIst();
  const cohortStart = new Date(to.getTime() - COHORTS * WEEK + DAY); // first day of the oldest cohort week
  const from = new Date(Math.min(cohortStart.getTime(), to.getTime() - 29 * DAY, to.getTime() - (days - 1) * DAY));

  const [activity, signups] = await Promise.all([
    prisma.userActivityDay.findMany({ where: { day: { gte: from, lte: to } }, select: { userId: true, day: true } }),
    prisma.user.findMany({ where: { createdAt: { gte: new Date(cohortStart.getTime() - 330 * 60_000) } }, select: { id: true, createdAt: true } }),
  ]);

  const daysOf = new Map<string, Set<number>>();
  for (const a of activity) {
    const s = daysOf.get(a.userId) ?? new Set<number>();
    s.add(a.day.getTime());
    daysOf.set(a.userId, s);
  }
  const activeBetween = (lo: number, hi: number) => {
    const ids = new Set<string>();
    for (const [id, set] of daysOf) for (const t of set) if (t >= lo && t <= hi) ids.add(id);
    return ids;
  };
  const t0 = to.getTime();
  const periodStart = t0 - (days - 1) * DAY;
  const returning = [...daysOf.values()].filter((set) => [...set].filter((t) => t >= periodStart).length >= 2).length;

  const cohorts = Array.from({ length: COHORTS }, (_, i) => {
    const start = cohortStart.getTime() + i * WEEK;
    const end = start + WEEK - 1;
    const members = signups.filter((u) => {
      const day = new Date(u.createdAt.getTime() + 330 * 60_000).setUTCHours(0, 0, 0, 0);
      return day >= start && day <= end;
    });
    const ids = new Set(members.map((m) => m.id));
    // A later week is only reported once it has fully passed.
    const back = (n: number) => {
      const lo = start + n * WEEK;
      if (lo + WEEK - 1 > t0 || ids.size === 0) return null;
      const active = activeBetween(lo, lo + WEEK - 1);
      let hit = 0;
      for (const id of ids) if (active.has(id)) hit++;
      return Math.round((hit / ids.size) * 100);
    };
    return { weekStart: iso(new Date(start)), size: ids.size, w1: back(1), w2: back(2), w3: back(3) };
  });

  return {
    activeToday: activeBetween(t0, t0).size,
    active7d: activeBetween(t0 - 6 * DAY, t0).size,
    active30d: activeBetween(t0 - 29 * DAY, t0).size,
    returning,
    cohorts,
  };
}
