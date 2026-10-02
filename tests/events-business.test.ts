import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, reporter: Client, support: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  reporter = await loginAs("reporter@jangidsamaj.local");
  support = await loginAs("support@jangidsamaj.local");
});

const inDays = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

const eventPayload = (over: Record<string, unknown> = {}) => ({
  category: "MEETING",
  startsAt: inDays(7),
  endsAt: inDays(7.2),
  locationPath: "rajasthan/jaipur/jaipur",
  organizerName: "Test Samiti",
  organizerPhone: "9812345670",
  isContactPublic: false,
  registrationEnabled: true,
  capacity: 3,
  translations: { en: { title: `Test Meet ${rid()}`, description: "<p>Agenda<script>alert(1)</script></p>", venue: "Samaj Bhawan" } },
  ...over,
});

async function publishedEvent(over: Record<string, unknown> = {}) {
  const created = await editor.post("/events", eventPayload(over));
  expect(created.status).toBe(201);
  expect((await editor.post(`/events/${created.body.id}/publish`)).body.status).toBe("PUBLISHED");
  return created.body as { id: string; slug: string };
}

describe("events", () => {
  it("drafts stay private; published events are public with sanitised content and hidden private contacts", async () => {
    const created = await editor.post("/events", eventPayload());
    expect(created.body.status).toBe("DRAFT");
    expect((await publicGet(`/events/${created.body.slug}`)).status).toBe(404);

    await editor.post(`/events/${created.body.id}/publish`);
    const detail = await publicGet(`/events/${created.body.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.translations.en.description).not.toContain("<script");
    expect(detail.body.organizerPhone).toBeUndefined();
    expect(detail.body.contactHidden).toBe(true);
    expect(detail.body.registration).toMatchObject({ open: true, seatsLeft: 3 });

    const list = await publicGet("/events?when=upcoming&limit=50");
    expect(list.body.items.some((e: { slug: string }) => e.slug === created.body.slug)).toBe(true);
    const past = await publicGet("/events?when=past&limit=50");
    expect(past.body.items.some((e: { slug: string }) => e.slug === created.body.slug)).toBe(false);
  });

  it("rejects impossible dates, including on a partial update", async () => {
    expect((await editor.post("/events", eventPayload({ endsAt: inDays(6) }))).status).toBe(400);
    const e = await publishedEvent();
    expect((await editor.patch(`/events/${e.id}`, { startsAt: inDays(9) })).status).toBe(400); // would end before it starts
  });

  it("registration: one per member, capacity is never oversold, cancel frees seats", async () => {
    const e = await publishedEvent({ capacity: 3 });
    const a = await createMember();
    const b = await createMember();

    const reg = await a.client.post(`/events/${e.id}/register`, { name: "Ramesh", phone: "9812345671", attendees: 2 });
    expect(reg.status).toBe(201);
    expect((await a.client.post(`/events/${e.id}/register`, { name: "Ramesh", phone: "9812345671" })).body.error.code).toBe("ALREADY_REGISTERED");

    const full = await b.client.post(`/events/${e.id}/register`, { name: "Suresh", phone: "9812345672", attendees: 2 });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("EVENT_FULL");

    expect((await a.client.post(`/events/${e.id}/register/cancel`)).body.status).toBe("CANCELLED");
    expect((await b.client.post(`/events/${e.id}/register`, { name: "Suresh", phone: "9812345672", attendees: 2 })).status).toBe(201);

    const mine = await b.client.get("/events/me/registrations");
    expect(mine.body.items[0].event.slug).toBe(e.slug);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: e.id } });
    expect(event.seatsTaken).toBe(2);
  });

  it("concurrent registrations cannot exceed capacity", async () => {
    const e = await publishedEvent({ capacity: 2 });
    const members = await Promise.all([createMember(), createMember(), createMember(), createMember()]);
    const results = await Promise.all(members.map((m, i) => m.client.post(`/events/${e.id}/register`, { name: `M${i}`, phone: `981234568${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).seatsTaken).toBe(2);
  });

  it("closed registration and anonymous users are refused", async () => {
    const e = await publishedEvent({ registrationEnabled: false });
    const { client } = await createMember();
    expect((await client.post(`/events/${e.id}/register`, { name: "X Y", phone: "9812345673" })).body.error.code).toBe("REGISTRATION_CLOSED");
    expect((await request(app).post(`/api/v1/events/${e.id}/register`).set("Origin", "http://localhost:3010").send({ name: "X Y", phone: "9812345673" })).status).toBe(401);
  });

  it("only event managers manage events; CSV export defuses formulas", async () => {
    expect((await reporter.post("/events", eventPayload())).status).toBe(403);
    const { client: member } = await createMember();
    expect((await member.get("/events/manage/list")).status).toBe(403);

    const e = await publishedEvent({ capacity: 10 });
    await member.post(`/events/${e.id}/register`, { name: "=HYPERLINK(1)", phone: "9812345674" });
    const csv = await editor.get(`/events/manage/${e.id}/registrations?format=csv`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain(`"'=HYPERLINK(1)"`);
    expect(csv.text).not.toMatch(/(^|,)"=HYPERLINK/m);
  });
});

const businessPayload = (over: Record<string, unknown> = {}) => ({
  categorySlug: "furniture",
  locationPath: "rajasthan/jaipur/jaipur",
  phone: "9812345675",
  translations: { en: { name: `Test Furniture ${rid()}`, tagline: "Handmade", description: "Quality work" } },
  ...over,
});

describe("business directory", () => {
  it("member listings wait for review; managers approve, verify and feature", async () => {
    const { client: owner } = await createMember();
    expect((await owner.post("/business", businessPayload({ isFeatured: true }))).status).toBe(403);

    const created = await owner.post("/business", businessPayload());
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/business/${created.body.slug}`)).status).toBe(404);
    expect((await owner.post(`/business/${created.body.id}/approve`)).status).toBe(403);

    expect((await owner.patch(`/business/${created.body.id}`, { translations: { en: { name: "Renamed Furniture" } } })).status).toBe(200);

    expect((await editor.post(`/business/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");
    expect((await editor.post(`/business/${created.body.id}/verify`)).body.verification).toBe("VERIFIED");
    expect((await editor.patch(`/business/${created.body.id}`, { isFeatured: true })).status).toBe(200);

    // owners cannot silently change a published listing
    expect((await owner.patch(`/business/${created.body.id}`, { phone: "9812345676" })).status).toBe(403);

    const list = await publicGet("/business?category=furniture&limit=50");
    expect(list.body.items[0].isFeatured).toBe(true);
    const mine = await owner.get("/business/me/listings");
    expect(mine.body.items[0].translations.en.name).toBe("Renamed Furniture");
  });

  it("requires a way to contact the business", async () => {
    const { client } = await createMember();
    expect((await client.post("/business", businessPayload({ phone: undefined }))).status).toBe(400);
  });

  it("enquiries reach the owner and managers only; duplicates are collapsed", async () => {
    const { client: owner } = await createMember();
    const created = await owner.post("/business", businessPayload());
    await editor.post(`/business/${created.body.id}/approve`);

    const send = () => request(app).post(`/api/v1/business/${created.body.id}/enquiry`).set("Origin", "http://localhost:3010").send({ name: "Buyer", phone: "9812345677", message: "Need a dining table" });
    expect((await send()).body).toMatchObject({ ok: true, duplicate: false });
    expect((await send()).body).toMatchObject({ ok: true, duplicate: true });

    const ownerInbox = await owner.get("/business/me/enquiries");
    expect(ownerInbox.body.items).toHaveLength(1);
    const enquiryId = ownerInbox.body.items[0].id;

    const { client: stranger } = await createMember();
    expect((await stranger.get("/business/me/enquiries")).body.items).toHaveLength(0);
    expect((await stranger.patch(`/business/enquiries/${enquiryId}`, { status: "CLOSED" })).status).toBe(404);
    expect((await owner.patch(`/business/enquiries/${enquiryId}`, { status: "IN_PROGRESS" })).body.status).toBe("IN_PROGRESS");
    expect((await editor.get("/business/manage/enquiries?status=IN_PROGRESS")).body.items.some((e: { id: string }) => e.id === enquiryId)).toBe(true);
  });

  it("honeypot submissions are silently dropped", async () => {
    const b = await prisma.business.findFirstOrThrow({ where: { status: "PUBLISHED" } });
    const before = await prisma.businessEnquiry.count();
    await request(app).post(`/api/v1/business/${b.id}/enquiry`).set("Origin", "http://localhost:3010").send({ name: "Bot", phone: "9812345678", message: "spam spam", website: "http://spam" });
    expect(await prisma.businessEnquiry.count()).toBe(before);
  });
});

describe("uploads, dashboard and inbox", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360f8cf00000301010018dd8db40000000049454e44ae426082", "hex");

  it("accepts real images only and serves them safely", async () => {
    const { client } = await createMember();
    const bad = await client.upload("/uploads/image", Buffer.from("<svg onload=alert(1)>"), "x.png");
    expect(bad.status).toBe(400);

    const ok = await client.upload("/uploads/image", png, "pixel.png");
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{24}\.png$/);

    const served = await request(app).get(new URL(ok.body.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("sandbox");

    // the uploaded URL is accepted as an image field
    const biz = await client.post("/business", businessPayload({ coverImageUrl: ok.body.url }));
    expect(biz.status).toBe(201);
  });

  it("anonymous uploads are refused", async () => {
    expect((await request(app).post("/api/v1/uploads/image").set("Origin", "http://localhost:3010").attach("file", png, "p.png")).status).toBe(401);
  });

  it("dashboard stats need dashboard access; users block only for user managers", async () => {
    const { client: member } = await createMember();
    expect((await member.get("/admin/stats")).status).toBe(403);
    const stats = await editor.get("/admin/stats");
    expect(stats.status).toBe(200);
    expect(stats.body.content.events.upcoming).toBeGreaterThan(0);
    expect(stats.body.users).toBeNull();
    const admin = await loginAs("admin@jangidsamaj.local");
    expect((await admin.get("/admin/stats")).body.users.total).toBeGreaterThan(0);
  });

  it("support reads the feedback inbox; members cannot", async () => {
    const { client: member } = await createMember();
    await member.post("/feedback", { category: "bug", message: "<b>Page</b> does not load on my phone" });
    expect((await member.get("/feedback")).status).toBe(403);
    const inbox = await support.get("/feedback?status=NEW");
    const msg = inbox.body.items.find((m: { message: string }) => m.message.includes("does not load"));
    expect(msg.message).not.toContain("<b>");
    expect((await support.patch(`/feedback/${msg.id}`, { status: "CLOSED", adminNote: "Fixed" })).body.status).toBe("CLOSED");
  });
});
