import { FinanceHttpError } from "../common";

/** GHS 1.00. Paystack rejects trivially small amounts and so do we. */
export const MINIMUM_CONTRIBUTION_MINOR_UNITS = 100;

/**
 * The MySQL INT ceiling on givingContribution.amount - GHS 21,474,836.47. This
 * is a hard bound set by the column, not a business rule. If a lower business
 * cap is ever wanted, lower this constant; it must never be raised above the
 * column's range.
 */
export const MAXIMUM_CONTRIBUTION_MINOR_UNITS = 2_147_483_647;

export type InitializeContributionPayload = {
  giving_option_id: string;
  /** Minor units (pesewas) */
  amount: number;
};

export const validateInitializePayload = (
  body: unknown,
): InitializeContributionPayload => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FinanceHttpError(422, "Invalid request payload");
  }

  const payload = body as { giving_option_id?: unknown; amount?: unknown };

  if (
    typeof payload.giving_option_id !== "string" ||
    payload.giving_option_id.trim().length === 0
  ) {
    throw new FinanceHttpError(
      422,
      "giving_option_id is required and must be a non-empty string",
    );
  }

  if (
    payload.amount === undefined ||
    payload.amount === null ||
    payload.amount === ""
  ) {
    throw new FinanceHttpError(422, "amount is required");
  }

  if (typeof payload.amount !== "number" || !Number.isInteger(payload.amount)) {
    throw new FinanceHttpError(
      422,
      "amount must be an integer in minor units (pesewas)",
    );
  }

  const amount = payload.amount;

  if (amount < MINIMUM_CONTRIBUTION_MINOR_UNITS) {
    throw new FinanceHttpError(422, "The minimum contribution is GHS 1.00");
  }

  if (amount > MAXIMUM_CONTRIBUTION_MINOR_UNITS) {
    throw new FinanceHttpError(422, "The maximum contribution is GHS 21,474,836.47");
  }

  return {
    giving_option_id: payload.giving_option_id.trim(),
    amount,
  };
};

export const CONTRIBUTION_STATUSES = [
  "pending",
  "success",
  "failed",
  "abandoned",
] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export type ContributionListFilters = {
  branch_id?: number;
  giving_option_id?: string;
  status?: ContributionStatus;
  from?: Date;
  to?: Date;
};

export const parseContributionFilters = (
  query: Record<string, unknown>,
): ContributionListFilters => {
  const filters: ContributionListFilters = {};

  if (query.branch_id !== undefined && query.branch_id !== "") {
    // Query values arrive as strings, so branch_id is coerced rather than
    // required to be a number - but it must still be a scalar. Express parses
    // ?branch_id[]=1 into an array, and Number(["1"]) is 1, so without this
    // guard an array would be silently accepted where every sibling filter
    // rejects one.
    if (typeof query.branch_id !== "string" && typeof query.branch_id !== "number") {
      throw new FinanceHttpError(
        422,
        "branch_id must be a single value when provided",
      );
    }

    const branchId = Number(query.branch_id);
    if (!Number.isInteger(branchId) || branchId < 1) {
      throw new FinanceHttpError(422, "branch_id must be a positive integer");
    }
    filters.branch_id = branchId;
  }

  if (query.giving_option_id !== undefined && query.giving_option_id !== "") {
    if (typeof query.giving_option_id !== "string") {
      throw new FinanceHttpError(
        422,
        "giving_option_id must be a string when provided",
      );
    }
    const trimmed = query.giving_option_id.trim();
    if (trimmed) {
      filters.giving_option_id = trimmed;
    }
  }

  if (query.status !== undefined && query.status !== "") {
    if (typeof query.status !== "string") {
      throw new FinanceHttpError(422, "status must be a string when provided");
    }
    const status = query.status.trim().toLowerCase();
    if (status) {
      if (!CONTRIBUTION_STATUSES.includes(status as ContributionStatus)) {
        throw new FinanceHttpError(
          422,
          `status must be one of: ${CONTRIBUTION_STATUSES.join(", ")}`,
        );
      }
      filters.status = status as ContributionStatus;
    }
  }

  if (query.from !== undefined && query.from !== "") {
    if (typeof query.from !== "string") {
      throw new FinanceHttpError(422, "from must be a string when provided");
    }
    const fromStr = query.from.trim();
    if (fromStr) {
      let fromDate: Date;

      // Detect bare YYYY-MM-DD and set to start of day
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
        fromDate = new Date(`${fromStr}T00:00:00.000Z`);
      } else {
        fromDate = new Date(fromStr);
      }

      if (Number.isNaN(fromDate.getTime())) {
        throw new FinanceHttpError(422, "from must be a valid date");
      }
      filters.from = fromDate;
    }
  }

  if (query.to !== undefined && query.to !== "") {
    if (typeof query.to !== "string") {
      throw new FinanceHttpError(422, "to must be a string when provided");
    }
    const toStr = query.to.trim();
    if (toStr) {
      let toDate: Date;

      // Detect bare YYYY-MM-DD and extend to end of day
      if (/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
        toDate = new Date(`${toStr}T23:59:59.999Z`);
      } else {
        toDate = new Date(toStr);
      }

      if (Number.isNaN(toDate.getTime())) {
        throw new FinanceHttpError(422, "to must be a valid date");
      }
      filters.to = toDate;
    }
  }

  if (filters.from && filters.to && filters.from > filters.to) {
    throw new FinanceHttpError(422, "from must be on or before to");
  }

  return filters;
};

/**
 * The donation amount for a fee preview, taken from a query string rather than
 * a JSON body - so unlike `validateInitializePayload` a numeric string is the
 * expected form here, not a client bug.
 */
export const parsePreviewAmount = (raw: unknown): number => {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new FinanceHttpError(422, "amount is required");
  }

  const amount = Number(raw);

  if (!Number.isInteger(amount)) {
    throw new FinanceHttpError(
      422,
      "amount must be an integer in minor units (pesewas)",
    );
  }

  if (amount < MINIMUM_CONTRIBUTION_MINOR_UNITS) {
    throw new FinanceHttpError(422, "The minimum contribution is GHS 1.00");
  }

  if (amount > MAXIMUM_CONTRIBUTION_MINOR_UNITS) {
    throw new FinanceHttpError(
      422,
      "The maximum contribution is GHS 21,474,836.47",
    );
  }

  return amount;
};
