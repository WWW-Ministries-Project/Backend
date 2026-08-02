import { randomUUID } from "crypto";
import { prisma } from "../../../Models/context";
import { isPaystackFailure } from "../../../libs/paystack/paystackClient";
import { computeDonorBorneFee } from "../../../libs/paystack/paystackFees";
import {
  initializeTransaction,
  verifyTransaction,
  type PaystackTransaction,
} from "../../../libs/paystack/paystackTransaction";
import { sendEmail } from "../../../utils/emailService";
import { givingReceiptTemplate } from "../../../utils/mail_templates/givingReceiptTemplate";
import logger from "../../../utils/logger-config";
import { FinanceHttpError, PaginationQuery } from "../common";
import type {
  ContributionListFilters,
  InitializeContributionPayload,
} from "./contributionValidation";

/**
 * paystack_response holds the raw processor payload. It is useful for disputes
 * and useless to clients, so it never appears in an API response. Nor does
 * subaccount_code: it is processor plumbing with no donor-facing value.
 */
const CONTRIBUTION_SELECT = {
  id: true,
  reference: true,
  giving_option_id: true,
  giving_option_name: true,
  user_id: true,
  donor_name: true,
  donor_email: true,
  amount: true,
  fee: true,
  amount_charged: true,
  amount_paid: true,
  fee_actual: true,
  currency: true,
  status: true,
  channel: true,
  paid_at: true,
  receipt_sent_at: true,
  branch_id: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Largest page size the contribution list endpoints will hand back regardless
 * of what was requested. `parsePagination` (shared, not owned by this file)
 * accepts any positive integer for `take`, so without a local clamp
 * `?take=1000000` becomes `LIMIT 1000000` against a financial table.
 */
const MAX_LIST_PAGE_SIZE = 200;

/**
 * Clamps `take` and recomputes `skip` from the clamped value rather than
 * trusting `parsePagination`'s. `skip` there is `(page - 1) * take` using the
 * UNCLAMPED take, so reusing it verbatim alongside a clamped take would make
 * `?page=2&take=1000` skip straight to row 1000 while returning only 200 -
 * silently losing every row between what page 1 returned and that offset.
 */
const clampPagination = (
  pagination: PaginationQuery,
): { skip: number; take: number } => {
  const take = Math.min(pagination.take, MAX_LIST_PAGE_SIZE);
  return { skip: (pagination.page - 1) * take, take };
};

/**
 * Paystack also reports ongoing, pending, processing and queued. A mobile money
 * charge sits in `ongoing` while the customer completes the USSD prompt, which
 * is precisely the state a donor returning from the browser is most likely to
 * be in. Writing `failed` there tells them their payment failed and invites a
 * second one, so anything non-terminal is left for the webhook to resolve.
 */
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "abandoned", "reversed"]);

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
 * Only what a chargeback or reconciliation dispute actually needs. The full
 * verify response also carries customer PII, the church's own settlement bank
 * details, and authorization.authorization_code - a reusable charge token.
 * None of that has dispute value, so none of it is stored.
 */
const toStorablePayload = (transaction: PaystackTransaction): string =>
  JSON.stringify({
    id: transaction.id,
    status: transaction.status,
    reference: transaction.reference,
    amount: transaction.amount,
    currency: transaction.currency,
    channel: transaction.channel,
    paid_at: transaction.paid_at,
    gateway_response: transaction.gateway_response,
  });

/**
 * The URL Paystack redirects the donor to after payment.
 *
 * Deliberately server-side: taking a redirect target from the client would be
 * an open redirect on a payment flow.
 *
 * This must NOT point at the marketplace's "verify-payment/:type" page. That
 * page reads the reference from `order_reference` (Paystack sends `reference`
 * and `trxref`), verifies against the orders endpoint, and clears the member's
 * shopping cart - so a donation showed "Missing payment reference" and silently
 * emptied their basket. Giving has its own inert landing page.
 */
const GIVING_CALLBACK_PATH = "/out/giving-complete";

/**
 * Where a donor giving from the web dashboard lands instead. The mobile page
 * above is inert by design - it deep-links back into the app - so sending a
 * browser there strands the donor on a page telling them to open an app they
 * may not have. This one verifies the reference and shows the outcome inline.
 */
const GIVING_WEB_CALLBACK_PATH = "/member/giving/complete";

export type PaymentClient = "web" | "mobile";

/**
 * The origin the web landing page lives on. PAYSTACK_GIVING_CALLBACK_URL is
 * honoured verbatim for the mobile path (it may point somewhere bespoke), so
 * only its origin is reusable here.
 */
const resolveFrontendOrigin = (): string | undefined => {
  const configured = process.env.PAYSTACK_GIVING_CALLBACK_URL?.trim();

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Not an absolute URL - fall through to Frontend_URL.
    }
  }

  const frontendUrl = process.env.Frontend_URL?.trim();
  return frontendUrl ? frontendUrl.replace(/\/+$/, "") : undefined;
};

/**
 * The URL Paystack redirects the donor to after payment.
 *
 * Deliberately server-side, and chosen from a fixed pair by an enum the client
 * sends: taking a redirect target from the client would be an open redirect on
 * a payment flow.
 */
export const resolveCallbackUrl = (
  client: PaymentClient = "mobile",
): string | undefined => {
  if (client === "mobile") {
    const configured = process.env.PAYSTACK_GIVING_CALLBACK_URL?.trim();
    if (configured) return configured;
  }

  const origin = resolveFrontendOrigin();

  if (!origin) {
    logger.warn(
      "[giving] no callback URL configured (set PAYSTACK_GIVING_CALLBACK_URL or Frontend_URL); the donor will not be redirected back after paying",
    );
    return undefined;
  }

  return `${origin}${
    client === "web" ? GIVING_WEB_CALLBACK_PATH : GIVING_CALLBACK_PATH
  }`;
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
  fee: number;
  amount_charged: number | null;
  amount_paid: number | null;
  currency: string;
  status: string;
  channel: string | null;
  paid_at: Date | null;
  // Deliberately not awaited when it is written (see settleContribution), so a
  // null here does not mean the receipt failed - it usually just means SMTP
  // has not finished sending yet. Only sendReceipt's own error log is
  // authoritative about an actual failure.
  receipt_sent_at: Date | null;
};

/** Exactly the fields ContributionRow declares - nothing more, notably not the LongText paystack_response. */
const RECEIPT_ROW_SELECT = {
  id: true,
  reference: true,
  giving_option_name: true,
  donor_name: true,
  donor_email: true,
  amount: true,
  fee: true,
  amount_charged: true,
  amount_paid: true,
  fee_actual: true,
  currency: true,
  status: true,
  channel: true,
  paid_at: true,
  receipt_sent_at: true,
} as const;

/**
 * A receipt that fails to send must never unwind a payment that succeeded, so
 * this swallows its errors. receipt_sent_at staying null is the signal that a
 * retry is owed - which only holds if it is stamped exclusively on genuine
 * delivery. `sendEmail` does not throw on most failures (missing SMTP config,
 * a rejected send); it resolves with `{ success: false }` instead, so that
 * flag has to be checked explicitly. The try/catch remains as a backstop for
 * anything that does throw.
 */
const sendReceipt = async (contribution: ContributionRow): Promise<void> => {
  if (contribution.receipt_sent_at) {
    return;
  }

  let result: Awaited<ReturnType<typeof sendEmail>>;

  try {
    result = await sendEmail(
      givingReceiptTemplate({
        donor_name: contribution.donor_name,
        giving_option_name: contribution.giving_option_name,
        // The donation, not what was charged: `amount` is what reaches the fund,
        // and the fee the donor covered is itemised separately below it.
        amount_minor_units: contribution.amount,
        fee_minor_units: contribution.fee,
        currency: contribution.currency,
        reference: contribution.reference,
        channel: contribution.channel,
        paid_at: contribution.paid_at,
      }),
      contribution.donor_email,
      "Your giving receipt",
    );
  } catch (error) {
    // sendEmail does not normally throw (it resolves with { success: false }
    // instead), but this is a backstop in case something does.
    logger.error(
      `[giving] receipt email threw for ${contribution.reference}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { reference: contribution.reference },
    );
    return;
  }

  if (!result.success) {
    logger.error(
      // The reason is interpolated, not left in metadata: this repo's winston
      // console transport renders only { level, message, timestamp }, so a
      // metadata-only error is dropped and the log says a receipt failed
      // without ever saying why - which is what happened when an SMTP quota
      // was exhausted and the cause had to be reproduced by hand.
      `[giving] receipt email rejected for ${contribution.reference}: ${result.error}`,
      { reference: contribution.reference },
    );
    return;
  }

  try {
    await prisma.givingContribution.update({
      where: { id: contribution.id },
      data: { receipt_sent_at: new Date() },
    });
  } catch (error) {
    // The email genuinely went out - only the stamp failed to save. Logging
    // this the same as a send failure would leave receipt_sent_at null
    // claiming a retry is owed for a receipt the donor already has, and
    // whatever consumes that signal (e.g. a reconciliation sweep) would then
    // send a duplicate.
    logger.error(
      `[giving] receipt for ${contribution.reference} was sent but receipt_sent_at failed to save`,
      { error: error instanceof Error ? error.message : String(error) },
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
    logger.warn(`[giving] settlement for unknown reference ${reference}`);
    return;
  }

  // Cheap pre-check: skips the write in the common case, but it does NOT close
  // the race between a webhook and a verify call landing at the same moment -
  // both can read this before either has written. The conditional update
  // below, not this check, is what makes only one of them win.
  if (contribution.status === "success") {
    return;
  }

  const paystackStatus = String(transaction.status || "").toLowerCase();

  if (paystackStatus !== "success") {
    if (!TERMINAL_FAILURE_STATUSES.has(paystackStatus)) {
      // ongoing/pending/processing/queued/... - not resolved yet. Leave the
      // row as pending for the webhook or a later verify call to settle.
      return;
    }

    // Conditional, exactly like the success write below: Paystack lets a
    // donor retry a failed attempt on the same reference, so failed -> success
    // is a real transition. Without the status predicate, a slow, stale
    // "failed" response could land after a webhook has already settled and
    // receipted the retry, walking a collected payment back to "failed" in a
    // financial table - and reopening the door to a duplicate receipt, since
    // a later webhook retry would then pass the success pre-check again.
    // count is intentionally unread beyond this: whether it is 0 (the row was
    // already "success", so a stale failure correctly did not overwrite it)
    // or 1 (the failure was recorded), there is nothing further to do here.
    await prisma.givingContribution.updateMany({
      where: { reference, status: { not: "success" } },
      data: {
        status: paystackStatus === "abandoned" ? "abandoned" : "failed",
        paystack_response: toStorablePayload(transaction),
      },
    });

    return;
  }

  const collected = Number(transaction.amount);
  const amountPaid = Number.isInteger(collected) ? collected : null;

  // The donor is charged the donation PLUS the fee they are covering, so what
  // Paystack collected must be compared against amount_charged, not against
  // `amount` (which is the donation the subaccount receives). Rows created
  // before the gross-up have no amount_charged, so fall back to `amount`.
  const expectedCharge = contribution.amount_charged ?? contribution.amount;

  if (amountPaid === null) {
    // The documented reconciliation query never matches NULL in MySQL - so a
    // row landing here would be invisible to the query meant to find exactly
    // this kind of problem. The identifying values are interpolated into the
    // message itself (not left in the metadata object) because this repo's
    // winston console transport (src/utils/logger-config.ts) formats only
    // { level, message, timestamp } - a metadata-only field is silently
    // dropped, which would make this, the most safety-critical log in the
    // file, less actionable than the console.warn it replaced.
    logger.error(
      `[giving] could not parse collected amount for ${reference}: expected charge ${expectedCharge}, collected ${transaction.amount}`,
      { reference, expected: expectedCharge, collected: transaction.amount },
    );
  } else if (amountPaid !== expectedCharge) {
    logger.error(
      `[giving] amount mismatch on ${reference}: expected charge ${expectedCharge}, collected ${amountPaid}`,
      { reference, expected: expectedCharge, collected: amountPaid },
    );
  }

  // What Paystack actually took in fees. If it differs from what we grossed the
  // charge up by, the configured fee schedule no longer matches Paystack's real
  // one - which means every donation since is off by that difference, and the
  // subaccount is receiving slightly less (or more) than the donor chose.
  const reportedFee = Number(transaction.fees);
  const feeActual = Number.isInteger(reportedFee) ? reportedFee : null;

  if (feeActual !== null && feeActual !== contribution.fee) {
    logger.error(
      `[giving] fee schedule drift on ${reference}: grossed up by ${contribution.fee}, Paystack charged ${feeActual}. Check PAYSTACK_FEE_PERCENT / _CAP_MINOR_UNITS / _FLAT_MINOR_UNITS`,
      { reference, assumed: contribution.fee, actual: feeActual },
    );
  }

  const parsedPaidAt = transaction.paid_at ? new Date(transaction.paid_at) : null;
  // An invalid or absent paid_at is left null rather than fabricated as "now":
  // an invented settlement timestamp would bucket a delayed webhook into the
  // wrong reporting period, which is worse than an absent one.
  const paidAt =
    parsedPaidAt && !Number.isNaN(parsedPaidAt.getTime()) ? parsedPaidAt : null;

  // A single conditional update, not read-check-write: MySQL row-locks for the
  // duration of the UPDATE, so exactly one of a racing webhook and verify call
  // can flip status away from "success" here. The loser's updateMany matches
  // zero rows, so it never builds a ContributionRow and can neither re-write
  // the row nor re-send the receipt.
  const claimed = await prisma.givingContribution.updateMany({
    where: { reference, status: { not: "success" } },
    data: {
      status: "success",
      amount_paid: amountPaid,
      fee_actual: feeActual,
      channel: transaction.channel ?? null,
      paid_at: paidAt,
      paystack_response: toStorablePayload(transaction),
    },
  });

  if (claimed.count === 0) {
    // Someone else settled it first. No second write, and no second receipt.
    return;
  }

  const updated = await prisma.givingContribution.findUnique({
    where: { reference },
    select: RECEIPT_ROW_SELECT,
  });

  if (!updated) {
    return;
  }

  // Deliberately not awaited: this runs inside the webhook's acknowledgement
  // path, and Paystack retries if the 200 is slow - a slow SMTP send here
  // would manufacture the very race this function just resolved. sendReceipt
  // owns its own errors, so nothing here needs to observe how it finishes.
  void sendReceipt(updated);
};

export class GivingContributionService {
  /** Options this member may give to right now. */
  /**
   * What a given donation will actually cost the donor, without creating
   * anything. The app shows this breakdown before the member commits, so they
   * are never surprised by a charge larger than the amount they typed.
   *
   * Deliberately server-side rather than letting the client re-implement the
   * fee formula: a client-side copy would drift the moment the configured rate
   * changed, and the donor would be quoted one figure and charged another.
   */
  previewFee(donationMinorUnits: number) {
    const fee = computeDonorBorneFee(donationMinorUnits);

    return {
      amount: donationMinorUnits,
      fee,
      amount_charged: donationMinorUnits + fee,
    };
  }

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

    // The donor covers the Paystack fee, so the subaccount receives the whole
    // donation. `payload.amount` is the donation; the card is charged the sum.
    const fee = computeDonorBorneFee(payload.amount);
    const amountCharged = payload.amount + fee;

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
        fee,
        amount_charged: amountCharged,
        currency: option.currency,
        status: "pending",
        branch_id: option.branch_id,
      },
      select: CONTRIBUTION_SELECT,
    });

    const callbackUrl = resolveCallbackUrl(payload.client);

    try {
      const result = await initializeTransaction(
        {
          email: donor.email,
          amount: amountCharged,
          currency: option.currency,
          reference,
          subaccount: option.subaccount_code,
          // The fee is routed to the main account as a flat charge, and the
          // main account is named as bearer - so it receives exactly the fee
          // and immediately pays it out, netting zero, while the subaccount
          // keeps the full donation. Naming the subaccount as bearer instead is
          // rejected by Paystack ("Invalid split transaction values") because it
          // cannot both take the whole amount and pay the fee from it.
          ...(fee > 0 && { transaction_charge: fee }),
          bearer: "account",
          ...(callbackUrl && { callback_url: callbackUrl }),
          metadata: {
            giving_option_id: option.id,
            giving_option_name: option.name,
            user_id: donor.id,
            donation_minor_units: payload.amount,
            fee_minor_units: fee,
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
      // Best effort: if this fails too, the original Paystack error above must
      // still be what the caller sees, not a generic failure from this update.
      await prisma.givingContribution
        .update({
          where: { id: contribution.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);

      await this.markDriftedIfSubaccountRejected(option.id, option.name, error);

      throw toFinanceError(error, "Unable to start this payment");
    }
  }

  /**
   * Paystack rejecting the subaccount means this option cannot receive money at
   * all - most often because the secret key now belongs to a different Paystack
   * account than the one the subaccount was created under, which a key rotation
   * does silently.
   *
   * `paystack_synced_at` otherwise records only that OUR last write succeeded,
   * not that the subaccount still exists, so a stale option keeps being offered
   * and every single donor hits the same failure. Clearing it withholds the
   * option from `/available` and surfaces it as drifted in the dashboard, where
   * re-saving it mints a fresh subaccount.
   */
  private async markDriftedIfSubaccountRejected(
    optionId: string,
    optionName: string,
    error: unknown,
  ): Promise<void> {
    const message = isPaystackFailure(error) ? error.message : "";

    if (!/subaccount/i.test(message)) {
      return;
    }

    logger.error(
      `[giving] Paystack rejected the subaccount for "${optionName}" (${message}). Withholding it from donors until it is re-synced`,
      { giving_option_id: optionId, message },
    );

    await prisma.givingOption
      .update({
        where: { id: optionId },
        data: { paystack_synced_at: null },
      })
      .catch(() => undefined);
  }

  /** On-demand settle, for the moment the donor returns from the browser. */
  async verify(userId: number | undefined, reference: string) {
    if (!userId) {
      throw new FinanceHttpError(401, "Not authorized");
    }

    const existing = await prisma.givingContribution.findUnique({
      where: { reference },
      select: { id: true, user_id: true, branch_id: true, status: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Contribution not found");
    }

    // A member may only verify their own payment.
    if (existing.user_id !== userId) {
      throw new FinanceHttpError(404, "Contribution not found");
    }

    // Already settled: return it without spending a Paystack API call. Paystack
    // rate-limits per integration, and a donor (or a flaky client) calling this
    // repeatedly must not degrade initialization for every other donor.
    if (existing.status === "success") {
      return prisma.givingContribution.findUnique({
        where: { reference },
        select: CONTRIBUTION_SELECT,
      });
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

  /**
   * Giving-only settlement from a webhook payload.
   *
   * The mounted webhook route no longer calls this - it goes through
   * `handlePaystackChargeEvent`, which dispatches by reference prefix so pledge
   * payments settle on the same signed endpoint. Kept because it is the giving
   * half of that dispatch expressed on its own terms.
   */
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
    const { skip, take } = clampPagination(pagination);

    const [data, total] = await Promise.all([
      prisma.givingContribution.findMany({
        where,
        select: CONTRIBUTION_SELECT,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.givingContribution.count({ where }),
    ]);

    return { data, total };
  }

  async listAll(pagination: PaginationQuery, filters: ContributionListFilters) {
    const { skip, take } = clampPagination(pagination);

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
        skip,
        take,
      }),
      prisma.givingContribution.count({ where }),
    ]);

    return { data, total };
  }
}
