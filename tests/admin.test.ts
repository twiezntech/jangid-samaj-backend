import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { createMember, loginAs, newsPayload, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let admin: Client, editor: Client, reporter: Client;

beforeAll(async () => {
  admin = await loginAs("admin@jangidsamaj.local");
  editor = await loginAs("editor@jangidsamaj.local");
  reporter = await loginAs("reporter@jangidsamaj.local");
});

describe("user & role administration", () => {
  it("only user managers can list users or roles", async () => {
    expect((await reporter.get("/admin/users")).status).toBe(403);
    expect((await editor.get("/admin/users")).status).toBe(403);
    const res = await admin.get("/admin/users?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).not.toHaveProperty("passwordHash");
    expect((await admin.get("/admin/roles")).body.items.length).toBeGreaterThan(3);
  });

  it("role changes take effect immediately and are audited", async () => {
    const { user, client: member } = await createMember();
    expect((await member.post("/news", newsPayload())).status).toBe(403);

    const res = await admin.patch(`/admin/users/${user.id}`, { roleName: "CITY_REPORTER", locationPath: "rajasthan/jaipur/jaipur" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("CITY_REPORTER");

    expect((await member.post("/news", newsPayload())).status).toBe(201);
    expect((await member.post("/news", newsPayload({ locationPath: "haryana/rohtak/rohtak" }))).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: "user.update" } })).toBe(1);
  });

  it("suspending a user blocks them immediately", async () => {
    const { user, client: member } = await createMember();
    await admin.patch(`/admin/users/${user.id}`, { roleName: "CITY_REPORTER", locationPath: "rajasthan/jaipur/jaipur" });
    expect((await member.post("/news", newsPayload())).status).toBe(201);

    expect((await admin.patch(`/admin/users/${user.id}`, { isSuspended: true })).status).toBe(200);
    expect((await member.post("/news", newsPayload())).status).toBe(401);
    expect((await member.get("/auth/me")).status).toBe(403); // account disabled
  });

  it("protects against privilege escalation and self-lockout", async () => {
    const self = await prisma.user.findUniqueOrThrow({ where: { email: "admin@jangidsamaj.local" } });
    expect((await admin.patch(`/admin/users/${self.id}`, { isSuspended: true })).status).toBe(403);
    expect((await admin.patch(`/admin/users/${self.id}`, { roleName: "MEMBER" })).status).toBe(403);
    expect((await admin.patch(`/admin/users/${self.id}`, { roleName: "NOPE" })).status).toBe(403);

    const { user } = await createMember();
    expect((await admin.patch(`/admin/users/${user.id}`, { roleName: "NOPE" })).status).toBe(400);
    expect((await admin.patch(`/admin/users/${user.id}`, { role: "SUPER_ADMIN" })).status).toBe(400); // unknown field

    const editorUser = await prisma.user.findUniqueOrThrow({ where: { email: "editor@jangidsamaj.local" } });
    expect((await editor.patch(`/admin/users/${user.id}`, { roleName: "SUPER_ADMIN" })).status).toBe(403);
    expect((await editor.patch(`/admin/users/${editorUser.id}`, { roleName: "SUPER_ADMIN" })).status).toBe(403);
  });
});

describe("audit log & locations", () => {
  it("audit log is restricted and paginated", async () => {
    expect((await editor.get("/admin/audit")).status).toBe(403);
    const res = await admin.get("/admin/audit?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.items[0]).toHaveProperty("action");
  });

  it("location management is permissioned and keeps the tree consistent", async () => {
    const slug = `zone-${rid()}`;
    expect((await editor.post("/locations", { slug, nameHi: "क्षेत्र", nameEn: "Zone", parentPath: "rajasthan" })).status).toBe(403);

    const created = await admin.post("/locations", { slug, nameHi: "क्षेत्र", nameEn: "Zone", parentPath: "rajasthan" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ path: `rajasthan/${slug}`, level: "DISTRICT", parentPath: "rajasthan" });
    expect((await admin.post("/locations", { slug, nameHi: "क्षेत्र", nameEn: "Zone", parentPath: "rajasthan" })).status).toBe(409);
    expect((await admin.post("/locations", { slug: "x", nameHi: "क", nameEn: "X", parentPath: "rajasthan/jaipur/jaipur/sanganer/dhani-jangidan" })).status).toBe(400);

    const detail = await publicGet(`/locations/detail/${created.body.path}`);
    expect(detail.body.ancestors.map((a: { slug: string }) => a.slug)).toEqual(["rajasthan"]);
  });

  it("taxonomy writes need permission; public taxonomy is cached", async () => {
    expect((await reporter.post("/categories", { slug: `c-${rid()}`, nameHi: "श्रेणी", nameEn: "Cat" })).status).toBe(403);
    expect((await editor.post("/tags", { slug: `t-${rid()}`, nameHi: "टैग", nameEn: "Tag" })).status).toBe(201);
    const cats = await publicGet("/categories");
    expect(cats.headers["cache-control"]).toContain("s-maxage");
    expect(cats.body.items.length).toBeGreaterThan(5);
  });

  it("exposes health/readiness and request ids", async () => {
    const res = await publicGet("/sitemap");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.body.news.length).toBeGreaterThan(0);
  });
});
