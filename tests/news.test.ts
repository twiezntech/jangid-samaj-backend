import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { publishDueNews } from "../src/modules/news/news.service";
import { API, ORIGIN, client, createMember, loginAs, newsPayload, publicGet } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let reporter: Client, district: Client, editor: Client;

beforeAll(async () => {
  reporter = await loginAs("reporter@jangidsamaj.local");
  district = await loginAs("district@jangidsamaj.local");
  editor = await loginAs("editor@jangidsamaj.local");
});

describe("public news API", () => {
  it("lists only published stories, newest first, with pagination meta", async () => {
    const res = await publicGet("/news?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    const dates = res.body.items.map((i: { publishedAt: string }) => +new Date(i.publishedAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("filters by location subtree and by category", async () => {
    const res = await publicGet("/news?location=haryana");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) expect(item.location.path.startsWith("haryana")).toBe(true);

    const cat = await publicGet("/news?category=sports");
    for (const item of cat.body.items) expect(item.category.slug).toBe("sports");
  });

  it("rejects oversized pages and malformed location paths", async () => {
    expect((await publicGet("/news?limit=51")).status).toBe(400);
    expect((await publicGet("/news?location=../../etc/passwd")).status).toBe(400);
    expect((await publicGet("/news?location=nowhere")).status).toBe(404);
  });

  it("returns 404 for unknown slugs and sets cache headers", async () => {
    expect((await publicGet("/news/does-not-exist")).status).toBe(404);
    const ok = await publicGet("/news/rohtak-rakt-daan-shivir");
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toContain("s-maxage");
    expect(ok.body.translations.hi.title).toBeTruthy();
    expect(ok.body.translations.en.body).toContain("<p>");
  });
});

describe("editorial workflow", () => {
  it("draft is invisible, submit needs review, only editors publish", async () => {
    const created = await reporter.post("/news", newsPayload());
    expect(created.status).toBe(201);
    const { id, slug } = created.body;
    expect(created.body.status).toBe("DRAFT");
    expect((await publicGet(`/news/${slug}`)).status).toBe(404);

    expect((await reporter.post(`/news/${id}/submit`)).body.status).toBe("PENDING_REVIEW");
    expect((await reporter.post(`/news/${id}/publish`)).status).toBe(403);
    expect((await publicGet(`/news/${slug}`)).status).toBe(404);

    const published = await district.post(`/news/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("PUBLISHED");
    expect((await publicGet(`/news/${slug}`)).status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: id, action: "news.publish" } });
    expect(audit).not.toBeNull();
  });

  it("illegal transitions are refused", async () => {
    const { body } = await reporter.post("/news", newsPayload());
    const res = await editor.post(`/news/${body.id}/reject`, { reason: "not ready yet" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("reject requires a reason and lets the author resubmit", async () => {
    const { body } = await reporter.post("/news", newsPayload());
    await reporter.post(`/news/${body.id}/submit`);
    expect((await editor.post(`/news/${body.id}/reject`, {})).status).toBe(400);
    expect((await editor.post(`/news/${body.id}/reject`, { reason: "Needs a source" })).body.status).toBe("REJECTED");
    expect((await reporter.post(`/news/${body.id}/submit`)).body.status).toBe("PENDING_REVIEW");
  });

  it("scheduled stories go live only once due", async () => {
    const { body } = await reporter.post("/news", newsPayload());
    await reporter.post(`/news/${body.id}/submit`);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await editor.post(`/news/${body.id}/schedule`, { scheduledAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await editor.post(`/news/${body.id}/schedule`, { scheduledAt: future })).body.status).toBe("SCHEDULED");
    expect((await publicGet(`/news/${body.slug}`)).status).toBe(404);

    await publishDueNews();
    expect((await publicGet(`/news/${body.slug}`)).status).toBe(404);

    await prisma.news.update({ where: { id: body.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await publishDueNews()).toBeGreaterThanOrEqual(1);
    expect((await publicGet(`/news/${body.slug}`)).status).toBe(200);
  });
});

describe("access control", () => {
  it("requires authentication and a trusted origin", async () => {
    expect((await request(app).post(`${API}/news`).set("Origin", ORIGIN).send(newsPayload())).status).toBe(401);
    const forged = await reporter.post("/news", newsPayload());
    expect(forged.status).toBe(201);
    // cookie-bearing request from an untrusted origin must be refused (CSRF)
    const res = await request(app).post(`${API}/auth/logout`).set("Origin", "http://evil.example").set("Cookie", "js_at=x").send({});
    expect(res.status).toBe(403);
  });

  it("members cannot write news; reporters cannot flag breaking/featured", async () => {
    const { client: member } = await createMember();
    expect((await member.post("/news", newsPayload())).status).toBe(403);
    const res = await reporter.post("/news", newsPayload({ isBreaking: true }));
    expect(res.status).toBe(403);
  });

  it("location-scoped roles cannot act outside their area", async () => {
    const outside = await reporter.post("/news", newsPayload({ locationPath: "haryana/rohtak/rohtak" }));
    expect(outside.status).toBe(403);
    expect(outside.body.error.code).toBe("OUT_OF_SCOPE");

    const haryana = await editor.post("/news", newsPayload({ locationPath: "haryana/rohtak/rohtak" }));
    expect(haryana.status).toBe(201);
    await editor.post(`/news/${haryana.body.id}/submit`);
    expect((await district.post(`/news/${haryana.body.id}/publish`)).status).toBe(403); // Jaipur admin, Haryana story
    expect((await editor.post(`/news/${haryana.body.id}/publish`)).status).toBe(200);
  });

  it("authors can edit only their own drafts; others get 403/404", async () => {
    const mine = await reporter.post("/news", newsPayload());
    const other = await editor.post("/news", newsPayload());
    expect((await reporter.patch(`/news/${mine.body.id}`, { sourceName: "Me" })).status).toBe(200);
    expect((await reporter.patch(`/news/${other.body.id}`, { sourceName: "Hijack" })).status).toBe(403);
    expect((await reporter.get(`/news/manage/${other.body.id}`)).status).toBe(404);
  });
});

describe("input safety", () => {
  it("sanitises HTML on write", async () => {
    const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src="http://evil.example/x.png"><iframe src="https://evil.example"></iframe>';
    const created = await reporter.post("/news", newsPayload({ translations: { en: { title: "Sanitise me please", body: dirty } } }));
    expect(created.status).toBe(201);
    await reporter.post(`/news/${created.body.id}/submit`);
    await editor.post(`/news/${created.body.id}/publish`);

    const body: string = (await publicGet(`/news/${created.body.slug}`)).body.translations.en.body;
    for (const banned of ["<script", "onclick", "javascript:", "<iframe", "http://evil"]) expect(body).not.toContain(banned);
    expect(body).toContain("Hi");
  });

  it("only allow-listed https image hosts are accepted", async () => {
    expect((await reporter.post("/news", newsPayload({ coverImageUrl: "https://evil.example/a.jpg" }))).status).toBe(400);
    expect((await reporter.post("/news", newsPayload({ coverImageUrl: "http://images.unsplash.com/photo-1" }))).status).toBe(400);
    expect((await reporter.post("/news", newsPayload({ coverImageUrl: "https://images.unsplash.com/photo-1477587458883-47145ed94245" }))).status).toBe(201);
  });

  it("rejects unknown fields (mass assignment) and unknown taxonomy", async () => {
    expect((await reporter.post("/news", newsPayload({ status: "PUBLISHED" }))).status).toBe(400);
    expect((await reporter.post("/news", newsPayload({ authorId: "someone" }))).status).toBe(400);
    expect((await reporter.post("/news", newsPayload({ tags: ["no-such-tag"] }))).status).toBe(400);
    expect((await reporter.post("/news", newsPayload({ categorySlug: "no-such-category" }))).status).toBe(400);
  });
});

describe("queue visibility", () => {
  it("reporters see only their own stories; district admins only their district", async () => {
    const mine = await client();
    void mine;
    const list = await reporter.get("/news/manage/list?limit=50");
    expect(list.status).toBe(200);
    for (const item of list.body.items) expect(item.author.name).toBe("Jaipur Reporter");

    const dist = await district.get("/news/manage/list?limit=50");
    for (const item of dist.body.items) expect(item.location?.path.startsWith("rajasthan/jaipur")).toBe(true);
  });
});
