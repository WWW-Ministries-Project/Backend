import { Response } from "express";
import { Prisma } from "@prisma/client";
import { isPaystackFailure } from "../../libs/paystack/paystackClient";

export class PledgeHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PledgeHttpError";
  }
}

const asNumber = (v: unknown, field: string): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (v === undefined || v === null || Number.isNaN(n)) {
    throw new PledgeHttpError(400, `${field} must be a valid number`);
  }
  return n;
};

interface PledgerInput {
  user_id?: number | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  pledged_amount?: number | string;
}
interface GroupInput {
  id?: number;
  called_amount: number | string;
  label?: string | null;
  pledgers?: PledgerInput[];
}
interface CallerInput {
  user_id?: number | null;
  guest_name?: string | null;
  guest_phone?: string | null;
}

const validatePerson = (p: PledgerInput | CallerInput, ctx: string) => {
  const hasMember = p.user_id !== undefined && p.user_id !== null;
  const hasGuest = !!p.guest_name;
  if (!hasMember && !hasGuest) {
    throw new PledgeHttpError(400, `${ctx}: each person needs user_id or guest_name`);
  }
  if (hasGuest && !("guest_phone" in p && p.guest_phone)) {
    throw new PledgeHttpError(400, `${ctx}: guest requires guest_phone`);
  }
};

export const ACCOUNT_TYPES = ["ghipss", "mobile_money"] as const;
export type PledgeAccountType = (typeof ACCOUNT_TYPES)[number];

export interface PledgeSettlementAccount {
  currency: string;
  account_type: PledgeAccountType;
  settlement_bank: string;
  bank_name: string;
  account_number: string;
  account_name: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * The settlement account a pledge's online redemptions are routed to.
 *
 * Required on create - a pledge without one cannot be paid online, which is the
 * whole point of giving it a subaccount. On update it is optional, because a
 * meta-only edit (title, deadline, callers) must not force the caller to resend
 * bank details, and because pledges predating this feature have none.
 */
export const validateSettlementAccount = (
  body: any,
  opts: { required: boolean },
): PledgeSettlementAccount | undefined => {
  const provided =
    nonEmpty(body?.settlement_bank) ||
    nonEmpty(body?.account_number) ||
    nonEmpty(body?.account_name) ||
    nonEmpty(body?.bank_name);

  if (!provided) {
    if (opts.required) {
      throw new PledgeHttpError(
        400,
        "Settlement account details are required so payments to this pledge can be routed",
      );
    }
    return undefined;
  }

  const accountType = nonEmpty(body?.account_type)
    ? body.account_type.trim()
    : "ghipss";

  if (!ACCOUNT_TYPES.includes(accountType as PledgeAccountType)) {
    throw new PledgeHttpError(
      400,
      `account_type must be one of: ${ACCOUNT_TYPES.join(", ")}`,
    );
  }

  for (const field of [
    "settlement_bank",
    "bank_name",
    "account_number",
    "account_name",
  ] as const) {
    if (!nonEmpty(body?.[field])) {
      throw new PledgeHttpError(400, `${field} is required`);
    }
  }

  const accountNumber = body.account_number.trim();

  if (!/^[0-9]{5,20}$/.test(accountNumber)) {
    throw new PledgeHttpError(400, "account_number must be 5 to 20 digits");
  }

  return {
    currency: nonEmpty(body?.currency) ? body.currency.trim().toUpperCase() : "GHS",
    account_type: accountType as PledgeAccountType,
    settlement_bank: body.settlement_bank.trim(),
    bank_name: body.bank_name.trim(),
    account_number: accountNumber,
    account_name: body.account_name.trim(),
  };
};

export const validatePledgeMutationPayload = (
  body: any,
  opts: { requireGroups?: boolean } = { requireGroups: true },
) => {
  if (!body || typeof body !== "object") throw new PledgeHttpError(400, "Invalid payload");
  if (body.event_id === undefined || body.event_id === null) {
    throw new PledgeHttpError(400, "event_id is required");
  }
  const groups: GroupInput[] = Array.isArray(body.groups) ? body.groups : [];
  if (opts.requireGroups !== false && groups.length === 0) {
    throw new PledgeHttpError(400, "At least one group is required");
  }
  groups.forEach((g, gi) => {
    asNumber(g.called_amount, `groups[${gi}].called_amount`);
    (g.pledgers ?? []).forEach((p, pi) => {
      validatePerson(p, `groups[${gi}].pledgers[${pi}]`);
      if (p.pledged_amount !== undefined) {
        asNumber(p.pledged_amount, `groups[${gi}].pledgers[${pi}].pledged_amount`);
      }
    });
  });
  (body.callers ?? []).forEach((c: CallerInput, ci: number) =>
    validatePerson(c, `callers[${ci}]`),
  );
  return body;
};

export const validateRedemptionPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new PledgeHttpError(400, "Invalid payload");
  asNumber(body.pledger_id, "pledger_id");
  asNumber(body.amount, "amount");
  if (!body.date) throw new PledgeHttpError(400, "date is required");
  if (!body.method) throw new PledgeHttpError(400, "method is required");
  return body;
};

export const resolvePledgeError = (
  error: unknown,
): { status: number; message: string } => {
  if (error instanceof PledgeHttpError) return { status: error.status, message: error.message };
  // Paystack failures keep their own status codes and message, as in giving:
  // "Paystack rejected the settlement account" is actionable, a bare 500 is not.
  if (isPaystackFailure(error)) return { status: error.statusCode, message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return { status: 404, message: "Record not found" };
    if (error.code === "P2003") return { status: 400, message: "Related record does not exist" };
    if (error.code === "P2002") {
      return { status: 409, message: "A record with this value already exists" };
    }
  }
  return { status: 500, message: "Something went wrong processing the pledge" };
};

export const sendPledgeError = (res: Response, error: unknown) => {
  const { status, message } = resolvePledgeError(error);
  return res.status(status).json({ message });
};
