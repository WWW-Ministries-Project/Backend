import { Request, Response, NextFunction } from "express";
import { requestLogger } from "../utils/loggers"; // Using your new request logger

const REDACTED_VALUE = "[REDACTED]";
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

export function logRequests(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  const oldSend = res.send;

  let responseBody: any;
  res.send = function (body?: any): Response {
    responseBody = body;
    return oldSend.apply(this, arguments as any);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    let parsedBody: any;
    try {
      parsedBody =
        typeof responseBody === "string"
          ? JSON.parse(responseBody)
          : responseBody;
    } catch {
      parsedBody = responseBody;
    }

    requestLogger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      request: {
        headers: redactSensitive(req.headers),
        query: redactSensitive(req.query),
        body: redactSensitive(req.body),
      },
      response: redactSensitive(parsedBody),
    });
  });

  next();
}
