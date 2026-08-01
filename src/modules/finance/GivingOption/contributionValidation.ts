import { FinanceHttpError } from "../common";

/** GHS 1.00. Paystack rejects trivially small amounts and so do we. */
export const MINIMUM_CONTRIBUTION_MINOR_UNITS = 100;

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

  const amount = Number(payload.amount);

  // Integer minor units only. Accepting a decimal here is how you end up
  // charging 10.999999 pesewas.
  if (!Number.isInteger(amount)) {
    throw new FinanceHttpError(
      422,
      "amount is required and must be an integer in minor units (pesewas)",
    );
  }

  if (amount < MINIMUM_CONTRIBUTION_MINOR_UNITS) {
    throw new FinanceHttpError(422, "The minimum contribution is GHS 1.00");
  }

  return {
    giving_option_id: payload.giving_option_id.trim(),
    amount,
  };
};

export type ContributionListFilters = {
  branch_id?: number;
  giving_option_id?: string;
  status?: string;
  from?: Date;
  to?: Date;
};

const VALID_STATUSES = ["pending", "success", "failed", "abandoned"];

export const parseContributionFilters = (
  query: Record<string, unknown>,
): ContributionListFilters => {
  const filters: ContributionListFilters = {};

  if (query.branch_id !== undefined && query.branch_id !== "") {
    const branchId = Number(query.branch_id);
    if (!Number.isInteger(branchId) || branchId < 1) {
      throw new FinanceHttpError(422, "branch_id must be a positive integer");
    }
    filters.branch_id = branchId;
  }

  if (typeof query.giving_option_id === "string" && query.giving_option_id.trim()) {
    filters.giving_option_id = query.giving_option_id.trim();
  }

  if (typeof query.status === "string" && query.status.trim()) {
    const status = query.status.trim().toLowerCase();
    if (!VALID_STATUSES.includes(status)) {
      throw new FinanceHttpError(
        422,
        `status must be one of: ${VALID_STATUSES.join(", ")}`,
      );
    }
    filters.status = status;
  }

  if (typeof query.from === "string" && query.from.trim()) {
    const from = new Date(query.from.trim());
    if (Number.isNaN(from.getTime())) {
      throw new FinanceHttpError(422, "from must be a valid date");
    }
    filters.from = from;
  }

  if (typeof query.to === "string" && query.to.trim()) {
    const to = new Date(query.to.trim());
    if (Number.isNaN(to.getTime())) {
      throw new FinanceHttpError(422, "to must be a valid date");
    }
    filters.to = to;
  }

  return filters;
};
