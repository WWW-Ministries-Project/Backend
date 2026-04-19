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

export type FinancialPayload = Prisma.JsonObject & {
  metaData: Prisma.JsonObject & {
    periodDate: string;
  };
};

export type FinanceSaveAction = "SAVE_DRAFT" | "SAVE_AND_APPROVE";

export type FinancialMutationPayload = {
  action: FinanceSaveAction;
  payload: FinancialPayload;
};

export type FinanceApprovalConfigPayload = {
  finance_approver_user_id: number;
  notification_user_ids: number[];
  is_active?: boolean;
};

export type FinanceApprovalStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED";

const isPositiveInteger = (value: unknown): value is number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
};

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

  const payload = body as Record<string, unknown>;
  const metaData = payload.metaData;

  if (typeof metaData !== "object" || metaData === null || Array.isArray(metaData)) {
    throw new FinanceHttpError(
      422,
      "metaData is required and must be a JSON object",
    );
  }

  const periodDate = (metaData as { periodDate?: unknown }).periodDate;

  if (!isNonEmptyString(periodDate)) {
    throw new FinanceHttpError(
      422,
      "metaData.periodDate is required and must be a non-empty string",
    );
  }

  const trimmedPeriodDate = periodDate.trim();
  const periodDateRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

  if (!periodDateRegex.test(trimmedPeriodDate)) {
    throw new FinanceHttpError(
      422,
      "metaData.periodDate must be in YYYY-MM format",
    );
  }

  return {
    ...(payload as Prisma.JsonObject),
    metaData: {
      ...(metaData as Prisma.JsonObject),
      periodDate: trimmedPeriodDate,
    },
  } as FinancialPayload;
};

export const validateFinancialMutationPayload = (
  body: unknown,
): FinancialMutationPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(
      422,
      "Invalid request payload. Expected a JSON object",
    );
  }

  const source = body as Record<string, unknown>;
  const actionRaw = String(source.action || "").trim().toUpperCase();
  if (actionRaw !== "SAVE_DRAFT" && actionRaw !== "SAVE_AND_APPROVE") {
    throw new FinanceHttpError(
      422,
      "action is required and must be SAVE_DRAFT or SAVE_AND_APPROVE",
    );
  }

  const payloadSource = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "action"),
  );

  return {
    action: actionRaw,
    payload: validateFinancialPayload(payloadSource),
  };
};

export const validateFinanceApprovalConfigPayload = (
  body: unknown,
): FinanceApprovalConfigPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(422, "Invalid request payload");
  }

  const payload = body as {
    finance_approver_user_id?: unknown;
    notification_user_ids?: unknown;
    is_active?: unknown;
  };

  if (!isPositiveInteger(payload.finance_approver_user_id)) {
    throw new FinanceHttpError(
      422,
      "finance_approver_user_id is required and must be a positive integer",
    );
  }

  const notificationUserIds = Array.isArray(payload.notification_user_ids)
    ? Array.from(
        new Set(
          payload.notification_user_ids
            .map((value) => Number(value))
            .filter((value) => isPositiveInteger(value)),
        ),
      )
    : [];

  if (
    Array.isArray(payload.notification_user_ids) &&
    notificationUserIds.length !== payload.notification_user_ids.length
  ) {
    throw new FinanceHttpError(
      422,
      "notification_user_ids must contain only positive integer user IDs",
    );
  }

  return {
    finance_approver_user_id: Number(payload.finance_approver_user_id),
    notification_user_ids: notificationUserIds,
    is_active:
      payload.is_active === undefined ? true : Boolean(payload.is_active),
  };
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
      const target = error.meta?.target;
      const targetText = Array.isArray(target)
        ? target.join(",")
        : String(target ?? "");

      if (targetText.includes("periodDate")) {
        return new FinanceHttpError(
          409,
          "A financial record already exists for this period date",
        );
      }

      if (targetText.includes("name")) {
        return new FinanceHttpError(409, "A config with this name already exists");
      }

      return new FinanceHttpError(409, "A record with this value already exists");
    }

    if (error.code === "P2025") {
      return new FinanceHttpError(404, "Record not found");
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
