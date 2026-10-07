import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/config/prisma";

export const ORIGIN = "http://localhost:3010";
export const PASSWORD = "Test@Pass123";
export const API = "/api/v1";

export const rid = () => Math.random().toString(36).slice(2, 10);

/** Cookie-carrying client that always sends a trusted Origin on state-changing calls. */
export function client() {
  const agent = request.agent(app);
  return {
    get: (url: string) => agent.get(`${API}${url}`),
    post: (url: string, body?: object) => agent.post(`${API}${url}`).set("Origin", ORIGIN).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(`${API}${url}`).set("Origin", ORIGIN).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(`${API}${url}`).set("Origin", ORIGIN).send(body ?? {}),
    delete: (url: string) => agent.delete(`${API}${url}`).set("Origin", ORIGIN),
    upload: (url: string, file: Buffer, name = "file.bin") => agent.post(`${API}${url}`).set("Origin", ORIGIN).attach("file", file, name),
  };
}

export async function loginAs(email: string, password = PASSWORD) {
  const c = client();
  const res = await c.post("/auth/login", { email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export async function createMember(email = `member-${rid()}@test.local`) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "MEMBER" } });
  const user = await prisma.user.create({
    data: { email, name: "Member", passwordHash: await bcrypt.hash(PASSWORD, 4), isEmailVerified: true, roleId: role.id },
  });
  return { user, client: await loginAs(email) };
}

export const publicGet = (url: string) => request(app).get(`${API}${url}`);

export const newsPayload = (over: Record<string, unknown> = {}) => ({
  translations: { en: { title: `Test story ${rid()}`, body: "<p>Story body</p>" }, hi: { title: `परीक्षण खबर ${rid()}`, body: "<p>खबर का पाठ</p>" } },
  locationPath: "rajasthan/jaipur/jaipur",
  categorySlug: "samaj",
  ...over,
});
