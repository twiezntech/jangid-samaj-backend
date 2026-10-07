import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, district: Client, sales: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  district = await loginAs("district@jangidsamaj.local");
  sales = await loginAs("sales@jangidsamaj.local");
});

const unique = () => `Zz${rid()}`;
const kashyap = () => prisma.rishi.findUniqueOrThrow({ where: { slug: "kashyap" } });

describe("gotra: public directory", () => {
  it("serves the seeded master data with paging", async () => {
    const res = await publicGet("/gotra?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(2000);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.items[0]).toHaveProperty("nameEn");
    expect(res.body.items[0]).not.toHaveProperty("nameKey");
  });

  it("filters by letter, rishi, missing rishi and search", async () => {
    const letter = await publicGet("/gotra?letter=a&limit=50");
    expect(letter.body.items.length).toBeGreaterThan(0);
    expect(letter.body.items.every((g: { nameEn: string }) => g.nameEn.toUpperCase().startsWith("A"))).toBe(true);

    const rishi = await publicGet("/gotra?rishi=kashyap&limit=50");
    expect(rishi.body.items.every((g: { rishi: { slug: string } }) => g.rishi.slug === "kashyap")).toBe(true);

    const none = await publicGet("/gotra?rishi=none&limit=50");
    expect(none.body.items.every((g: { rishi: unknown }) => g.rishi === null)).toBe(true);

    const q = await publicGet("/gotra?q=ambaya");
    expect(q.body.items.map((g: { nameEn: string }) => g.nameEn)).toContain("Ambaya");
  });

  it("lists rishis with counts and rejects bad filters", async () => {
    const res = await publicGet("/gotra/rishis");
    expect(res.body.items.length).toBeGreaterThanOrEqual(18);
    expect(res.body.items.find((r: { slug: string }) => r.slug === "kashyap").count).toBeGreaterThan(50);
    expect(res.body.total).toBeGreaterThan(2000);
    expect((await publicGet("/gotra?letter=ab")).status).toBe(400);
    expect((await publicGet("/gotra?rishi=Bad%20Slug")).status).toBe(400);
    expect((await publicGet("/gotra?limit=500")).status).toBe(400);
  });
});

describe("gotra: access control", () => {
  it("only staff with gotra.manage can read the manage views or write", async () => {
    const { client: member } = await createMember();
    expect((await publicGet("/gotra/manage/list")).status).toBe(401);
    for (const c of [member, district, sales]) {
      expect((await c.get("/gotra/manage/list")).status).toBe(403);
      expect((await c.post("/gotra", { nameEn: unique() })).status).toBe(403);
    }
    expect((await editor.get("/gotra/manage/list")).status).toBe(200);
  });
});

describe("gotra: manage", () => {
  it("adds a gotra, and refuses duplicates however they are typed", async () => {
    const name = unique();
    const k = await kashyap();
    const created = await editor.post("/gotra", { nameEn: name, nameHi: "परीक्षण", rishiId: k.id });
    expect(created.status).toBe(201);
    expect(created.body.rishi.slug).toBe("kashyap");

    for (const variant of [name, name.toUpperCase(), name.toLowerCase(), `  ${name.slice(0, 2)}-${name.slice(2)} `]) {
      const dup = await editor.post("/gotra", { nameEn: variant });
      expect(dup.status).toBe(409);
      expect(dup.body.code ?? dup.body.error?.code).toBe("DUPLICATE_GOTRA");
    }
    expect((await prisma.gotra.count({ where: { nameKey: name.toLowerCase() } })).valueOf()).toBe(1);
  });

  it("validates input and strips markup", async () => {
    expect((await editor.post("/gotra", { nameEn: "x" })).status).toBe(400);
    expect((await editor.post("/gotra", { nameEn: "---" })).status).toBe(400);
    expect((await editor.post("/gotra", { nameEn: unique(), rishiId: "doesnotexist12345" })).status).toBe(400);
    expect((await editor.post("/gotra", { nameEn: unique(), nameKey: "forced" })).status).toBe(400);

    const raw = unique();
    const created = await editor.post("/gotra", { nameEn: `<b>${raw}</b><script>alert(1)</script>` });
    expect(created.body.nameEn).toBe(raw);
  });

  it("renames safely, and hidden gotras vanish from the public directory", async () => {
    const a = await editor.post("/gotra", { nameEn: unique() });
    const b = await editor.post("/gotra", { nameEn: unique() });

    expect((await editor.patch(`/gotra/${a.body.id}`, { nameEn: b.body.nameEn.toUpperCase() })).status).toBe(409);
    expect((await editor.patch(`/gotra/${a.body.id}`, { nameEn: a.body.nameEn.toUpperCase() })).status).toBe(200); // own spelling change
    expect((await editor.patch(`/gotra/${a.body.id}`, {})).status).toBe(400);
    expect((await editor.patch("/gotra/doesnotexist12345", { nameEn: "Whatever" })).status).toBe(404);

    expect((await publicGet(`/gotra?q=${a.body.nameEn.toLowerCase()}`)).body.items).toHaveLength(1);
    await editor.patch(`/gotra/${a.body.id}`, { isActive: false });
    expect((await publicGet(`/gotra?q=${a.body.nameEn.toLowerCase()}`)).body.items).toHaveLength(0);
    const staff = await editor.get(`/gotra/manage/list?q=${a.body.nameEn.toLowerCase()}`);
    expect(staff.body.items[0].isActive).toBe(false);
    expect((await editor.get(`/gotra/manage/list?q=${a.body.nameEn.toLowerCase()}&active=true`)).body.items).toHaveLength(0);
    expect((await editor.get("/gotra/manage/rishis")).body.summary.hidden).toBeGreaterThanOrEqual(1);
  });

  it("assigns a rishi to many gotras at once", async () => {
    const k = await kashyap();
    const made = await Promise.all([editor.post("/gotra", { nameEn: unique() }), editor.post("/gotra", { nameEn: unique() })]);
    const ids = made.map((m) => m.body.id);

    expect((await editor.patch("/gotra/bulk", { ids })).status).toBe(400);
    expect((await editor.patch("/gotra/bulk", { ids, rishiId: "doesnotexist12345" })).status).toBe(400);
    expect((await editor.patch("/gotra/bulk", { ids: [], rishiId: k.id })).status).toBe(400);
    expect((await editor.patch("/gotra/bulk", { ids: Array.from({ length: 201 }, (_, i) => `id-number-${i}-padding`), rishiId: k.id })).status).toBe(400);

    const res = await editor.patch("/gotra/bulk", { ids, rishiId: k.id });
    expect(res.body.updated).toBe(2);
    expect(await prisma.gotra.count({ where: { id: { in: ids }, rishiId: k.id } })).toBe(2);
    expect((await editor.patch("/gotra/bulk", { ids, rishiId: null })).body.updated).toBe(2);
  });

  it("deletes a gotra and keeps an audit trail", async () => {
    const g = await editor.post("/gotra", { nameEn: unique() });
    expect((await editor.delete(`/gotra/${g.body.id}`)).body.deleted).toBe(true);
    expect((await editor.delete(`/gotra/${g.body.id}`)).status).toBe(404);
    expect((await district.delete(`/gotra/${g.body.id}`)).status).toBe(403);
    const log = await prisma.auditLog.findFirst({ where: { action: "gotra.delete", entityId: g.body.id } });
    expect(log?.meta).toMatchObject({ nameEn: g.body.nameEn });
  });
});

describe("gotra: rishis", () => {
  it("adds, edits and deletes a rishi; one that still has gotras cannot be deleted", async () => {
    const name = unique();
    const r = await editor.post("/gotra/rishis", { nameEn: name, nameHi: "ऋषि" });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe(name.toLowerCase());
    expect((await editor.post("/gotra/rishis", { nameEn: "Other", slug: r.body.slug })).status).toBe(409);

    expect((await editor.patch(`/gotra/rishis/${r.body.id}`, { nameHi: "नया नाम", sortOrder: 99 })).body.nameHi).toBe("नया नाम");
    expect((await editor.patch(`/gotra/rishis/${r.body.id}`, { slug: "changed" })).status).toBe(400); // slug is fixed

    const g = await editor.post("/gotra", { nameEn: unique(), rishiId: r.body.id });
    const blocked = await editor.delete(`/gotra/rishis/${r.body.id}`);
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("1 gotras");

    await editor.delete(`/gotra/${g.body.id}`);
    expect((await editor.delete(`/gotra/rishis/${r.body.id}`)).body.deleted).toBe(true);
    expect((await editor.get("/gotra/manage/rishis")).body.items.some((x: { id: string }) => x.id === r.body.id)).toBe(false);
  });

  it("a hidden rishi disappears from the public list", async () => {
    const r = await editor.post("/gotra/rishis", { nameEn: unique() });
    expect((await publicGet("/gotra/rishis")).body.items.some((x: { slug: string }) => x.slug === r.body.slug)).toBe(true);
    await editor.patch(`/gotra/rishis/${r.body.id}`, { isActive: false });
    expect((await publicGet("/gotra/rishis")).body.items.some((x: { slug: string }) => x.slug === r.body.slug)).toBe(false);
  });
});
