import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { createMember, loginAs, publicGet } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client, admin: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
  admin = await loginAs("admin@jangidsamaj.local");
});

const dobForAge = (age: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age, 0, 1);
  return d.toISOString().slice(0, 10);
};

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Test Person",
  gender: "MALE",
  dateOfBirth: dobForAge(28),
  locationPath: "rajasthan/jaipur/jaipur",
  educationLevel: "GRADUATE",
  profession: "Engineer",
  contactPhone: "9829077777",
  photos: ["https://images.unsplash.com/photo-1548013146-72479768bada"],
  ...over,
});

/** A member with an approved profile. */
async function liveMember(over: Record<string, unknown> = {}) {
  const { client, user } = await createMember();
  const created = await client.post("/matrimony/me", profile(over));
  expect(created.status).toBe(201);
  expect((await admin.post(`/matrimony/manage/${created.body.id}/approve`)).body.status).toBe("PUBLISHED");
  return { client, user, id: created.body.id as string, code: created.body.code as string };
}

describe("matrimony", () => {
  it("is private: no access without login, profiles go live only after approval", async () => {
    expect((await publicGet("/matrimony/search")).status).toBe(401);
    const { client: m } = await createMember();
    const created = await m.post("/matrimony/me", profile());
    expect(created.body.status).toBe("PENDING_REVIEW");
    expect(created.body.code).toMatch(/^JS\d{5}$/);
    expect((await m.post("/matrimony/me", profile())).status).toBe(409); // one per account

    const { client: viewer } = await createMember();
    expect((await viewer.get(`/matrimony/profiles/${created.body.code}`)).status).toBe(404);
    expect((await m.get(`/matrimony/profiles/${created.body.code}`)).body.own).toBe(true);
  });

  it("enforces the legal minimum age and valid gotras", async () => {
    const { client: m } = await createMember();
    expect((await m.post("/matrimony/me", profile({ gender: "MALE", dateOfBirth: dobForAge(20) }))).status).toBe(400);
    expect((await m.post("/matrimony/me", profile({ gender: "FEMALE", dateOfBirth: dobForAge(17) }))).status).toBe(400);
    expect((await m.post("/matrimony/me", profile({ gotraId: "cl000000000000000000000000" }))).status).toBe(400);
    expect((await m.post("/matrimony/me", profile({ photos: ["https://evil.example/a.jpg"] }))).status).toBe(400);
    expect((await m.post("/matrimony/me", profile({ status: "PUBLISHED" }))).status).toBe(400);
  });

  it("hides contact until an interest is accepted, then reveals it to both sides", async () => {
    const a = await liveMember({ gender: "MALE", contactPhone: "9829011001" });
    const b = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(25), contactPhone: "9829011002" });

    const view = await a.client.get(`/matrimony/profiles/${b.code}`);
    expect(view.body.contact).toBeNull();
    expect(JSON.stringify(view.body)).not.toContain("9829011002");
    expect(view.body.canInterest).toBe(true);

    expect((await a.client.post(`/matrimony/profiles/${b.code}/interest`, { message: "Namaste" })).status).toBe(201);
    expect((await a.client.post(`/matrimony/profiles/${b.code}/interest`, {})).status).toBe(409);
    expect((await b.client.post(`/matrimony/profiles/${a.code}/interest`, {})).status).toBe(409); // must respond instead

    const received = await b.client.get("/matrimony/interests?box=received");
    expect(received.body.items[0].profile.code).toBe(a.code);
    expect((await a.client.post(`/matrimony/interests/${received.body.items[0].id}/respond`, { accept: true })).status).toBe(404); // not theirs
    expect((await b.client.post(`/matrimony/interests/${received.body.items[0].id}/respond`, { accept: true })).body.status).toBe("ACCEPTED");

    expect((await a.client.get(`/matrimony/profiles/${b.code}`)).body.contact.phone).toBe("9829011002");
    expect((await b.client.get(`/matrimony/profiles/${a.code}`)).body.contact.phone).toBe("9829011001");
    const inbox = await a.client.get("/account/notifications");
    expect(inbox.body.items[0].type).toBe("INTEREST_ACCEPTED");
  });

  it("respects photo privacy", async () => {
    const shy = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(26), photoVisibility: "ON_ACCEPT" });
    const { client: viewer } = await liveMember({ gender: "MALE" });
    const v = await viewer.get(`/matrimony/profiles/${shy.code}`);
    expect(v.body.photos).toHaveLength(0);
    expect(v.body.photoLocked).toBe(true);
    const search = await viewer.get(`/matrimony/search?q=${shy.code}`);
    expect(search.body.items[0].photo).toBeNull();
  });

  it("searches the opposite gender by age, and excludes my gotra when asked", async () => {
    const gotra = await prisma.gotra.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    const me = await liveMember({ gender: "MALE", gotraId: gotra.id });
    const same = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(24), gotraId: gotra.id });
    const other = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(24) });

    const all = await me.client.get("/matrimony/search?ageMin=23&ageMax=25&limit=50");
    const codes = all.body.items.map((i: { code: string }) => i.code);
    expect(all.body.items.every((i: { gender: string; age: number }) => i.gender === "FEMALE" && i.age >= 23 && i.age <= 25)).toBe(true);
    expect(codes).toEqual(expect.arrayContaining([same.code, other.code]));

    const excl = await me.client.get("/matrimony/search?ageMin=23&ageMax=25&excludeMyGotra=true&limit=50");
    const codes2 = excl.body.items.map((i: { code: string }) => i.code);
    expect(codes2).not.toContain(same.code);
    expect(codes2).toContain(other.code);
  });

  it("blocking hides both profiles from each other and closes pending interests", async () => {
    const a = await liveMember({ gender: "MALE" });
    const b = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(25) });
    await b.client.post(`/matrimony/profiles/${a.code}/interest`, {});
    expect((await a.client.post(`/matrimony/profiles/${b.code}/block`, { on: true })).body.blocked).toBe(true);

    expect((await b.client.get(`/matrimony/profiles/${a.code}`)).status).toBe(404);
    const search = await b.client.get(`/matrimony/search?q=${a.code}`);
    expect(search.body.items).toHaveLength(0);
    expect((await b.client.post(`/matrimony/profiles/${a.code}/interest`, {})).status).toBe(404);
    const sent = await b.client.get("/matrimony/interests?box=sent");
    expect(sent.body.items[0].status).toBe("DECLINED");
  });

  it("re-reviews a live profile when identity or photos change, and can be hidden by the owner", async () => {
    const a = await liveMember();
    expect((await a.client.patch("/matrimony/me", { profession: "Doctor" })).body.status).toBe("PUBLISHED");
    expect((await a.client.patch("/matrimony/me", { photos: [] })).body.status).toBe("PENDING_REVIEW");
    await admin.post(`/matrimony/manage/${a.id}/approve`);

    const { client: viewer } = await liveMember({ gender: "FEMALE", dateOfBirth: dobForAge(25) });
    await a.client.post("/matrimony/me/hide", { hidden: true });
    expect((await viewer.get(`/matrimony/profiles/${a.code}`)).status).toBe(404);
    await a.client.post("/matrimony/me/hide", { hidden: false });
    expect((await viewer.get(`/matrimony/profiles/${a.code}`)).status).toBe(200);
  });

  it("moderation needs matrimony.manage; rejection notifies the member", async () => {
    const { client: m } = await createMember();
    const p = await m.post("/matrimony/me", profile());
    expect((await m.get("/matrimony/manage/list")).status).toBe(403);
    expect((await admin.post(`/matrimony/manage/${p.body.id}/reject`, {})).status).toBe(400);
    expect((await admin.post(`/matrimony/manage/${p.body.id}/reject`, { reason: "Please add a clear photo" })).body.status).toBe("REJECTED");
    expect((await m.get("/account/notifications")).body.items[0]).toMatchObject({ type: "REJECTED", link: "/rishte/my-profile" });
    // Editing a rejected profile resubmits it.
    expect((await m.patch("/matrimony/me", { about: "Updated" })).body.status).toBe("PENDING_REVIEW");
    expect((await admin.get("/matrimony/manage/stats")).body.pending).toBeGreaterThan(0);
    expect((await editor.get("/matrimony/manage/list")).status).toBe(403); // editors do not moderate matrimony
  });

  it("deleting my account removes my matrimony profile", async () => {
    const a = await liveMember();
    await a.client.post("/account/delete", { confirm: "DELETE", password: "Test@Pass123" });
    expect(await prisma.matrimonyProfile.count({ where: { id: a.id } })).toBe(0);
  });
});
