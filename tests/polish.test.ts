import { beforeAll, describe, expect, it } from "vitest";
import { createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, admin: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  admin = await loginAs("admin@jangidsamaj.local");
});

const dob = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 28, 0, 1);
  return d.toISOString().slice(0, 10);
};

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Polish Test",
  gender: "MALE",
  dateOfBirth: dob(),
  locationPath: "rajasthan/jaipur/jaipur",
  contactPhone: "9829055555",
  ...over,
});

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("gallery categories", () => {
  it("separates success stories, interviews and reels from event albums", async () => {
    const make = (category?: string) =>
      editor.post("/gallery", {
        locationPath: "rajasthan/jaipur/jaipur",
        ...(category ? { category } : {}),
        items: [{ kind: "VIDEO", url: "https://youtu.be/dQw4w9WgXcQ" }],
        translations: { en: { title: `Story ${rid()}` } },
      });
    const story = await make("SUCCESS_STORY");
    const plain = await make();
    expect(story.status).toBe(201);
    expect((await editor.get(`/gallery/manage/${plain.body.id}`)).body.category).toBe("EVENT"); // default
    expect((await editor.get(`/gallery/manage/${story.body.id}`)).body.category).toBe("SUCCESS_STORY");

    const list = await publicGet("/gallery?category=SUCCESS_STORY&limit=50");
    expect(list.status).toBe(200);
    const slugs = list.body.items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain(story.body.slug);
    expect(slugs).not.toContain(plain.body.slug);
    expect(list.body.items.every((i: { category: string }) => i.category === "SUCCESS_STORY")).toBe(true);

    expect((await editor.post("/gallery", { locationPath: "rajasthan/jaipur/jaipur", category: "MEME", translations: { en: { title: "Bad one" } } })).status).toBe(400);
  });
});

describe("matrimony biodata", () => {
  it("accepts only real PDFs and shares the biodata on the same terms as the phone number", async () => {
    const { client: a } = await createMember();
    expect((await a.upload("/uploads/document", Buffer.from("not a pdf"), "x.pdf")).status).toBe(400);
    const up = await a.upload("/uploads/document", pdf, "biodata.pdf");
    expect(up.status).toBe(201);
    expect(up.body.url).toMatch(/\.pdf$/);

    expect((await a.post("/matrimony/me", profile({ biodataUrl: "https://evil.example/a.pdf" }))).status).toBe(400);
    const created = await a.post("/matrimony/me", profile({ biodataUrl: up.body.url }));
    expect(created.status).toBe(201);
    await admin.post(`/matrimony/manage/${created.body.id}/approve`);

    const { client: b } = await createMember();
    const bp = await b.post("/matrimony/me", profile({ gender: "FEMALE", contactPhone: "9829055556" }));
    await admin.post(`/matrimony/manage/${bp.body.id}/approve`);

    const before = await b.get(`/matrimony/profiles/${created.body.code}`);
    expect(before.body.hasBiodata).toBe(true);
    expect(before.body.biodata).toBeNull();
    expect(JSON.stringify(before.body)).not.toContain(up.body.url);

    expect((await b.post(`/matrimony/profiles/${created.body.code}/interest`, {})).status).toBe(201);
    const interest = (await a.get("/matrimony/interests?box=received")).body.items[0];
    expect((await a.post(`/matrimony/interests/${interest.id}/respond`, { accept: true })).status).toBe(200);
    expect((await b.get(`/matrimony/profiles/${created.body.code}`)).body.biodata).toBe(up.body.url);
  });
});

describe("announcement segments", () => {
  it("can target only members with a live rishta profile", async () => {
    const { client: withProfile } = await createMember();
    const created = await withProfile.post("/matrimony/me", profile({ contactPhone: "9829055557" }));
    await admin.post(`/matrimony/manage/${created.body.id}/approve`);
    const { client: plain } = await createMember();

    const all = await editor.get("/announcements/audience");
    const seg = await editor.get("/announcements/audience?segment=MATRIMONY_MEMBERS");
    expect(seg.body.recipients).toBeGreaterThan(0);
    expect(seg.body.recipients).toBeLessThan(all.body.recipients);

    const sent = await editor.post("/announcements", { titleHi: "रिश्ता सूचना", titleEn: "Rishta notice", segment: "MATRIMONY_MEMBERS" });
    expect(sent.status).toBe(201);
    expect((await withProfile.get("/account/notifications")).body.items.some((n: { titleEn: string }) => n.titleEn === "Rishta notice")).toBe(true);
    expect((await plain.get("/account/notifications")).body.items.some((n: { titleEn: string }) => n.titleEn === "Rishta notice")).toBe(false);
    expect((await editor.post("/announcements", { titleHi: "x y z", titleEn: "x y z", segment: "STAFF" })).status).toBe(400);
  });
});

describe("retention analytics", () => {
  it("counts signed-in members who came back, never anonymous visitors", async () => {
    const before = (await admin.get("/analytics/overview?days=30")).body.retention;
    expect(before.cohorts).toHaveLength(6);

    const { client: m } = await createMember();
    await m.post("/analytics/view", { path: "/news" });
    await publicGet("/analytics/view").catch(() => undefined);
    let after = before;
    for (let i = 0; i < 20 && after.activeToday === before.activeToday; i++) {
      await wait(150);
      after = (await admin.get("/analytics/overview?days=30")).body.retention;
    }
    expect(after.activeToday).toBe(before.activeToday + 1);
    expect(after.active7d).toBeGreaterThanOrEqual(after.activeToday);
    expect(after.active30d).toBeGreaterThanOrEqual(after.active7d);
    const thisWeek = after.cohorts[after.cohorts.length - 1];
    expect(thisWeek.size).toBeGreaterThan(0);
    expect(thisWeek.w1).toBeNull(); // next week has not happened yet
  });
});

describe("auth session", () => {
  it("answers 200 for visitors and signed-in members, never 401", async () => {
    const anon = await publicGet("/auth/session");
    expect(anon.status).toBe(200);
    expect(anon.body).toEqual({ user: null, refreshable: false });

    const { client: m, user } = await createMember();
    const me = await m.get("/auth/session");
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.refreshable).toBe(false);
  });
});
