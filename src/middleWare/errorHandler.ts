import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  AppError,
  InputValidationError,
} from "../utils/custom-error-handlers";
import logger from "../utils/logger-config";

const isDevelopment =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const buildPrismaError = (error: Prisma.PrismaClientKnownRequestError) => {
  if (error.code === "P2002") {
    return {
      statusCode: StatusCodes.CONFLICT,
      message: "A record with the same unique value already exists.",
    };
  }

  if (error.code === "P2025") {
    return {
      statusCode: StatusCodes.NOT_FOUND,
      message: "Requested record was not found.",
    };
  }

  return {
    statusCode: StatusCodes.BAD_REQUEST,
    message: "Database request failed.",
  };
};

const normalizeError = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error instanceof InputValidationError) {
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = buildPrismaError(error);
    return {
      ...prismaError,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
      stack: error.stack,
    };
  }

  return {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    message: "Internal Server Error",
    stack: undefined,
  };
};

export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  next(
    new AppError(
      `Route not found: ${req.method} ${req.originalUrl}`,
      StatusCodes.NOT_FOUND,
    ),
  );
};

export const globalErrorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    return next(error);
  }

  const normalizedError = normalizeError(error);

  if (isDevelopment) {
    logger.error(normalizedError.message, {
      stack: normalizedError.stack,
      method: req.method,
      url: req.originalUrl,
    });
  } else {
    logger.info(normalizedError.message);
  }

  return res.status(normalizedError.statusCode).json({
    message: normalizedError.message,
    data: null,
    ...(isDevelopment && normalizedError.stack
      ? { stack: normalizedError.stack }
      : {}),
  });
};
