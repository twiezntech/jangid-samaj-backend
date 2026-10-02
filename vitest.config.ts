import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

const base = process.env.DATABASE_URL ?? "";
export const TEST_DB = "jangid_samaj_test";
const testUrl = base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      TURNSTILE_SECRET_KEY: "",
      RESEND_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      LOG_LEVEL: "silent",
      CORS_ORIGINS: "http://localhost:3010",
      UPLOAD_DIR: "node_modules/.cache/test-uploads",
    },
  },
});
