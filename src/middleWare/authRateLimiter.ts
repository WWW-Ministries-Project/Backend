import { NextFunction, Request, Response } from "express";

type RateBucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_ATTEMPTS = 10;

const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || DEFAULT_WINDOW_MS);
const maxAttempts = Number(
  process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS,
);

const buckets = new Map<string, RateBucket>();

const getClientIp = (req: Request) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).trim();
  }

  return req.socket.remoteAddress || req.ip || "unknown";
};

const getBucketKey = (req: Request) => {
  return `${req.method}:${req.path}:${getClientIp(req)}`;
};

const cleanupExpiredBuckets = (now: number) => {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const authRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const key = getBucketKey(req);
  const existingBucket = buckets.get(key);

  if (!existingBucket || existingBucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return next();
  }

  if (existingBucket.count >= maxAttempts) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existingBucket.resetAt - now) / 1000),
    );
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      message: "Too many authentication attempts. Please try again later.",
      data: null,
    });
  }

  existingBucket.count += 1;
  buckets.set(key, existingBucket);
  return next();
};
