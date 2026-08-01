import { randomUUID } from "crypto";
import { prisma } from "../../../Models/context";
import { isPaystackFailure } from "../../../libs/paystack/paystackClient";
import {
  initializeTransaction,
  verifyTransaction,
  type PaystackTransaction,
} from "../../../libs/paystack/paystackTransaction";
import { sendEmail } from "../../../utils/emailService";
import { givingReceiptTemplate } from "../../../utils/mail_templates/givingReceiptTemplate";
import { FinanceHttpError, PaginationQuery } from "../common";
import type {
  ContributionListFilters,
  InitializeContributionPayload,
} from "./contributionValidation";

/**
 * paystack_response holds the raw processor payload. It is useful for disputes
 * and useless to clients, so it never appears in an API response.
 */
const CONTRIBUTION_SELECT = {
  id: true,
  reference: true,
  giving_option_id: true,
  giving_option_name: true,
  subaccount_code: true,
  user_id: true,
  donor_name: true,
  donor_email: true,
  amount: true,
  amount_paid: true,
  currency: true,
  status: true,
  channel: true,
  paid_at: true,
  receipt_sent_at: true,
  branch_id: true,
  createdAt: true,
  updatedAt: true,
} as const;

const buildReference = (): string =>
  `WWM-GIVE-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;

/** Paystack failures keep their own status codes, as in phase 1. */
const toFinanceError = (error: unknown, fallback: string): FinanceHttpError => {
  if (error instanceof FinanceHttpError) {
    return error;
  }

  if (isPaystackFailure(error)) {
    return new FinanceHttpError(error.statusCode, error.message);
  }

  return new FinanceHttpError(400, fallback);
};

/**
 * The URL Paystack redirects the donor to after payment.
 *
 * Deliberately server-side: taking a redirect target from the client would be
 * an open redirect on a payment flow. The default matches the hosted bounce
 * page the marketplace already uses (Frontend route "verify-payment/:type").
 */
const resolveCallbackUrl = (): string | undefined => {
  const configured = process.env.PAYSTACK_GIVING_CALLBACK_URL?.trim();
  if (configured) return configured;

  const frontendUrl = process.env.Frontend_URL?.trim();
  if (!frontendUrl) return undefined;

  return `${frontendUrl.replace(/\/+$/, "")}/out/verify-payment/mobile`;
};

/**
 * Options this member may give to: their own branch plus organisation-wide
 * funds. Built as an explicit array because `{ branch_id: undefined }` is not a
 * filter in Prisma - it matches everything, which would expose every branch's
 * options to a member with no branch.
 */
const branchVisibilityFilter = (branchId: number | null) =>
  branchId ? [{ branch_id: branchId }, { branch_id: null }] : [{ branch_id: null }];

type ContributionRow = {
  id: string;
  reference: string;
  giving_option_name: string;
  donor_name: string;
  donor_email: string;
  amount: number;
  amount_paid: number | null;
  currency: string;
  status: string;
  channel: string | null;
  paid_at: Date | null;
  receipt_sent_at: Date | null;
};

/**
 * A receipt that fails to send must never unwind a payment that succeeded, so
 * this swallows its errors. receipt_sent_at staying null is the signal that a
 * retry is owed.
 */
const sendReceipt = async (contribution: ContributionRow): Promise<void> => {
  if (contribution.receipt_sent_at) {
    return;
  }

  try {
    await sendEmail(
      givingReceiptTemplate({
        donor_name: contribution.donor_name,
        giving_option_name: contribution.giving_option_name,
        amount_minor_units: contribution.amount_paid ?? contribution.amount,
        currency: contribution.currency,
        reference: contribution.reference,
        channel: contribution.channel,
        paid_at: contribution.paid_at,
      }),
      contribution.donor_email,
      "Your giving receipt",
    );

    await prisma.givingContribution.update({
      where: { id: contribution.id },
      data: { receipt_sent_at: new Date() },
    });
  } catch (error) {
    console.error(
      `[giving] receipt email failed for ${contribution.reference}`,
      error,
    );
  }
};

/**
 * The single settlement path. Both the webhook and the on-demand verify call
 * this, and it is safe to call any number of times for the same reference.
 */
export const settleContribution = async (
  transaction: PaystackTransaction,
): Promise<void> => {
  const reference = transaction?.reference;

  if (!reference) {
    return;
  }

  const contribution = await prisma.givingContribution.findUnique({
    where: { reference },
  });

  // Unknown reference: acknowledge and move on. Returning an error would make
  // Paystack retry forever for a payment we will never recognise.
  if (!contribution) {
    console.warn(`[giving] settlement for unknown reference ${reference}`);
    return;
  }

  // Already settled. No second write, and no second receipt.
  if (contribution.status === "success") {
    return;
  }

  const paystackStatus = String(transaction.status || "").toLowerCase();

  if (paystackStatus !== "success") {
    await prisma.givingContribution.update({
      where: { id: contribution.id },
      data: {
        status: paystackStatus === "abandoned" ? "abandoned" : "failed",
        paystack_response: JSON.stringify(transaction),
      },
    });
    return;
  }

  const collected = Number(transaction.amount);
  const amountPaid = Number.isInteger(collected) ? collected : null;

  if (amountPaid !== null && amountPaid !== contribution.amount) {
    console.warn(
      `[giving] amount mismatch on ${reference}: quoted ${contribution.amount}, collected ${amountPaid}`,
    );
  }

  const updated = await prisma.givingContribution.update({
    where: { id: contribution.id },
    data: {
      status: "success",
      amount_paid: amountPaid,
      channel: transaction.channel ?? null,
      paid_at: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
      paystack_response: JSON.stringify(transaction),
    },
  });

  await sendReceipt(updated);
};

export class GivingContributionService {
  /** Options this member may give to right now. */
  async listAvailable(userId: number | undefined) {
    if (!userId) {
      throw new FinanceHttpError(401, "Not authorized");
    }

    const donor = await prisma.user.findUnique({
      where: { id: userId },
      select: { branch_id: true },
    });

    if (!donor) {
      throw new FinanceHttpError(404, "User not found");
    }

    // A drifted option (paystack_synced_at null) cannot reliably receive money,
    // so offering it would take a payment we cannot route.
    return prisma.givingOption.findMany({
      where: {
        archived_at: null,
        is_active: true,
        paystack_synced_at: { not: null },
        subaccount_code: { not: null },
        OR: branchVisibilityFilter(donor.branch_id),
      },
      select: {
        id: true,
        name: true,
        description: true,
        currency: true,
        branch_id: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async initialize(
    userId: number | undefined,
    payload: InitializeContributionPayload,
  ) {
    if (!userId) {
      throw new FinanceHttpError(401, "Not authorized");
    }

    const donor = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, branch_id: true },
    });

    if (!donor) {
      throw new FinanceHttpError(404, "User not found");
    }

    if (!donor.email) {
      throw new FinanceHttpError(
        422,
        "Add an email address to your profile before giving",
      );
    }

    // Re-check visibility here rather than trusting that the client only ever
    // shows what /available returned.
    const option = await prisma.givingOption.findFirst({
      where: {
        id: payload.giving_option_id,
        archived_at: null,
        is_active: true,
        paystack_synced_at: { not: null },
        OR: branchVisibilityFilter(donor.branch_id),
      },
    });

    if (!option || !option.subaccount_code) {
      throw new FinanceHttpError(404, "This giving option is not available");
    }

    const reference = buildReference();

    const contribution = await prisma.givingContribution.create({
      data: {
        reference,
        giving_option_id: option.id,
        giving_option_name: option.name,
        subaccount_code: option.subaccount_code,
        user_id: donor.id,
        donor_name: donor.name,
        donor_email: donor.email,
        amount: payload.amount,
        currency: option.currency,
        status: "pending",
        branch_id: option.branch_id,
      },
      select: CONTRIBUTION_SELECT,
    });

    const callbackUrl = resolveCallbackUrl();

    try {
      const result = await initializeTransaction(
        {
          email: donor.email,
          amount: payload.amount,
          currency: option.currency,
          reference,
          subaccount: option.subaccount_code,
          bearer: option.bearer,
          ...(callbackUrl && { callback_url: callbackUrl }),
          metadata: {
            giving_option_id: option.id,
            giving_option_name: option.name,
            user_id: donor.id,
          },
        },
        option.branch_id,
      );

      return {
        checkoutUrl: result.authorization_url,
        reference,
        contribution,
      };
    } catch (error) {
      await prisma.givingContribution.update({
        where: { id: contribution.id },
        data: { status: "failed" },
      });

      throw toFinanceError(error, "Unable to start this payment");
    }
  }

  /** On-demand settle, for the moment the donor returns from the browser. */
  async verify(userId: number | undefined, reference: string) {
    if (!userId) {
      throw new FinanceHttpError(401, "Not authorized");
    }

    const existing = await prisma.givingContribution.findUnique({
      where: { reference },
      select: { id: true, user_id: true, branch_id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Contribution not found");
    }

    // A member may only verify their own payment.
    if (existing.user_id !== userId) {
      throw new FinanceHttpError(404, "Contribution not found");
    }

    try {
      const transaction = await verifyTransaction(reference, existing.branch_id);
      await settleContribution(transaction);
    } catch (error) {
      throw toFinanceError(error, "Unable to verify this payment");
    }

    return prisma.givingContribution.findUnique({
      where: { reference },
      select: CONTRIBUTION_SELECT,
    });
  }

  async handleWebhook(event: { event?: string; data?: PaystackTransaction }) {
    // Only charge.success moves money. Other events are acknowledged and ignored.
    if (event?.event !== "charge.success" || !event.data) {
      return;
    }

    await settleContribution(event.data);
  }

  async listForUser(userId: number | undefined, pagination: PaginationQuery) {
    if (!userId) {
      throw new FinanceHttpError(401, "Not authorized");
    }

    const where = { user_id: userId };

    const [data, total] = await Promise.all([
      prisma.givingContribution.findMany({
        where,
        select: CONTRIBUTION_SELECT,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.givingContribution.count({ where }),
    ]);

    return { data, total };
  }

  async listAll(pagination: PaginationQuery, filters: ContributionListFilters) {
    const where = {
      ...(filters.branch_id !== undefined && { branch_id: filters.branch_id }),
      ...(filters.giving_option_id !== undefined && {
        giving_option_id: filters.giving_option_id,
      }),
      ...(filters.status !== undefined && { status: filters.status }),
      ...((filters.from || filters.to) && {
        createdAt: {
          ...(filters.from && { gte: filters.from }),
          ...(filters.to && { lte: filters.to }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      prisma.givingContribution.findMany({
        where,
        select: CONTRIBUTION_SELECT,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.givingContribution.count({ where }),
    ]);

    return { data, total };
  }
}
