import { PledgeHttpError } from "../common";

/** GHS 1.00. Paystack rejects trivially small amounts and so do we. */
export const MINIMUM_PAYMENT_MINOR_UNITS = 100;

/**
 * The MySQL INT ceiling on pledge_payment.amount - GHS 21,474,836.47. A hard
 * bound set by the column, not a business rule.
 */
export const MAXIMUM_PAYMENT_MINOR_UNITS = 2_147_483_647;

export type PaymentClient = "web" | "mobile";

export type InitializePledgePaymentPayload = {
  pledger_id: number;
  /** Minor units (pesewas) */
  amount: number;
  /**
   * Which surface the payer is on. Picks between two server-known callback
   * paths only - never a URL, which would be an open redirect on a payment.
   */
  client: PaymentClient;
};

/**
 * Anything other than an explicit "web" is treated as mobile, so an older
 * client that does not send the field keeps working unchanged.
 */
export const parsePaymentClient = (raw: unknown): PaymentClient =>
  typeof raw === "string" && raw.trim().toLowerCase() === "web" ? "web" : "mobile";

const parseMinorUnits = (raw: unknown, field: string): number => {
  if (raw === undefined || raw === null || raw === "") {
    throw new PledgeHttpError(400, `${field} is required`);
  }

  const amount = Number(raw);

  if (!Number.isInteger(amount)) {
    throw new PledgeHttpError(
      400,
      `${field} must be an integer in minor units (pesewas)`,
    );
  }

  if (amount < MINIMUM_PAYMENT_MINOR_UNITS) {
    throw new PledgeHttpError(400, "The minimum payment is GHS 1.00");
  }

  if (amount > MAXIMUM_PAYMENT_MINOR_UNITS) {
    throw new PledgeHttpError(400, "The maximum payment is GHS 21,474,836.47");
  }

  return amount;
};

export const validateInitializePledgePayment = (
  body: unknown,
): InitializePledgePaymentPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PledgeHttpError(400, "Invalid request payload");
  }

  const payload = body as {
    pledger_id?: unknown;
    amount?: unknown;
    client?: unknown;
  };

  const pledgerId = Number(payload.pledger_id);

  if (!Number.isInteger(pledgerId) || pledgerId < 1) {
    throw new PledgeHttpError(400, "pledger_id must be a positive integer");
  }

  return {
    pledger_id: pledgerId,
    amount: parseMinorUnits(payload.amount, "amount"),
    client: parsePaymentClient(payload.client),
  };
};

/**
 * A retry names an existing attempt by its reference and nothing else. The
 * amount and the pledge are read off that row server-side rather than resent,
 * so "retry" cannot be used to pay a different amount against a different
 * pledge than the row it claims to be retrying.
 */
export type RetryPledgePaymentPayload = {
  reference: string;
  client: PaymentClient;
};

export const validateRetryPledgePayment = (
  body: unknown,
): RetryPledgePaymentPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PledgeHttpError(400, "Invalid request payload");
  }

  const payload = body as { reference?: unknown; client?: unknown };

  if (
    typeof payload.reference !== "string" ||
    payload.reference.trim().length === 0
  ) {
    throw new PledgeHttpError(400, "reference is required");
  }

  return {
    reference: payload.reference.trim(),
    client: parsePaymentClient(payload.client),
  };
};

/**
 * A reference taken from the query string, for DELETE - which has no body worth
 * relying on across HTTP clients. Rejects anything non-scalar: Express parses
 * `?reference[]=a` into an array, and `String(["a"])` would silently accept it.
 */
export const parseReferenceQuery = (raw: unknown): string => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new PledgeHttpError(400, "reference is required");
  }

  return raw.trim();
};

/**
 * The amount for a fee preview. Comes from a query string, so a numeric string
 * is the expected form here rather than a client bug.
 */
export const parsePreviewAmount = (raw: unknown): number => {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new PledgeHttpError(400, "amount is required");
  }

  return parseMinorUnits(raw, "amount");
};
