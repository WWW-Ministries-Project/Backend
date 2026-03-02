import { Request } from "express";
import JWT from "jsonwebtoken";

const STREAM_TOKEN_PURPOSE = "notifications_stream";
const DEFAULT_STREAM_TOKEN_TTL_SECONDS = 600;
const MAX_STREAM_TOKEN_TTL_SECONDS = 3600;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const getJwtSecret = (): string => {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
};

const resolveTtlSeconds = (): number => {
  const configuredTtl = Number(process.env.NOTIFICATIONS_SSE_TOKEN_TTL_SECONDS);
  if (!Number.isInteger(configuredTtl) || configuredTtl <= 0) {
    return DEFAULT_STREAM_TOKEN_TTL_SECONDS;
  }

  return Math.min(configuredTtl, MAX_STREAM_TOKEN_TTL_SECONDS);
};

type JwtPayload = {
  id?: number | string;
  purpose?: string;
  [key: string]: unknown;
};

const parsePayload = (decoded: string | JWT.JwtPayload): JwtPayload | null => {
  if (!decoded || typeof decoded === "string") {
    return null;
  }

  return decoded as JwtPayload;
};

const normalizeToken = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim() || null;
  }

  return trimmed;
};

export const extractBearerTokenFromHeader = (req: Request): string | null => {
  const headerValue = req.headers["authorization"];
  if (Array.isArray(headerValue)) {
    return normalizeToken(headerValue[0]);
  }

  return normalizeToken(headerValue);
};

export const extractStreamTokenFromQuery = (req: Request): string | null => {
  const candidate =
    req.query?.stream_token ??
    req.query?.streamToken ??
    req.query?.sse_token ??
    req.query?.sseToken ??
    null;

  if (Array.isArray(candidate)) {
    return normalizeToken(candidate[0]);
  }

  return normalizeToken(candidate);
};

export const issueNotificationStreamToken = (userId: number) => {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) {
    throw new Error("userId must be a positive integer");
  }

  const ttlSeconds = resolveTtlSeconds();
  const expiresIn = `${ttlSeconds}s`;
  const token = JWT.sign(
    {
      id: parsedUserId,
      purpose: STREAM_TOKEN_PURPOSE,
    },
    getJwtSecret(),
    {
      expiresIn,
    },
  );

  return {
    token,
    expiresInSeconds: ttlSeconds,
  };
};

export const verifyNotificationStreamToken = (token: string): number | null => {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    return null;
  }

  try {
    const decoded = JWT.verify(normalizedToken, getJwtSecret());
    const payload = parsePayload(decoded);
    if (!payload) {
      return null;
    }

    if (payload.purpose !== STREAM_TOKEN_PURPOSE) {
      return null;
    }

    return toPositiveInt(payload.id);
  } catch (error) {
    return null;
  }
};

