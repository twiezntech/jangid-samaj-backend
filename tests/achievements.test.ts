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

const achievement = (over: Record<string, unknown> = {}) => ({
  category: "STUDENT",
  locationPath: "rajasthan/jaipur/jaipur",
  achievedOn: "2026-05-01",
  translations: { en: { personName: `Test Person ${rid()}`, title: `Topped the state exam ${rid()}`, description: "Secured first rank." } },
  ...over,
});

describe("achievements", () => {
  it("member submissions wait for review, then go public", async () => {
    const { client: member } = await createMember();
    const created = await member.post("/achievements", achievement());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/achievements/${created.body.slug}`)).status).toBe(404);

    expect((await member.post(`/achievements/${created.body.id}/approve`)).status).toBe(403);
    expect((await member.post(`/achievements/${created.body.id}/feature`)).status).toBe(403);

    expect((await editor.post(`/achievements/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");
    const pub = await publicGet(`/achievements/${created.body.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.translations.en.personName).toMatch(/^Test Person/);
    expect(pub.body.createdById).toBeUndefined();
  });

  it("rejection needs a reason; the author can fix and resubmit, but not edit once published", async () => {
    const { client: member } = await createMember();
    const a = await member.post("/achievements", achievement());

    expect((await editor.post(`/achievements/${a.body.id}/reject`, {})).status).toBe(400);
    const rejected = await editor.post(`/achievements/${a.body.id}/reject`, { reason: "Please add a photo" });
    expect(rejected.body.status).toBe("REJECTED");
    const seen = await member.get(`/achievements/manage/${a.body.id}`);
    expect(seen.body.rejectionReason).toBe("Please add a photo");

    expect((await member.patch(`/achievements/${a.body.id}`, { category: "SPORTS" })).status).toBe(200);
    expect((await member.post(`/achievements/${a.body.id}/submit`)).body.status).toBe("PENDING_REVIEW");

    await editor.post(`/achievements/${a.body.id}/approve`);
    expect((await member.patch(`/achievements/${a.body.id}`, { category: "SOCIAL" })).status).toBe(403);
  });

  it("an author can withdraw their own unpublished submission, but not archive a published one", async () => {
    const { client: member } = await createMember();
    const a = await member.post("/achievements", achievement());
    expect((await member.post(`/achievements/${a.body.id}/archive`)).body.status).toBe("ARCHIVED");

    const b = await member.post("/achievements", achievement());
    await editor.post(`/achievements/${b.body.id}/approve`);
    expect((await member.post(`/achievements/${b.body.id}/archive`)).status).toBe(403);
  });

  it("other members cannot read or touch someone else's submission", async () => {
    const { client: owner } = await createMember();
    const { client: other } = await createMember();
    const a = await owner.post("/achievements", achievement());
    expect((await other.get(`/achievements/manage/${a.body.id}`)).status).toBe(404);
    expect((await other.patch(`/achievements/${a.body.id}`, { category: "SPORTS" })).status).toBe(403);
    expect((await other.post(`/achievements/${a.body.id}/submit`)).status).toBe(403);
  });

  it("managers publish directly; scoped admins stay inside their area", async () => {
    const own = await district.post("/achievements", achievement());
    expect(own.body.status).toBe("PUBLISHED");
    expect((await district.post("/achievements", achievement({ locationPath: "haryana/rohtak/rohtak" }))).status).toBe(403);

    const haryana = await editor.post("/achievements", achievement({ locationPath: "haryana/rohtak/rohtak" }));
    expect((await district.post(`/achievements/${haryana.body.id}/archive`)).status).toBe(403);
    expect((await district.post(`/achievements/${haryana.body.id}/feature`)).status).toBe(403);
    expect((await district.get(`/achievements/manage/${haryana.body.id}`)).status).toBe(404);
  });

  it("featured achievements come first and lose the flag when unpublished", async () => {
    const plain = await editor.post("/achievements", achievement({ achievedOn: "2026-06-01" }));
    const star = await editor.post("/achievements", achievement({ achievedOn: "2020-01-01" }));
    expect((await editor.post(`/achievements/${star.body.id}/feature`)).body.isFeatured).toBe(true);

    const list = await publicGet("/achievements?limit=50");
    const slugs = list.body.items.map((i: { slug: string }) => i.slug);
    expect(slugs.indexOf(star.body.slug)).toBeLessThan(slugs.indexOf(plain.body.slug));

    const onlyFeatured = await publicGet("/achievements?featured=true&limit=50");
    expect(onlyFeatured.body.items.every((i: { isFeatured: boolean }) => i.isFeatured)).toBe(true);

    expect((await editor.post(`/achievements/${star.body.id}/archive`)).body.isFeatured).toBe(false);
    expect((await editor.post(`/achievements/${star.body.id}/feature`)).status).toBe(409); // archived items cannot be featured
    expect((await editor.post(`/achievements/${star.body.id}/restore`)).body.status).toBe("DRAFT");
    expect((await editor.post(`/achievements/${star.body.id}/feature`)).status).toBe(409); // drafts neither
  });

  it("validates input and blocks mass assignment", async () => {
    const { client: member } = await createMember();
    expect((await member.post("/achievements", achievement({ category: "NOPE" }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ locationPath: "nowhere/x" }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ translations: {} }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ photoUrl: "https://evil.example/x.jpg" }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ achievedOn: "2999-01-01" }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ status: "PUBLISHED" }))).status).toBe(400);
    expect((await member.post("/achievements", achievement({ isFeatured: true }))).status).toBe(403);
    expect((await member.post("/achievements", achievement({ sortOrder: 1 }))).status).toBe(403);
  });

  it("strips markup from text fields", async () => {
    const created = await editor.post(
      "/achievements",
      achievement({ translations: { en: { personName: "<b>Asha</b> Jangid", title: "<script>alert(1)</script>Won a medal", description: "<img src=x onerror=alert(1)>Great" } } })
    );
    const pub = (await publicGet(`/achievements/${created.body.slug}`)).body.translations.en;
    expect(pub.personName).toBe("Asha Jangid");
    expect(pub.title).not.toContain("<");
    expect(pub.description).not.toContain("<");
  });

  it("requires login to submit and filters the public list", async () => {
    expect((await publicGet("/achievements/manage/list")).status).toBe(401);
    const res = await publicGet("/achievements?category=SPORTS&location=haryana&limit=50");
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: { category: string }) => i.category === "SPORTS")).toBe(true);
    expect((await publicGet("/achievements?category=NOPE")).status).toBe(400);
    expect((await publicGet("/achievements?q=Kavya")).body.items.length).toBeGreaterThan(0);
  });

  it("only a super admin can delete, and the deletion is audited", async () => {
    const a = await editor.post("/achievements", achievement()); // published by mistake
    expect((await publicGet(`/achievements/${a.body.slug}`)).status).toBe(200);

    const { client: member } = await createMember();
    expect((await member.delete(`/achievements/${a.body.id}`)).status).toBe(403);
    expect((await district.delete(`/achievements/${a.body.id}`)).status).toBe(403);
    expect((await editor.delete(`/achievements/${a.body.id}`)).status).toBe(403);
    expect((await publicGet(`/achievements/${a.body.slug}`)).status).toBe(200);

    expect((await admin.delete(`/achievements/${a.body.id}`)).body.deleted).toBe(true);
    expect((await publicGet(`/achievements/${a.body.slug}`)).status).toBe(404);
    expect((await admin.delete(`/achievements/${a.body.id}`)).status).toBe(404);

    const log = await prisma.auditLog.findFirst({ where: { action: "achievement.delete", entityId: a.body.id } });
    expect(log?.meta).toMatchObject({ slug: a.body.slug, status: "PUBLISHED" });
  });

  it("appears in the sitemap feed and the dashboard counts", async () => {
    const site = await publicGet("/sitemap");
    expect(Array.isArray(site.body.achievements)).toBe(true);
    const stats = await editor.get("/admin/stats");
    expect(stats.body.content.achievements.published).toBeGreaterThan(0);
  });
});
