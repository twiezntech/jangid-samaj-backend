import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError";
import { verifyAccessToken } from "../utils/jwt";
import { ACCESS_COOKIE } from "../utils/cookies";
import { env } from "../config/env";
import { Actor, can, loadActor } from "../lib/access";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      actor?: Actor;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
  const token = req.cookies?.[ACCESS_COOKIE] ?? bearer;
  if (!token) return next(ApiError.unauthorized());

  try {
    req.userId = verifyAccessToken(token).sub;
    next();
  } catch {
    next(ApiError.unauthorized("Session expired"));
  }
}

/** Authenticated AND still an active, verified account. Populates req.actor with role + permissions. */
export async function requireActor(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async (err?: unknown) => {
    if (err) return next(err);
    try {
      const actor = await loadActor(req.userId!);
      if (!actor) return next(ApiError.unauthorized("Account is not active"));
      req.actor = actor;
      next();
    } catch (e) {
      next(e);
    }
  });
}

/** Passes if the actor holds ANY of the listed permissions. Use after requireActor. */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(ApiError.unauthorized());
    if (keys.some((k) => can(req.actor, k))) return next();
    next(ApiError.forbidden("Insufficient permissions", "FORBIDDEN"));
  };
}

/** Best-effort identity for public routes that behave differently for signed-in users. Never rejects. */
export async function optionalActor(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (token) {
    try {
      req.actor = (await loadActor(verifyAccessToken(token).sub)) ?? undefined;
    } catch {
      /* anonymous */
    }
  }
  next();
}

/** CSRF defence for cookie auth: state-changing requests must come from an allowed origin. */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) return next();
  if (!origin && !req.cookies?.[ACCESS_COOKIE] && !req.headers.cookie) return next(); // non-browser clients (mobile app)
  next(ApiError.forbidden("Untrusted origin"));
}
