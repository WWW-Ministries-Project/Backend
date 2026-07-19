import { Response } from "express";
import { Prisma } from "@prisma/client";

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
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return { status: 404, message: "Record not found" };
    if (error.code === "P2003") return { status: 400, message: "Related record does not exist" };
  }
  return { status: 500, message: "Something went wrong processing the pledge" };
};

export const sendPledgeError = (res: Response, error: unknown) => {
  const { status, message } = resolvePledgeError(error);
  return res.status(status).json({ message });
};
