import { FinanceHttpError } from "../common";

export const GIVING_ACCOUNT_TYPES = ["ghipss", "mobile_money"] as const;

export type GivingAccountType = (typeof GIVING_ACCOUNT_TYPES)[number];

export type GivingOptionPayload = {
  name: string;
  description?: string;
  account_type: GivingAccountType;
  settlement_bank: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  currency: string;
  branch_id?: number;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isPositiveInteger = (value: unknown): boolean => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
};

const requireString = (value: unknown, field: string): string => {
  if (!isNonEmptyString(value)) {
    throw new FinanceHttpError(
      422,
      `${field} is required and must be a non-empty string`,
    );
  }

  return value.trim();
};

export const validateGivingOptionPayload = (
  body: unknown,
): GivingOptionPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(422, "Invalid request payload");
  }

  const payload = body as Record<string, unknown>;

  const name = requireString(payload.name, "name");
  const settlementBank = requireString(
    payload.settlement_bank,
    "settlement_bank",
  );
  const bankName = requireString(payload.bank_name, "bank_name");
  const accountNumber = requireString(payload.account_number, "account_number");
  const accountName = requireString(payload.account_name, "account_name");

  if (!/^[0-9]{5,20}$/.test(accountNumber)) {
    throw new FinanceHttpError(
      422,
      "account_number must be between 5 and 20 digits",
    );
  }

  const accountTypeRaw =
    payload.account_type === undefined
      ? "ghipss"
      : requireString(payload.account_type, "account_type");

  if (!GIVING_ACCOUNT_TYPES.includes(accountTypeRaw as GivingAccountType)) {
    throw new FinanceHttpError(
      422,
      `account_type must be one of ${GIVING_ACCOUNT_TYPES.join(", ")}`,
    );
  }

  if (
    payload.description !== undefined &&
    payload.description !== null &&
    !isNonEmptyString(payload.description)
  ) {
    throw new FinanceHttpError(
      422,
      "description must be a non-empty string when provided",
    );
  }

  const currency =
    payload.currency === undefined
      ? "GHS"
      : requireString(payload.currency, "currency").toUpperCase();

  let branchId: number | undefined;
  if (payload.branch_id !== undefined && payload.branch_id !== null) {
    if (!isPositiveInteger(payload.branch_id)) {
      throw new FinanceHttpError(
        422,
        "branch_id must be a positive integer when provided",
      );
    }

    branchId = Number(payload.branch_id);
  }

  return {
    name,
    ...(isNonEmptyString(payload.description) && {
      description: payload.description.trim(),
    }),
    account_type: accountTypeRaw as GivingAccountType,
    settlement_bank: settlementBank,
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
    currency,
    ...(branchId !== undefined && { branch_id: branchId }),
  };
};
