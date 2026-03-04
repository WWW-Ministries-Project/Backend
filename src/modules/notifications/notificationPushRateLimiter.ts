import { NextFunction, Request, Response } from "express";

type PushRateLimitBucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 30;

const windowMs = Number(
  process.env.NOTIFICATION_PUSH_RATE_LIMIT_WINDOW_MS || DEFAULT_WINDOW_MS,
);
const maxAttempts = Number(
  process.env.NOTIFICATION_PUSH_RATE_LIMIT_MAX_ATTEMPTS ||
    DEFAULT_MAX_ATTEMPTS,
);

const buckets = new Map<string, PushRateLimitBucket>();

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return String(forwardedFor[0]).trim() || "unknown";
  }

  return req.socket.remoteAddress || req.ip || "unknown";
};

const getUserId = (req: Request): string => {
  const raw = (req as any)?.user?.id;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "anonymous";
  }

  return String(parsed);
};

const getBucketKey = (req: Request): string =>
  `${req.method}:${req.path}:${getUserId(req)}:${getClientIp(req)}`;

const cleanupExpiredBuckets = (now: number) => {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const notificationPushRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const key = getBucketKey(req);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return next();
  }

  if (bucket.count >= maxAttempts) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    res.setHeader("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      message: "Too many push subscription requests. Please try again later.",
      data: null,
    });
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return next();
};
