import { execSync } from "child_process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const TEST_DB = "jangid_samaj_test";
export const TEST_PASSWORD = "Test@Pass123";

/** Fresh database per run: drop, create, migrate, seed. Never touches the development database. */
export default async function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL missing");
  const admin = new PrismaClient({ datasourceUrl: base.replace(/\/[^/?]+(\?|$)/, "/postgres$1") });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.$disconnect();

  const url = base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: "test", SEED_DEV_PASSWORD: TEST_PASSWORD };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
