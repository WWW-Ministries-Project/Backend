import { NextFunction, Request, Response } from "express";
import { toUserFriendlyMessage } from "../utils/friendlyMessages";

type ObjectRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is ObjectRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const shouldSkipPath = (url: string): boolean => {
  return url.startsWith("/api-docs") || url.startsWith("/metrics");
};

const enhanceErrorField = (value: unknown, statusCode: number): unknown => {
  if (typeof value === "string") {
    return toUserFriendlyMessage(value, { isError: true, statusCode });
  }

  if (isPlainObject(value) && typeof value.message === "string") {
    return {
      ...value,
      message: toUserFriendlyMessage(value.message, {
        isError: true,
        statusCode,
      }),
    };
  }

  return value;
};

const enhanceResponseMessages = (
  body: unknown,
  statusCode: number,
): unknown => {
  if (!isPlainObject(body)) {
    return body;
  }

  const responseBody: ObjectRecord = { ...body };
  const isError = statusCode >= 400;

  if (typeof responseBody.message === "string") {
    responseBody.message = toUserFriendlyMessage(responseBody.message, {
      isError,
      statusCode,
    });
  }

  if (responseBody.error !== undefined) {
    responseBody.error = enhanceErrorField(responseBody.error, statusCode);
  }

  if (
    isPlainObject(responseBody.notification) &&
    typeof responseBody.notification.error === "string"
  ) {
    responseBody.notification = {
      ...responseBody.notification,
      error: toUserFriendlyMessage(responseBody.notification.error, {
        isError: true,
        statusCode,
      }),
    };
  }

  return responseBody;
};

export const responseMessageEnhancer = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (shouldSkipPath(req.originalUrl || req.url || "")) {
    return next();
  }

  const originalJson = res.json.bind(res);

  res.json = ((body?: any): Response => {
    const enhancedBody = enhanceResponseMessages(body, res.statusCode);
    return originalJson(enhancedBody);
  }) as Response["json"];

  next();
};
