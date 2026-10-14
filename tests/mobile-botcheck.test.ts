import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";
import { API, PASSWORD, rid } from "./helpers";

// Turnstile always fails here: only the mobile app key may get past the human check.
vi.mock("../src/utils/turnstile", () => ({ verifyTurnstile: async () => false }));

const KEY = "test-mobile-key-0123456789abcd"; // set in vitest.config.ts

async function member() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "MEMBER" } });
  const email = `bc-${rid()}@test.local`;
  await prisma.user.create({ data: { email, name: "Member", passwordHash: await bcrypt.hash(PASSWORD, 4), isEmailVerified: true, roleId: role.id } });
  return email;
}

const login = (email: string, headers: Record<string, string> = {}) =>
  request(app).post(`${API}/auth/login`).set(headers).send({ email, password: PASSWORD });

describe("bot check for the mobile app", () => {
  it("browsers without a Turnstile token are refused", async () => {
    const res = await login(await member());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BOT_CHECK_FAILED");
  });

  it("X-Client alone is not enough: the header is trivially spoofable", async () => {
    const res = await login(await member(), { "X-Client": "mobile" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BOT_CHECK_FAILED");
  });

  it("a wrong app key is refused", async () => {
    const res = await login(await member(), { "X-Client": "mobile", "X-App-Key": "x".repeat(KEY.length) });
    expect(res.status).toBe(400);
  });

  it("the right app key passes the human check", async () => {
    const res = await login(await member(), { "X-Client": "mobile", "X-App-Key": KEY });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toMatch(/^[a-f0-9]{96}$/);
  });

  it("the app key without X-Client does not bypass the check", async () => {
    const res = await login(await member(), { "X-App-Key": KEY });
    expect(res.status).toBe(400);
  });
});
