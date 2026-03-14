import { Request, Response, NextFunction } from "express";
import { requestLogger } from "../utils/loggers"; // Using your new request logger

const REDACTED_VALUE = "[REDACTED]";
const MAX_LOGGED_RESPONSE_BYTES = 4096;
const SKIPPED_LOG_PREFIXES = ["/metrics", "/api-docs"];
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "newpassword",
  "current_password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "mail_password",
  "api_key",
  "apikey",
]);

const redactSensitive = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(normalizedKey) ||
      normalizedKey.includes("password") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret")
    ) {
      redacted[key] = REDACTED_VALUE;
      continue;
    }
    redacted[key] = redactSensitive(nestedValue);
  }

  return redacted;
};

const shouldSkipLogging = (url: string) =>
  SKIPPED_LOG_PREFIXES.some((prefix) => url.startsWith(prefix));

const summarizeStringBody = (body: string) => {
  const sizeBytes = Buffer.byteLength(body, "utf8");
  if (sizeBytes > MAX_LOGGED_RESPONSE_BYTES) {
    return {
      truncated: true,
      sizeBytes,
    };
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const summarizeResponseBody = (body: unknown) => {
  if (typeof body === "string") {
    return summarizeStringBody(body);
  }

  if (Buffer.isBuffer(body)) {
    return {
      binary: true,
      sizeBytes: body.byteLength,
    };
  }

  return body;
};

export function logRequests(req: Request, res: Response, next: NextFunction) {
  const requestUrl = req.originalUrl || req.url || "";
  if (shouldSkipLogging(requestUrl)) {
    return next();
  }

  const start = Date.now();

  const oldSend = res.send;

  let responseBody: any;
  res.send = function (body?: any): Response {
    responseBody = body;
    return oldSend.apply(this, arguments as any);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    requestLogger.info({
      method: req.method,
      url: requestUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.getHeader("content-length") || null,
      request: {
        headers: redactSensitive(req.headers),
        query: redactSensitive(req.query),
        body: redactSensitive(req.body),
      },
      response: redactSensitive(summarizeResponseBody(responseBody)),
    });
  });

  next();
}
