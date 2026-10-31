import { NextFunction, Request, Response } from "express";

/**
 * Per-user upload limit (same fixed-window approach as authRateLimiter).
 * Uploads stay open to every signed-in user; this only stops one account (or,
 * without a user id, one IP) from flooding storage. Runs after `protect`.
 */
type RateBucket = { count: number; resetAt: number };

const windowMs = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const maxUploads = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 60);

const buckets = new Map<string, RateBucket>();

const clientKey = (req: Request) => {
  const userId = Number((req as any).user?.id);
  if (Number.isInteger(userId) && userId > 0) return `user:${userId}`;
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip =
    typeof forwardedFor === "string" && forwardedFor.trim()
      ? forwardedFor.split(",")[0].trim()
      : req.socket.remoteAddress || req.ip || "unknown";
  return `ip:${ip}`;
};

export const uploadRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  const key = clientKey(req);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (bucket.count >= maxUploads) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({
      message: "Too many uploads. Try again in a few minutes.",
      data: null,
    });
  }

  bucket.count += 1;
  return next();
};
