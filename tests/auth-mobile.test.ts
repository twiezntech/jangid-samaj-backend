import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { API, PASSWORD, createMember, rid } from "./helpers";

const mobile = (method: "get" | "post", url: string, body?: object, bearer?: string) => {
  let r = request(app)[method](`${API}${url}`).set("X-Client", "mobile"); // no Origin header, like a native app
  if (bearer) r = r.set("Authorization", `Bearer ${bearer}`);
  return body ? r.send(body) : r;
};

async function mobileLogin() {
  const { user } = await createMember(`m-${rid()}@test.local`);
  const res = await mobile("post", "/auth/login", { email: user.email, password: PASSWORD });
  return { user, res };
}

describe("mobile auth: tokens in the body", () => {
  it("login returns the user and both tokens, and sets no cookies", async () => {
    const { user, res } = await mobileLogin();
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toMatch(/^[a-f0-9]{96}$/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("the access token works as a Bearer token", async () => {
    const { user, res } = await mobileLogin();
    const me = await mobile("get", "/auth/me", undefined, res.body.accessToken);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
    expect((await mobile("get", "/auth/me")).status).toBe(401);
  });

  it("refresh rotates the token; replaying the old one is rejected and kills the session", async () => {
    const { res } = await mobileLogin();
    const first = res.body.refreshToken;

    const rotated = await mobile("post", "/auth/refresh", { refreshToken: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(first);
    expect(rotated.headers["set-cookie"]).toBeUndefined();
    expect((await mobile("get", "/auth/me", undefined, rotated.body.accessToken)).status).toBe(200);

    expect((await mobile("post", "/auth/refresh", { refreshToken: first })).status).toBe(401); // reuse detected
    expect((await mobile("post", "/auth/refresh", { refreshToken: rotated.body.refreshToken })).status).toBe(401); // whole family revoked
  });

  it("refresh with a missing or malformed token is a plain 401", async () => {
    expect((await mobile("post", "/auth/refresh", {})).status).toBe(401);
    expect((await mobile("post", "/auth/refresh", { refreshToken: "nope" })).status).toBe(401);
    expect((await mobile("post", "/auth/refresh", { refreshToken: "a".repeat(96) })).status).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const { res } = await mobileLogin();
    const out = await mobile("post", "/auth/logout", { refreshToken: res.body.refreshToken });
    expect(out.status).toBe(204);
    expect((await mobile("post", "/auth/refresh", { refreshToken: res.body.refreshToken })).status).toBe(401);
  });

  it("wrong credentials still answer 401 without tokens", async () => {
    const { user } = await createMember(`m-${rid()}@test.local`);
    const res = await mobile("post", "/auth/login", { email: user.email, password: "Wrong@Pass999" });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe("website auth is unchanged", () => {
  it("login without X-Client sets httpOnly cookies and keeps tokens out of the body", async () => {
    const { user } = await createMember(`w-${rid()}@test.local`);
    const res = await request(app).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookies).toMatch(/js_at=.*HttpOnly/i);
    expect(cookies).toMatch(/js_rt=.*HttpOnly/i);
  });

  it("a refresh token in the body is ignored for non-mobile clients", async () => {
    const { res } = await mobileLogin();
    const viaBody = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: res.body.refreshToken });
    expect(viaBody.status).toBe(401);
  });
});
