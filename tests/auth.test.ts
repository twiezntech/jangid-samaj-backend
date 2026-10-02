import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { API, ORIGIN, PASSWORD, rid } from "./helpers";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("../src/utils/mailer", async (orig) => {
  const real = await orig<typeof import("../src/utils/mailer")>();
  return { ...real, sendMail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) };
});

const post = (url: string, body: object) => request(app).post(`${API}${url}`).set("Origin", ORIGIN).send(body);
const tokenFrom = (to: string) => {
  const mail = [...sent].reverse().find((m) => m.to === to && m.text.includes("verify-email?token="));
  return mail?.text.match(/token=([a-f0-9]{96})/)?.[1];
};

beforeEach(() => {
  sent.length = 0;
});

describe("sign-up and email verification", () => {
  it("registers without a session, blocks login until verified, then verifies once", async () => {
    const email = `u-${rid()}@test.local`;
    const reg = await post("/auth/register", { name: "New User", email, password: PASSWORD });
    expect(reg.status).toBe(202);
    expect(reg.headers["set-cookie"]).toBeUndefined();

    const blocked = await post("/auth/login", { email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    const token = tokenFrom(email);
    expect(token).toBeTruthy();
    const ok = await post("/auth/verify-email", { token });
    expect(ok.status).toBe(200);
    expect(ok.body.user.isEmailVerified).toBe(true);
    const cookies = (ok.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookies).toMatch(/js_at=.*HttpOnly/i);
    expect(cookies).toMatch(/js_rt=.*Path=\/api\/v1\/auth.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);

    expect((await post("/auth/verify-email", { token })).status).toBe(400); // single use
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("never reveals whether an email is already registered", async () => {
    const email = `dup-${rid()}@test.local`;
    const first = await post("/auth/register", { name: "Dup User", email, password: PASSWORD });
    await post("/auth/verify-email", { token: tokenFrom(email) });
    sent.length = 0;

    const again = await post("/auth/register", { name: "Dup User", email, password: PASSWORD });
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    expect(sent.some((m) => m.to === email && /already/i.test(m.subject + m.text))).toBe(true); // owner is told by email
  });

  it("silently drops honeypot submissions and rejects weak passwords", async () => {
    const email = `bot-${rid()}@test.local`;
    const res = await post("/auth/register", { name: "Bot User", email, password: PASSWORD, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    expect((await post("/auth/register", { name: "Weak", email: `w-${rid()}@test.local`, password: "short" })).status).toBe(400);
    expect((await post("/auth/register", { name: "Weak", email: `w-${rid()}@test.local`, password: "onlyletters" })).status).toBe(400);
  });

  it("resend is generic for unknown emails", async () => {
    const res = await post("/auth/resend-verification", { email: `nobody-${rid()}@test.local` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });
});

describe("sessions", () => {
  const cookieValue = (setCookie: string[], name: string) => setCookie.find((c) => c.startsWith(`${name}=`))!.split(";")[0];

  it("rotates refresh tokens and revokes the whole session family on reuse", async () => {
    const login = await post("/auth/login", { email: "reporter@jangidsamaj.local", password: PASSWORD });
    const rt1 = cookieValue(login.headers["set-cookie"] as unknown as string[], "js_rt");

    const rotated = await request(app).post(`${API}/auth/refresh`).set("Origin", ORIGIN).set("Cookie", rt1).send({});
    expect(rotated.status).toBe(200);
    const rt2 = cookieValue(rotated.headers["set-cookie"] as unknown as string[], "js_rt");
    expect(rt2).not.toBe(rt1);

    const replay = await request(app).post(`${API}/auth/refresh`).set("Origin", ORIGIN).set("Cookie", rt1).send({});
    expect(replay.status).toBe(401);
    const afterTheft = await request(app).post(`${API}/auth/refresh`).set("Origin", ORIGIN).set("Cookie", rt2).send({});
    expect(afterTheft.status).toBe(401);
  });

  it("gives identical errors for wrong password and unknown user, and locks after repeated failures", async () => {
    const unknown = await post("/auth/login", { email: `ghost-${rid()}@test.local`, password: "whatever1" });
    const wrong = await post("/auth/login", { email: "district@jangidsamaj.local", password: "Wrong-pass-1" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);

    for (let i = 0; i < 4; i++) await post("/auth/login", { email: "district@jangidsamaj.local", password: "Wrong-pass-1" });
    const locked = await post("/auth/login", { email: "district@jangidsamaj.local", password: PASSWORD });
    expect(locked.status).toBe(429);

    await prisma.user.update({ where: { email: "district@jangidsamaj.local" }, data: { lockedUntil: null, failedLogins: 0 } });
    expect((await post("/auth/login", { email: "district@jangidsamaj.local", password: PASSWORD })).status).toBe(200);
  });

  it("exposes permissions on /me for UI gating", async () => {
    const agent = request.agent(app);
    await agent.post(`${API}/auth/login`).set("Origin", ORIGIN).send({ email: "editor@jangidsamaj.local", password: PASSWORD });
    const me = await agent.get(`${API}/auth/me`);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("CONTENT_EDITOR");
    expect(me.body.user.permissions).toContain("news.review");
    expect(me.body.user).not.toHaveProperty("passwordHash");
  });
});
