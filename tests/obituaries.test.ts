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

const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600_000).toISOString();

const notice = (over: Record<string, unknown> = {}) => ({
  gender: "MALE",
  locationPath: "rajasthan/jaipur/jaipur",
  dateOfDeath: "2026-09-01",
  dateOfBirth: "1950-01-15",
  contactName: "Suresh",
  contactRelation: "Son",
  contactPhone: "9829011111",
  ceremonies: [{ type: "UTHAVNA", startsAt: inDays(3), venue: "Samaj Bhawan", address: "Mansarovar, Jaipur" }],
  translations: {
    hi: { name: `परीक्षण नाम ${rid()}`, familyMessage: "शोकाकुल परिवार" },
    en: { name: `Test Person ${rid()}`, relationLine: "S/o Late Shri Ram", biography: "A kind soul." },
  },
  ...over,
});

const publish = async (over: Record<string, unknown> = {}) => (await editor.post("/obituaries", notice(over))).body as { id: string; slug: string; status: string };

describe("obituaries", () => {
  it("family submissions wait for review, then go public", async () => {
    const { client: member } = await createMember();
    const created = await member.post("/obituaries", notice());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect((await publicGet(`/obituaries/${created.body.slug}`)).status).toBe(404);
    expect((await member.post(`/obituaries/${created.body.id}/approve`)).status).toBe(403);

    expect((await editor.post(`/obituaries/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");
    const pub = await publicGet(`/obituaries/${created.body.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.translations.en.name).toMatch(/^Test Person/);
    expect(pub.body.ceremonies).toHaveLength(1);
    expect(pub.body.ceremonies[0].type).toBe("UTHAVNA");
    expect(pub.body.createdById).toBeUndefined();
  });

  it("keeps the family phone private unless they opt in", async () => {
    const hidden = await publish();
    const pub = (await publicGet(`/obituaries/${hidden.slug}`)).body;
    expect(pub.contact).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("9829011111");

    const shown = await publish({ isContactPublic: true });
    expect((await publicGet(`/obituaries/${shown.slug}`)).body.contact).toMatchObject({ name: "Suresh", relation: "Son", phone: "9829011111" });

    const list = await publicGet("/obituaries?limit=50");
    expect(JSON.stringify(list.body)).not.toContain("9829011111");
  });

  it("rejection needs a reason; the family can fix and resubmit, but not edit once published", async () => {
    const { client: member } = await createMember();
    const o = await member.post("/obituaries", notice());

    expect((await editor.post(`/obituaries/${o.body.id}/reject`, {})).status).toBe(400);
    expect((await editor.post(`/obituaries/${o.body.id}/reject`, { reason: "Please add the uthavna time" })).body.status).toBe("REJECTED");
    expect((await member.get(`/obituaries/manage/${o.body.id}`)).body.rejectionReason).toBe("Please add the uthavna time");

    const fixed = await member.patch(`/obituaries/${o.body.id}`, { ceremonies: [{ type: "SHOK_SABHA", startsAt: inDays(5), venue: "Temple hall" }] });
    expect(fixed.status).toBe(200);
    expect((await member.post(`/obituaries/${o.body.id}/submit`)).body.status).toBe("PENDING_REVIEW");
    const record = (await member.get(`/obituaries/manage/${o.body.id}`)).body;
    expect(record.ceremonies.map((c: { type: string }) => c.type)).toEqual(["SHOK_SABHA"]);

    await editor.post(`/obituaries/${o.body.id}/approve`);
    expect((await member.patch(`/obituaries/${o.body.id}`, { ageYears: 70 })).status).toBe(403);
  });

  it("other members cannot read or touch someone else's notice", async () => {
    const { client: owner } = await createMember();
    const { client: other } = await createMember();
    const o = await owner.post("/obituaries", notice());
    expect((await other.get(`/obituaries/manage/${o.body.id}`)).status).toBe(404);
    expect((await other.patch(`/obituaries/${o.body.id}`, { ageYears: 70 })).status).toBe(403);
    expect((await other.post(`/obituaries/${o.body.id}/submit`)).status).toBe(403);
  });

  it("managers publish directly; scoped admins stay inside their area", async () => {
    expect((await district.post("/obituaries", notice())).body.status).toBe("PUBLISHED");
    expect((await district.post("/obituaries", notice({ locationPath: "haryana/rohtak/rohtak" }))).status).toBe(403);
    const haryana = await publish({ locationPath: "haryana/rohtak/rohtak" });
    expect((await district.post(`/obituaries/${haryana.id}/archive`)).status).toBe(403);
    expect((await district.get(`/obituaries/manage/${haryana.id}`)).status).toBe(404);
  });

  it("validates input and blocks mass assignment", async () => {
    const { client: member } = await createMember();
    const bad = async (over: Record<string, unknown>) => (await member.post("/obituaries", notice(over))).status;
    expect(await bad({ dateOfDeath: "2999-01-01" })).toBe(400);
    expect(await bad({ dateOfBirth: "2026-09-10", dateOfDeath: "2026-09-01" })).toBe(400); // born after death
    expect(await bad({ dateOfDeath: undefined })).toBe(400);
    expect(await bad({ locationPath: "nowhere/x" })).toBe(400);
    expect(await bad({ translations: {} })).toBe(400);
    expect(await bad({ photoUrl: "https://evil.example/x.jpg" })).toBe(400);
    expect(await bad({ contactPhone: "12345" })).toBe(400);
    expect(await bad({ gotraId: "cl000000000000000000000000" })).toBe(400);
    expect(await bad({ ceremonies: Array.from({ length: 7 }, () => ({ type: "OTHER", startsAt: inDays(1), venue: "Hall" })) })).toBe(400);
    expect(await bad({ ceremonies: [{ type: "PARTY", startsAt: inDays(1), venue: "Hall" }] })).toBe(400);
    expect(await bad({ status: "PUBLISHED" })).toBe(400);
  });

  it("builds a readable URL from a Hindi-only name", async () => {
    const o = await publish({ translations: { hi: { name: "गोपाल लाल जांगिड़" } } });
    expect(o.slug).toMatch(/^gopal-lal-jangid(-[0-9a-f]+)?$/);
    expect((await publicGet(`/obituaries/${o.slug}`)).body.translations.hi.name).toBe("गोपाल लाल जांगिड़");
  });

  it("links a gotra from the master list and strips markup", async () => {
    const gotra = await prisma.gotra.findFirstOrThrow({ where: { isActive: true }, select: { id: true, nameEn: true } });
    const o = await publish({
      gotraId: gotra.id,
      translations: { en: { name: "<b>Asha</b> Jangid", biography: "<script>alert(1)</script>Kind", familyMessage: "<img src=x onerror=alert(1)>Family" } },
    });
    const pub = (await publicGet(`/obituaries/${o.slug}`)).body;
    expect(pub.gotra.nameEn).toBe(gotra.nameEn);
    expect(pub.translations.en.name).toBe("Asha Jangid");
    expect(JSON.stringify(pub.translations)).not.toContain("<");
  });

  it("lists newest first with the next upcoming rite, and filters by place and name", async () => {
    const older = await publish({ dateOfDeath: "2026-01-01", ceremonies: [] });
    const newer = await publish({ dateOfDeath: "2026-09-20", ceremonies: [{ type: "ANTIM_YATRA", startsAt: inDays(-1), venue: "Past" }, { type: "UTHAVNA", startsAt: inDays(2), venue: "Upcoming hall" }] });
    const list = await publicGet("/obituaries?limit=50");
    const slugs = list.body.items.map((i: { slug: string }) => i.slug);
    expect(slugs.indexOf(newer.slug)).toBeLessThan(slugs.indexOf(older.slug));
    const card = list.body.items.find((i: { slug: string }) => i.slug === newer.slug);
    expect(card.nextCeremony.venue).toBe("Upcoming hall");

    const rohtak = await publicGet("/obituaries?location=haryana&limit=50");
    expect(rohtak.body.items.every((i: { location: { path: string } }) => i.location.path.startsWith("haryana"))).toBe(true);
    expect((await publicGet("/obituaries?q=Ramnarayan")).body.items.length).toBeGreaterThan(0);
  });

  it("tributes are moderated, one per member, and only on published notices", async () => {
    const o = await publish();
    const { client: member, user } = await createMember();
    expect((await publicGet(`/obituaries/${o.slug}`)).status).toBe(200);

    const t = await member.post(`/obituaries/${o.id}/tributes`, { message: "<b>Om Shanti</b>. Deepest condolences.", relation: "Neighbour" });
    expect(t.status).toBe(201);
    expect(t.body.status).toBe("PENDING");
    expect(t.body.message).toBe("Om Shanti. Deepest condolences.");
    expect((await publicGet(`/obituaries/${o.slug}/tributes`)).body.items).toHaveLength(0);
    expect((await member.get(`/obituaries/${o.id}/tributes/mine`)).body.tribute.status).toBe("PENDING");

    // Moderation: members cannot approve, editors can.
    expect((await member.post(`/obituaries/tributes/${t.body.id}/approve`)).status).toBe(404);
    expect((await editor.post(`/obituaries/tributes/${t.body.id}/approve`)).body.status).toBe("PUBLISHED");
    const pub = await publicGet(`/obituaries/${o.slug}/tributes`);
    expect(pub.body.items).toHaveLength(1);
    expect(pub.body.items[0].authorName).toBe("Member");
    expect(JSON.stringify(pub.body)).not.toContain(user.email);
    expect((await publicGet(`/obituaries/${o.slug}`)).body.tributeCount).toBe(1);

    // Posting again edits the same tribute and sends it back to review.
    const again = await member.post(`/obituaries/${o.id}/tributes`, { message: "Updated words" });
    expect(again.body.id).toBe(t.body.id);
    expect(again.body.status).toBe("PENDING");
    expect((await publicGet(`/obituaries/${o.slug}/tributes`)).body.items).toHaveLength(0);

    expect((await editor.post(`/obituaries/tributes/${t.body.id}/hide`)).body.status).toBe("HIDDEN");
    expect((await member.delete(`/obituaries/${o.id}/tributes/mine`)).body.deleted).toBe(true);
    expect((await member.get(`/obituaries/${o.id}/tributes/mine`)).body.tribute).toBeNull();

    // Staff tributes publish immediately; unpublished notices take none.
    expect((await editor.post(`/obituaries/${o.id}/tributes`, { message: "Om Shanti" })).body.status).toBe("PUBLISHED");
    const { client: fam } = await createMember();
    const pending = await fam.post("/obituaries", notice());
    expect((await member.post(`/obituaries/${pending.body.id}/tributes`, { message: "Om Shanti" })).status).toBe(404);
    expect((await publicGet(`/obituaries/${o.slug}/tributes`)).status).toBe(200);
    expect((await member.post(`/obituaries/${o.id}/tributes`, { message: "x" })).status).toBe(400);
  });

  it("the moderation queue respects area scope", async () => {
    const haryana = await publish({ locationPath: "haryana/rohtak/rohtak" });
    const { client: member } = await createMember();
    const t = await member.post(`/obituaries/${haryana.id}/tributes`, { message: "Om Shanti" });

    const queue = await editor.get("/obituaries/manage/tributes?status=PENDING&limit=50");
    expect(queue.body.items.some((i: { id: string }) => i.id === t.body.id)).toBe(true);
    const scoped = await district.get("/obituaries/manage/tributes?status=PENDING&limit=50");
    expect(scoped.body.items.some((i: { id: string }) => i.id === t.body.id)).toBe(false);
    expect((await district.post(`/obituaries/tributes/${t.body.id}/approve`)).status).toBe(404);
    expect((await member.get("/obituaries/manage/tributes")).status).toBe(403);

    const list = await editor.get("/obituaries/manage/list?limit=50");
    expect(list.body.items.find((i: { id: string }) => i.id === haryana.id).pendingTributes).toBe(1);
  });

  it("only a super admin can delete, and the deletion is audited", async () => {
    const o = await publish();
    const { client: member } = await createMember();
    await member.post(`/obituaries/${o.id}/tributes`, { message: "Om Shanti" });

    expect((await member.delete(`/obituaries/${o.id}`)).status).toBe(403);
    expect((await editor.delete(`/obituaries/${o.id}`)).status).toBe(403);
    expect((await admin.delete(`/obituaries/${o.id}`)).body.deleted).toBe(true);
    expect((await publicGet(`/obituaries/${o.slug}`)).status).toBe(404);
    expect(await prisma.obituaryTribute.count({ where: { obituaryId: o.id } })).toBe(0);

    const log = await prisma.auditLog.findFirst({ where: { action: "obituary.delete", entityId: o.id } });
    expect(log?.meta).toMatchObject({ slug: o.slug, status: "PUBLISHED" });
  });

  it("requires login to submit or pay tribute, and feeds the sitemap and dashboard", async () => {
    expect((await publicGet("/obituaries/manage/list")).status).toBe(401);
    const site = await publicGet("/sitemap");
    expect(Array.isArray(site.body.obituaries)).toBe(true);
    const stats = await editor.get("/admin/stats");
    expect(stats.body.content.obituaries.published).toBeGreaterThan(0);
    expect(typeof stats.body.content.obituaries.tributesPending).toBe("number");
  });
});
