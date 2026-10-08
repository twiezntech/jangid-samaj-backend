import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma";
import { newOpaqueToken } from "../src/utils/jwt";
import { PASSWORD, client, createMember, loginAs, publicGet, rid } from "./helpers";

type Client = Awaited<ReturnType<typeof loginAs>>;
let editor: Client;

beforeAll(async () => {
  editor = await loginAs("editor@jangidsamaj.local");
});

describe("account", () => {
  it("reads and updates the member's own profile", async () => {
    const { client: m } = await createMember();
    const p = await m.get("/account/profile");
    expect(p.status).toBe(200);
    expect(p.body.hasPassword).toBe(true);
    expect(p.body.passwordHash).toBeUndefined();

    const up = await m.patch("/account/profile", { name: "<b>Ravi</b> Jangid", mobile: "98290 55555", locationPath: "rajasthan/jaipur/jaipur" });
    expect(up.status).toBe(200);
    expect(up.body.name).toBe("Ravi Jangid");
    expect(up.body.mobile).toBe("9829055555");
    expect(up.body.location.path).toBe("rajasthan/jaipur/jaipur");

    expect((await m.patch("/account/profile", { role: "SUPER_ADMIN" })).status).toBe(400);
    expect((await m.patch("/account/profile", { avatarUrl: "https://evil.example/a.png" })).status).toBe(400);

    const { client: other } = await createMember();
    expect((await other.patch("/account/profile", { mobile: "9829055555" })).status).toBe(409);
    expect((await publicGet("/account/profile")).status).toBe(401);
  });

  it("changes the password only with the current one, and signs other sessions out", async () => {
    const { client: m, user } = await createMember();
    const second = await loginAs(user.email!);
    expect((await m.post("/account/password", { currentPassword: "wrong-pass-1", newPassword: "NewPass123" })).status).toBe(400);
    expect((await m.post("/account/password", { currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
    expect((await m.post("/account/password", { currentPassword: PASSWORD, newPassword: "NewPass123" })).status).toBe(200);

    expect((await client().post("/auth/login", { email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await client().post("/auth/login", { email: user.email, password: "NewPass123" })).status).toBe(200);
    // The other device's refresh token was revoked.
    expect((await second.post("/auth/refresh")).status).toBe(401);
  });

  it("resets a forgotten password with a one-time link", async () => {
    const { user } = await createMember();
    expect((await client().post("/auth/forgot-password", { email: user.email })).body.ok).toBe(true);
    expect((await client().post("/auth/forgot-password", { email: `nobody-${rid()}@test.local` })).body.ok).toBe(true); // same answer for unknown emails

    const { token, hash } = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60_000) } });
    expect((await client().post("/auth/reset-password", { token, password: "weak" })).status).toBe(400);
    expect((await client().post("/auth/reset-password", { token, password: "Reset1234" })).body.ok).toBe(true);
    expect((await client().post("/auth/reset-password", { token, password: "Reset1234" })).status).toBe(400); // single use
    expect((await client().post("/auth/login", { email: user.email, password: "Reset1234" })).status).toBe(200);

    const expired = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: expired.hash, expiresAt: new Date(Date.now() - 1000) } });
    expect((await client().post("/auth/reset-password", { token: expired.token, password: "Reset5678" })).status).toBe(400);
  });

  it("deletes a member account and removes their identity", async () => {
    const { client: m, user } = await createMember();
    await m.post("/account/saved", { type: "NEWS", slug: "national-mahasabha-2026" });
    expect((await m.post("/account/delete", { confirm: "DELETE", password: "wrong-pass-1" })).status).toBe(400);
    expect((await m.post("/account/delete", { confirm: "yes", password: PASSWORD })).status).toBe(400);
    expect((await m.post("/account/delete", { confirm: "DELETE", password: PASSWORD })).body.deleted).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).toBeNull();
    expect(row.isActive).toBe(false);
    expect(await prisma.savedItem.count({ where: { userId: user.id } })).toBe(0);
    expect((await client().post("/auth/login", { email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await editor.post("/account/delete", { confirm: "DELETE", password: PASSWORD })).status).toBe(403); // staff cannot self-delete
  });

  it("saves only public items and lists them newest first", async () => {
    const { client: m } = await createMember();
    expect((await m.post("/account/saved", { type: "NEWS", slug: "national-mahasabha-2026" })).status).toBe(201);
    expect((await m.post("/account/saved", { type: "OBITUARY", slug: "shri-ramnarayan-jangid-jaipur" })).status).toBe(201);
    expect((await m.post("/account/saved", { type: "NEWS", slug: "national-mahasabha-2026" })).status).toBe(201); // idempotent
    expect((await m.post("/account/saved", { type: "NEWS", slug: "does-not-exist" })).status).toBe(404);
    expect((await m.post("/account/saved", { type: "PROFILE", slug: "x" })).status).toBe(400);

    const list = await m.get("/account/saved");
    expect(list.body.meta.total).toBe(2);
    expect(list.body.items[0].title).toMatch(/^स्व\./);
    expect((await m.get("/account/saved/status?type=NEWS&slug=national-mahasabha-2026")).body.saved).toBe(true);
    await m.post("/account/saved/remove", { type: "NEWS", slug: "national-mahasabha-2026" });
    expect((await m.get("/account/saved/status?type=NEWS&slug=national-mahasabha-2026")).body.saved).toBe(false);
  });

  it("notifies the submitter when a moderator approves or returns their post", async () => {
    const { client: m } = await createMember();
    const a = await m.post("/achievements", { category: "STUDENT", locationPath: "rajasthan/jaipur/jaipur", translations: { en: { personName: "Asha", title: `Topped exam ${rid()}` } } });
    await editor.post(`/achievements/${a.body.id}/reject`, { reason: "Please add a photo" });
    await m.post(`/achievements/${a.body.id}/submit`);
    await editor.post(`/achievements/${a.body.id}/approve`);

    const inbox = await m.get("/account/notifications");
    expect(inbox.body.unread).toBe(2);
    expect(inbox.body.items[0].type).toBe("APPROVED");
    expect(inbox.body.items[0].link).toBe(`/achievements/${a.body.slug}`);
    expect(inbox.body.items[1]).toMatchObject({ type: "REJECTED", bodyEn: "Please add a photo" });

    expect((await m.post(`/account/notifications/${inbox.body.items[1].id}/read`)).body.unread).toBe(1);
    expect((await m.post("/account/notifications/read")).body.unread).toBe(0);
    // Nobody else can touch them.
    const { client: other } = await createMember();
    expect((await other.get("/account/notifications")).body.meta.total).toBe(0);
  });
});
