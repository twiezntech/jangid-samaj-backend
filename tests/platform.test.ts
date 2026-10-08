import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { API, ORIGIN, createMember, loginAs, publicGet } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, admin: Client, sales: Client, support: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  admin = await loginAs("admin@jangidsamaj.local");
  sales = await loginAs("sales@jangidsamaj.local");
  support = await loginAs("support@jangidsamaj.local");
});

describe("reports", () => {
  it("members report public items once; moderators work the queue", async () => {
    const { client: m } = await createMember();
    expect((await m.post("/reports", { targetType: "NEWS", targetId: "national-mahasabha-2026", reason: "WRONG_INFO", details: "Date is wrong" })).status).toBe(201);
    expect((await m.post("/reports", { targetType: "NEWS", targetId: "national-mahasabha-2026", reason: "SPAM" })).body.alreadyReported).toBe(true);
    expect((await m.post("/reports", { targetType: "NEWS", targetId: "no-such-story", reason: "SPAM" })).status).toBe(404);
    expect((await m.post("/reports", { targetType: "USER", targetId: "x", reason: "SPAM" })).status).toBe(400);

    expect((await m.get("/reports/manage")).status).toBe(403);
    const q = await support.get("/reports/manage?status=NEW");
    const r = q.body.items.find((i: { targetId: string }) => i.targetId === "national-mahasabha-2026");
    expect(r.link.site).toBe("/news/national-mahasabha-2026");
    expect((await support.patch(`/reports/manage/${r.id}`, { status: "CLOSED", adminNote: "Corrected" })).body.status).toBe("CLOSED");
  });
});

describe("ads", () => {
  const ad = (over: Record<string, unknown> = {}) => ({
    name: "Diwali offer",
    advertiser: "Shree Furniture",
    placement: "SIDEBAR",
    imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc",
    linkUrl: "https://example.com/offer",
    altText: "Diwali furniture offer",
    startsAt: new Date(Date.now() - 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    ...over,
  });

  it("serves only live campaigns, targets areas and counts clicks", async () => {
    const live = await sales.post("/ads/manage", ad());
    expect(live.status).toBe(201);
    await sales.post("/ads/manage", ad({ name: "Future", startsAt: new Date(Date.now() + 86400_000).toISOString() }));
    const haryana = await sales.post("/ads/manage", ad({ name: "Rohtak only", locationPath: "haryana/rohtak" }));

    const served = await publicGet("/ads?placement=SIDEBAR&count=4");
    const names = served.body.items.map((i: { id: string }) => i.id);
    expect(names).toContain(live.body.id);
    expect(names).not.toContain(haryana.body.id); // targeted ad needs a matching area
    expect(served.body.items[0].linkUrl).toBeUndefined(); // clicks go through the counter

    const inArea = await publicGet("/ads?placement=SIDEBAR&count=4&location=haryana/rohtak/rohtak");
    expect(inArea.body.items.map((i: { id: string }) => i.id)).toContain(haryana.body.id);

    const click = await publicGet(`/ads/${live.body.id}/click`);
    expect(click.status).toBe(302);
    expect(click.headers.location).toBe("https://example.com/offer");
    await request(app).post(`${API}/ads/${live.body.id}/impression`).set("Origin", ORIGIN);
    const row = await prisma.ad.findUniqueOrThrow({ where: { id: live.body.id } });
    expect(row.clicks).toBe(1);
    expect(row.impressions).toBe(1);
  });

  it("validates campaigns and needs ad.manage", async () => {
    expect((await sales.post("/ads/manage", ad({ linkUrl: "javascript:alert(1)" }))).status).toBe(400);
    expect((await sales.post("/ads/manage", ad({ endsAt: new Date(Date.now() - 86400_000).toISOString() }))).status).toBe(400);
    expect((await editor.post("/ads/manage", ad())).status).toBe(403);
  });
});

describe("analytics", () => {
  it("counts page views per day without personal data and ignores bots", async () => {
    const send = (path: string, ua = "Mozilla/5.0", q?: string) => request(app).post(`${API}/analytics/view`).set("Origin", ORIGIN).set("User-Agent", ua).send({ path, ...(q ? { q } : {}) });
    expect((await send("/news/national-mahasabha-2026")).status).toBe(204);
    await send("/news/national-mahasabha-2026?utm=x");
    await send("/news/national-mahasabha-2026", "Googlebot/2.1");
    await send("/search", "Mozilla/5.0", "Parichay");
    await send("javascript:alert(1)");

    const rows = await prisma.dailyPageView.findMany({ where: { path: "/news/national-mahasabha-2026" } });
    expect(rows.reduce((s, r) => s + r.views, 0)).toBe(2);
    expect(rows[0].section).toBe("news");

    const o = await editor.get("/analytics/overview?days=7");
    expect(o.status).toBe(200);
    expect(o.body.series).toHaveLength(7);
    expect(o.body.topPages[0].path).toBe("/news/national-mahasabha-2026");
    expect(o.body.topSearches[0].term).toBe("parichay");
    expect((await support.get("/analytics/overview")).status).toBe(403);
  });
});

describe("announcements", () => {
  it("delivers to every member, or only members of one area", async () => {
    const { client: jaipur } = await createMember();
    await jaipur.patch("/account/profile", { locationPath: "rajasthan/jaipur/jaipur" });
    const { client: elsewhere } = await createMember();

    const preview = await editor.get("/announcements/audience?locationPath=rajasthan");
    expect(preview.body.recipients).toBeGreaterThan(0);

    const sent = await editor.post("/announcements", { titleHi: "जयपुर बैठक", titleEn: "Jaipur meeting", link: "/events", locationPath: "rajasthan" });
    expect(sent.status).toBe(201);
    expect((await jaipur.get("/account/notifications")).body.items[0]).toMatchObject({ type: "ANNOUNCEMENT", titleEn: "Jaipur meeting", link: "/events" });
    expect((await elsewhere.get("/account/notifications")).body.items).toHaveLength(0);

    expect((await editor.post("/announcements", { titleHi: "x", titleEn: "y", link: "https://evil.example" })).status).toBe(400);
    const { client: m } = await createMember();
    expect((await m.post("/announcements", { titleHi: "सभी को", titleEn: "To all" })).status).toBe(403);
    expect((await admin.get("/announcements")).body.items[0].recipients).toBeGreaterThan(0);
  });
});
