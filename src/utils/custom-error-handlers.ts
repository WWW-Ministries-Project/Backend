import { StatusCodes } from "http-status-codes";

export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;

    this.name = this.constructor.name;

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

// Input Validation Error
export class InputValidationError extends AppError {
  constructor(message = "Validation Error") {
    super(message, StatusCodes.BAD_REQUEST);
  }
}

// Not Found Error
export class NotFoundError extends AppError {
  constructor(message = "Resource Not Found") {
    super(message, StatusCodes.NOT_FOUND);
  }
}

// Resource Duplication Error
export class ResourceDuplicationError extends AppError {
  constructor(message = "Resource Already Exists") {
    super(message, StatusCodes.CONFLICT);
  }
}

// Internal Server Error
export class InternalServerError extends AppError {
  constructor(message = "Something went wrong") {
    super(message, StatusCodes.INTERNAL_SERVER_ERROR);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "You so not have permission to access to access this resource") {
    super(message, StatusCodes.FORBIDDEN);
  }
}
