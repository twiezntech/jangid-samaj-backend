import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, district: Client, admin: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  district = await loginAs("district@jangidsamaj.local");
  admin = await loginAs("admin@jangidsamaj.local");
});

const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600_000).toISOString().slice(0, 10);

const job = (over: Record<string, unknown> = {}) => ({
  type: "FULL_TIME",
  organisationName: "Test Furniture Works",
  locationPath: "rajasthan/jaipur/jaipur",
  salaryMin: 15000,
  salaryMax: 25000,
  lastDate: inDays(10),
  applyPhone: "9829011111",
  translations: { en: { title: `Carpenter needed ${rid()}`, description: "We need an experienced carpenter for our workshop in Jaipur." } },
  ...over,
});

describe("jobs", () => {
  it("member posts wait for review, then go public and collect applications", async () => {
    const { client: poster } = await createMember();
    const created = await poster.post("/jobs", job());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/jobs/${created.body.slug}`)).status).toBe(404);
    expect((await poster.post(`/jobs/${created.body.id}/approve`)).status).toBe(403);
    expect((await editor.post(`/jobs/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");

    const pub = await publicGet(`/jobs/${created.body.slug}`);
    expect(pub.body.isOpen).toBe(true);
    expect(pub.body.createdById).toBeUndefined();

    const { client: seeker } = await createMember();
    const app = await seeker.post(`/jobs/${created.body.id}/apply`, { name: "Seeker", phone: "9829022222", message: "I have five years of experience." });
    expect(app.status).toBe(201);
    expect((await seeker.post(`/jobs/${created.body.id}/apply`, { name: "Seeker", phone: "9829022222", message: "Applying again please." })).status).toBe(409);
    expect((await poster.post(`/jobs/${created.body.id}/apply`, { name: "Poster", phone: "9829022222", message: "Applying to my own job." })).status).toBe(400);
    expect((await seeker.get(`/jobs/${created.body.id}/application`)).body.application.status).toBe("NEW");

    const apps = await poster.get(`/jobs/manage/${created.body.id}/applications`);
    expect(apps.body.items[0].phone).toBe("9829022222");
    expect((await seeker.get(`/jobs/manage/${created.body.id}/applications`)).status).toBe(404);
    expect((await poster.patch(`/jobs/applications/${app.body.id}`, { status: "CLOSED" })).body.status).toBe("CLOSED");

    const inbox = await poster.get("/account/notifications");
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(["APPROVED", "JOB_APPLICATION"]));
  });

  it("expired posts leave the list and stop taking applications", async () => {
    const j = await editor.post("/jobs", job({ lastDate: inDays(1) }));
    await prisma.job.update({ where: { id: j.body.id }, data: { lastDate: new Date(Date.now() - 3 * 24 * 3600_000) } });
    const list = await publicGet("/jobs?limit=50");
    expect(list.body.items.some((i: { slug: string }) => i.slug === j.body.slug)).toBe(false);
    expect((await publicGet(`/jobs/${j.body.slug}`)).body.isOpen).toBe(false);
    const { client: seeker } = await createMember();
    expect((await seeker.post(`/jobs/${j.body.id}/apply`, { name: "Late", phone: "9829033333", message: "Is this still open please?" })).status).toBe(409);
  });

  it("validates input, blocks mass assignment and keeps scoped admins in their area", async () => {
    const { client: m } = await createMember();
    expect((await m.post("/jobs", job({ salaryMin: 50000, salaryMax: 1000 }))).status).toBe(400);
    expect((await m.post("/jobs", job({ lastDate: "2020-01-01" }))).status).toBe(400);
    expect((await m.post("/jobs", job({ applyUrl: "http://insecure.example" }))).status).toBe(400);
    expect((await m.post("/jobs", job({ type: "SLAVERY" }))).status).toBe(400);
    expect((await m.post("/jobs", job({ isFeatured: true }))).status).toBe(403);
    expect((await m.post("/jobs", job({ status: "PUBLISHED" }))).status).toBe(400);
    expect((await m.post("/jobs", job({ businessSlug: "shree-vishwakarma-furniture-jaipur" }))).status).toBe(403); // not their business
    expect((await district.post("/jobs", job({ locationPath: "haryana/rohtak/rohtak" }))).status).toBe(403);
  });

  it("filters the public list and only a super admin deletes", async () => {
    const j = await editor.post("/jobs", job({ type: "INTERNSHIP", workMode: "REMOTE" }));
    const res = await publicGet("/jobs?type=INTERNSHIP&workMode=REMOTE&limit=50");
    expect(res.body.items.every((i: { type: string; workMode: string }) => i.type === "INTERNSHIP" && i.workMode === "REMOTE")).toBe(true);
    expect((await editor.delete(`/jobs/${j.body.id}`)).status).toBe(403);
    expect((await admin.delete(`/jobs/${j.body.id}`)).body.deleted).toBe(true);
    expect((await publicGet(`/jobs/${j.body.slug}`)).status).toBe(404);
  });
});

const album = (over: Record<string, unknown> = {}) => ({
  locationPath: "rajasthan/jaipur/jaipur",
  takenOn: "2026-05-01",
  items: [
    { kind: "PHOTO", url: "https://images.unsplash.com/photo-1548013146-72479768bada", caption: "Procession" },
    { kind: "VIDEO", url: "https://youtu.be/dQw4w9WgXcQ" },
  ],
  translations: { en: { title: `Samaj meet ${rid()}` } },
  ...over,
});

describe("gallery", () => {
  it("member albums wait for review; photos and YouTube videos are stored safely", async () => {
    const { client: m } = await createMember();
    const a = await m.post("/gallery", album());
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("PENDING_REVIEW");
    expect((await editor.post(`/gallery/${a.body.id}/approve`)).body.status).toBe("PUBLISHED");

    const pub = await publicGet(`/gallery/${a.body.slug}`);
    expect(pub.body.items).toHaveLength(2);
    expect(pub.body.items[1].url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(pub.body.coverUrl).toBe("https://images.unsplash.com/photo-1548013146-72479768bada");

    const list = await publicGet("/gallery?videos=true&limit=50");
    const card = list.body.items.find((i: { slug: string }) => i.slug === a.body.slug);
    expect(card).toMatchObject({ photos: 1, videos: 1 });
  });

  it("rejects unsafe media and empty albums", async () => {
    const { client: m } = await createMember();
    expect((await m.post("/gallery", album({ items: [{ kind: "PHOTO", url: "https://evil.example/x.jpg" }] }))).status).toBe(400);
    expect((await m.post("/gallery", album({ items: [{ kind: "VIDEO", url: "https://vimeo.com/123" }] }))).status).toBe(400);
    expect((await m.post("/gallery", album({ items: [{ kind: "AUDIO", url: "https://x.y" }] }))).status).toBe(400);
    const empty = await editor.post("/gallery", album({ items: [] }));
    await editor.post(`/gallery/${empty.body.id}/archive`);
    await editor.post(`/gallery/${empty.body.id}/restore`);
    expect((await editor.post(`/gallery/${empty.body.id}/approve`)).status).toBe(400);
  });

  it("links albums to an event and lists them per event", async () => {
    const a = await editor.post("/gallery", album({ eventSlug: "vishwakarma-jayanti-mahotsav" }));
    const res = await publicGet("/gallery?event=vishwakarma-jayanti-mahotsav&limit=50");
    expect(res.body.items.some((i: { slug: string }) => i.slug === a.body.slug)).toBe(true);
    expect((await editor.post("/gallery", album({ eventSlug: "no-such-event" }))).status).toBe(400);
  });

  it("shows up in the sitemap and dashboard", async () => {
    const site = await publicGet("/sitemap");
    expect(Array.isArray(site.body.albums)).toBe(true);
    expect(Array.isArray(site.body.jobs)).toBe(true);
    expect(site.body.places.gallery.length).toBeGreaterThan(0);
    const stats = await editor.get("/admin/stats");
    expect(stats.body.content.gallery.published).toBeGreaterThan(0);
    expect(stats.body.content.jobs.open).toBeGreaterThan(0);
  });
});
