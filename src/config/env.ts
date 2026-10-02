import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

const jwtAccessSecret = required("JWT_ACCESS_SECRET");
const jwtRefreshSecret = required("JWT_REFRESH_SECRET");
if (isProd && (jwtAccessSecret.length < 32 || jwtRefreshSecret.length < 32)) {
  throw new Error("JWT secrets must be at least 32 characters in production");
}

export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required("DATABASE_URL"),

  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  mailFrom: process.env.MAIL_FROM ?? "Jangid Samaj <onboarding@resend.dev>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY ?? "",
  imageHosts: (process.env.IMAGE_HOSTS ?? "images.unsplash.com").split(",").map((h) => h.trim()).filter(Boolean),
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, ""),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()),
} as const;
