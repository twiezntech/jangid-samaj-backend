import { NextFunction, Request, Response } from "express";

/**
 * Cache-Control for anonymous GETs so a CDN / the Next.js server can absorb read traffic.
 * `Vary: Cookie` keeps signed-in responses (if any) out of shared caches.
 */
export function publicCache(seconds: number, staleWhileRevalidate = seconds * 5) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", `public, max-age=${Math.min(seconds, 30)}, s-maxage=${seconds}, stale-while-revalidate=${staleWhileRevalidate}`);
    res.vary("Cookie");
    next();
  };
}

export const noStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "no-store");
  next();
};
