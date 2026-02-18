import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

export class FinanceHttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

export type PaginationQuery = {
  page: number;
  take: number;
  skip: number;
};

export const parsePagination = (req: Request): PaginationQuery => {
  const rawPage = req.query.page ?? "1";
  const rawTake = req.query.take ?? "20";

  const page = Number(rawPage);
  const take = Number(rawTake);

  if (!Number.isInteger(page) || page < 1) {
    throw new FinanceHttpError(422, "Invalid page. It must be an integer >= 1");
  }

  if (!Number.isInteger(take) || take < 1) {
    throw new FinanceHttpError(422, "Invalid take. It must be an integer >= 1");
  }

  return {
    page,
    take,
    skip: (page - 1) * take,
  };
};

export const parseIdFromQuery = (req: Request): string => {
  const id = req.query.id;

  if (!isNonEmptyString(id)) {
    throw new FinanceHttpError(400, "Invalid id query parameter");
  }

  return id.trim();
};

export type BaseConfigPayload = {
  name: string;
  description?: string;
};

export type PercentageConfigPayload = BaseConfigPayload & {
  percentage?: number;
};

export type FinancialPayload = Prisma.JsonObject;

export const validateBasePayload = (
  body: unknown,
  options?: { percentageAllowed?: boolean },
): BaseConfigPayload | PercentageConfigPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(422, "Invalid request payload");
  }

  const payload = body as {
    name?: unknown;
    description?: unknown;
    percentage?: unknown;
  };

  if (!isNonEmptyString(payload.name)) {
    throw new FinanceHttpError(422, "name is required and must be a non-empty string");
  }

  if (
    payload.description !== undefined &&
    !isNonEmptyString(payload.description)
  ) {
    throw new FinanceHttpError(
      422,
      "description must be a non-empty string when provided",
    );
  }

  if (!options?.percentageAllowed) {
    return {
      name: payload.name.trim(),
      ...(payload.description !== undefined && {
        description: (payload.description as string).trim(),
      }),
    };
  }

  if (payload.percentage !== undefined) {
    const numericPercentage = Number(payload.percentage);

    if (!Number.isFinite(numericPercentage)) {
      throw new FinanceHttpError(422, "percentage must be numeric");
    }

    if (numericPercentage < 0 || numericPercentage > 100) {
      throw new FinanceHttpError(422, "percentage must be between 0 and 100");
    }

    return {
      name: payload.name.trim(),
      ...(payload.description !== undefined && {
        description: (payload.description as string).trim(),
      }),
      percentage: numericPercentage,
    };
  }

  return {
    name: payload.name.trim(),
    ...(payload.description !== undefined && {
      description: (payload.description as string).trim(),
    }),
  };
};

export const validateFinancialPayload = (body: unknown): FinancialPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(
      422,
      "Invalid request payload. Expected a JSON object",
    );
  }

  return body as Prisma.JsonObject;
};

export const resolveFinanceError = (
  error: unknown,
  fallbackMessage = "Something went wrong",
): FinanceHttpError => {
  if (error instanceof FinanceHttpError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new FinanceHttpError(409, "A config with this name already exists");
    }

    if (error.code === "P2025") {
      return new FinanceHttpError(404, "Config not found");
    }
  }

  return new FinanceHttpError(400, fallbackMessage);
};

export const sendFinanceError = (res: Response, error: unknown): Response => {
  const handledError = resolveFinanceError(error);

  return res.status(handledError.statusCode).json({
    message: handledError.message,
    data: null,
  });
};
