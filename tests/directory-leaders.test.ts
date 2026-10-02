import { beforeAll, describe, expect, it } from "vitest";
import { API, createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, district: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  district = await loginAs("district@jangidsamaj.local");
});

const entry = (over: Record<string, unknown> = {}) => ({
  type: "ORGANIZATION",
  locationPath: "rajasthan/jaipur/jaipur",
  phone: "9812345678",
  translations: { en: { name: `Test Sabha ${rid()}`, description: "A test organisation" } },
  ...over,
});

const leader = (over: Record<string, unknown> = {}) => ({
  category: "SOCIAL_WORKER",
  locationPath: "rajasthan/jaipur/jaipur",
  phone: "9812345679",
  translations: { en: { name: `Test Leader ${rid()}`, designation: "Volunteer" } },
  ...over,
});

describe("directory", () => {
  it("member submissions wait for review, then go public and can be verified", async () => {
    const { client: member } = await createMember();
    const created = await member.post("/directory", entry());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/directory/${created.body.slug}`)).status).toBe(404);

    expect((await member.post(`/directory/${created.body.id}/approve`)).status).toBe(403);
    expect((await member.post(`/directory/${created.body.id}/verify`)).status).toBe(403);

    expect((await editor.post(`/directory/${created.body.id}/verify`)).status).toBe(409); // not published yet
    expect((await editor.post(`/directory/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");
    expect((await publicGet(`/directory/${created.body.slug}`)).status).toBe(200);

    expect((await editor.post(`/directory/${created.body.id}/verify`)).body.verification).toBe("VERIFIED");
    const verified = await publicGet("/directory?verified=true&limit=50");
    expect(verified.body.items.some((i: { slug: string }) => i.slug === created.body.slug)).toBe(true);
  });

  it("managers publish directly; scoped admins cannot manage other regions", async () => {
    const own = await district.post("/directory", entry());
    expect(own.body.status).toBe("PUBLISHED");
    expect((await district.post("/directory", entry({ locationPath: "haryana/rohtak/rohtak" }))).status).toBe(403);

    const haryana = await editor.post("/directory", entry({ locationPath: "haryana/rohtak/rohtak" }));
    expect((await district.post(`/directory/${haryana.body.id}/archive`)).status).toBe(403);
  });

  it("hides personal contact details unless opted in", async () => {
    const person = await editor.post("/directory", entry({ type: "CONTACT" }));
    const hidden = (await publicGet(`/directory/${person.body.slug}`)).body;
    expect(hidden.phone).toBeUndefined();
    expect(hidden.contactHidden).toBe(true);

    const org = await editor.post("/directory", entry());
    const shown = (await publicGet(`/directory/${org.body.slug}`)).body;
    expect(shown.phone).toBe("9812345678");
  });

  it("validates input", async () => {
    const { client: member } = await createMember();
    expect((await member.post("/directory", entry({ phone: "12345" }))).status).toBe(400);
    expect((await member.post("/directory", entry({ locationPath: "nowhere/x" }))).status).toBe(400);
    expect((await member.post("/directory", entry({ website: "http://insecure.example" }))).status).toBe(400);
    expect((await member.post("/directory", entry({ latitude: 26.9 }))).status).toBe(400); // lat without lng
    expect((await member.post("/directory", entry({ status: "PUBLISHED" }))).status).toBe(400); // mass assignment
    expect((await member.post("/directory", entry({ sortOrder: 1 }))).status).toBe(201); // ignored for non-managers
  });

  it("filters by type and location, and supports name search", async () => {
    const res = await publicGet("/directory?type=SAMAJ_BHAWAN&location=rajasthan");
    expect(res.status).toBe(200);
    for (const i of res.body.items) expect(i.type).toBe("SAMAJ_BHAWAN");
    const q = await publicGet("/directory?q=mahasabha");
    expect(q.body.items.length).toBeGreaterThan(0);
  });
});

describe("leaders", () => {
  it("submission → approval → verification, with private contact by default", async () => {
    const { client: member } = await createMember();
    const created = await member.post("/leaders", leader());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/leaders/${created.body.slug}`)).status).toBe(404);

    await editor.post(`/leaders/${created.body.id}/approve`);
    await editor.post(`/leaders/${created.body.id}/verify`);
    const pub = (await publicGet(`/leaders/${created.body.slug}`)).body;
    expect(pub.verification).toBe("VERIFIED");
    expect(pub.phone).toBeUndefined();
    expect(pub.contactHidden).toBe(true);
  });

  it("reveals contact only when the profile opts in", async () => {
    const made = await editor.post("/leaders", leader({ isContactPublic: true }));
    const pub = (await publicGet(`/leaders/${made.body.slug}`)).body;
    expect(pub.phone).toBe("9812345679");
  });

  it("validates terms, organisations and permissions", async () => {
    const { client: member } = await createMember();
    expect((await member.post("/leaders", leader({ termStart: "2025-01-01", termEnd: "2024-01-01" }))).status).toBe(400);
    expect((await member.post("/leaders", leader({ organizationSlug: "no-such-org" }))).status).toBe(400);
    const ok = await editor.post("/leaders", leader({ organizationSlug: "rajasthan-jangid-sabha" }));
    expect(ok.status).toBe(201);

    const org = await publicGet("/directory/rajasthan-jangid-sabha");
    expect(org.body.leaders.some((l: { slug: string }) => l.slug === ok.body.slug)).toBe(true);
  });

  it("current-term flag and category filter work", async () => {
    const res = await publicGet("/leaders?category=SARPANCH");
    expect(res.status).toBe(200);
    for (const l of res.body.items) expect(l.category).toBe("SARPANCH");
    const expired = res.body.items.find((l: { slug: string }) => l.slug === "sunita-jangid");
    expect(expired.isCurrent).toBe(false); // term ended 2026-01-25
  });

  it("uses the versioned API prefix", async () => {
    expect(API).toBe("/api/v1");
    expect((await publicGet("/leaders?limit=1")).status).toBe(200);
  });
});
