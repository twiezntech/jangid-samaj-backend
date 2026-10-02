import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: env.jwtAccessExpiresIn as SignOptions["expiresIn"],
  };
  return jwt.sign({ sub: userId }, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ["HS256"] });
  if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("Bad token");
  return { sub: payload.sub };
}

export function newOpaqueToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
