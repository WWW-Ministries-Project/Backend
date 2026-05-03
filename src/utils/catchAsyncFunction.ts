import { Logger } from "winston";
import e, { Request, Response, NextFunction } from "express";
import { AppError, InputValidationError } from "./custom-error-handlers";
import { StatusCodes } from "http-status-codes";
import { Prisma } from "@prisma/client";

const development =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

/**
 * Wraps an asynchronous controller function with error handling and logging logic.
 *
 * @param {Function} controllerFunction - The async function to be wrapped.
 * @param {Logger} logger - The logger instance to log errors.
 * @returns {Function} A new function that executes the controller function
 * and handles any errors that occur.
 */
export const catchAsyncFunction = (
  controllerFunction: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<any>,
  logger: Logger,
): ((req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> => {
    try {
      await controllerFunction(req, res, next);
    } catch (error: any) {
      handleLogging(error, logger);
      handleError(error, req, res, next);
    }
  };
};

/**
 * Logs an error to the console using the provided logger. In development mode,
 * logs the error with the error's stack trace. In production mode, logs the
 * error message only.
 *
 * @param {Error} error - The error to log.
 * @param {Logger} logger - The logger instance to use for logging.
 */
const handleLogging = (error: Error, logger: Logger) => {
  if (development) {
    logger.error(error.message, { stack: error.stack });
  } else {
    logger.info(error.message);
  }
};

const handleError = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void | Response => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof InputValidationError) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: "error",
      statusCode: StatusCodes.BAD_REQUEST,
      message: error.message,
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      status: "error",
      statusCode: error.statusCode,
      message: error.message,
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = buildPrismaKnownRequestError(error);
    return res.status(prismaError.statusCode).json({
      status: "error",
      statusCode: prismaError.statusCode,
      message: prismaError.message,
    });
  }

  if (development) {
    return handleDevelopmentError(error, req, res, next);
  } else {
    return handleProductionError(error, req, res, next);
  }
};

const buildPrismaKnownRequestError = (
  error: Prisma.PrismaClientKnownRequestError,
): { statusCode: number; message: string } => {
  if (error.code === "P2003") {
    const fieldName = String(error.meta?.field_name || "");
    const isRequisitionEventConstraint =
      fieldName.includes("request_event_id_fkey") ||
      fieldName.includes("request_event_type_id_fkey") ||
      fieldName.includes("event_id") ||
      fieldName.includes("event_type_id");

    if (isRequisitionEventConstraint) {
      return {
        statusCode: StatusCodes.BAD_REQUEST,
        message:
          "The selected event is not valid for this requisition. Please refresh the page, choose an event from the Event dropdown again, and save.",
      };
    }

    return {
      statusCode: StatusCodes.BAD_REQUEST,
      message:
        "One of the selected records no longer exists. Please refresh the page, review your selections, and try again.",
    };
  }

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
    message:
      "The request could not be saved because some submitted data is invalid. Please review the form and try again.",
  };
};

type ExpressHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any>;

/**
 * Wraps the given controllers with error handling using the given logger.
 *
 * @param {Record<string, ExpressHandler>} controllers - The controllers to be wrapped.
 * @param {Logger} logger - The logger to be used to log errors.
 * @returns {Record<string, ExpressHandler>} The wrapped controllers.
 */
export const wrapControllersWithLogger = (
  controllers: Record<string, ExpressHandler>,
  logger: Logger,
): Record<string, ExpressHandler> => {
  const wrappedControllers: Record<string, ExpressHandler> = {};
  for (const [key, controller] of Object.entries(controllers)) {
    wrappedControllers[key] = catchAsyncFunction(controller, logger);
  }
  return wrappedControllers;
};

/**
 * Handles errors in development mode.
 *
 * In development mode, the function returns the error message and stack trace
 * as JSON to the client. This is useful for debugging purposes.
 *
 * @param {Error} error - The error to be handled.
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function.
 */
export const handleDevelopmentError = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      status: "error",
      statusCode: error.statusCode,
      message: error.message,
      stack: error.stack, // Include stack trace in development
    });
  } else {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: "error",
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      message: "Something went wrong",
      stack: error.stack,
    });
  }
};

/**
 * Handles errors in production mode.
 *
 * In production mode, the function returns a JSON response with the HTTP
 * status code and a generic error message. This is useful for hiding internal
 * server errors from the client.
 *
 * @param {Error} error - The error to be handled.
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function.
 */
export const handleProductionError = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      status: "error",
      message: error.message,
    });
  } else {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: "error",
      message: "Something went wrong",
    });
  }
};
