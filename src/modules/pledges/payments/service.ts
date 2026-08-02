import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { isPaystackFailure } from "../../../libs/paystack/paystackClient";
import { computeDonorBorneFee } from "../../../libs/paystack/paystackFees";
import {
  initializeTransaction,
  verifyTransaction,
  type PaystackTransaction,
} from "../../../libs/paystack/paystackTransaction";
import { sendEmail } from "../../../utils/emailService";
import { pledgeReceiptTemplate } from "../../../utils/mail_templates/pledgeReceiptTemplate";
import logger from "../../../utils/logger-config";
import { PledgeHttpError } from "../common";
import type {
  InitializePledgePaymentPayload,
  PaymentClient,
  RetryPledgePaymentPayload,
} from "./validation";

/**
 * paystack_response holds the raw processor payload: useful for disputes,
 * useless to clients, so it never appears in an API response. Nor does
 * subaccount_code - processor plumbing with no payer-facing value.
 */
const PAYMENT_SELECT = {
  id: true,
  reference: true,
  pledge_id: true,
  pledger_id: true,
  pledge_title: true,
  payer_name: true,
  payer_email: true,
  user_id: true,
  amount: true,
  fee: true,
  amount_charged: true,
  amount_paid: true,
  fee_actual: true,
  currency: true,
  status: true,
  channel: true,
  paid_at: true,
  redemption_id: true,
  receipt_sent_at: true,
  branch_id: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Largest page size the payment list endpoints hand back, whatever was asked. */
const MAX_LIST_PAGE_SIZE = 200;

/**
 * Paystack also reports ongoing, pending, processing and queued. A mobile money
 * charge sits in `ongoing` while the payer completes the USSD prompt, which is
 * exactly the state someone returning from the browser is most likely to be in.
 * Writing `failed` there invites a second payment, so anything non-terminal is
 * left for the webhook to resolve.
 */
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "abandoned", "reversed"]);

/**
 * The statuses a payer may retry or delete their own attempt from: the charge
 * is resolved, no redemption was written, and there is nothing to unwind.
 *
 * "pending" is deliberately absent - a mobile money charge sits pending while
 * the customer completes a USSD prompt, so deleting one would drop the row a
 * later webhook needs and the money would land against a reference the app no
 * longer recognises. Pending rows are verified against Paystack first (see
 * resolveStatus) and only whatever that settles them to is acted on.
 */
const PAYER_ACTIONABLE_STATUSES = new Set(["failed", "abandoned"]);

/** Marks a redemption as having come from the online payment path. */
export const ONLINE_REDEMPTION_METHOD = "paystack";

const buildReference = (): string =>
  `WWM-PLEDGE-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;

/** The prefix the webhook dispatcher routes on. Keep in step with buildReference. */
export const PLEDGE_REFERENCE_PREFIX = "WWM-PLEDGE-";

const toFinanceError = (error: unknown, fallback: string): PledgeHttpError => {
  if (error instanceof PledgeHttpError) return error;
  if (isPaystackFailure(error)) {
    return new PledgeHttpError(error.statusCode, error.message);
  }
  return new PledgeHttpError(400, fallback);
};

const toDecimalNumber = (value: Prisma.Decimal | null | undefined): number =>
  value ? Number(value) : 0;

/** Major units to minor, rounded at the boundary so no pesewa is invented. */
const toMinorUnits = (majorUnits: number): number =>
  Math.round(majorUnits * 100);

/**
 * Only what a chargeback or reconciliation dispute needs. The full verify
 * response also carries payer PII, the church's settlement details, and a
 * reusable authorization code - none of which has dispute value.
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
 * Where Paystack sends the payer afterwards.
 *
 * Server-side and chosen from a fixed pair, because taking a redirect target
 * from the client would be an open redirect on a payment flow. The mobile page
 * is inert and deep-links back into the app; the web page verifies inline.
 */
const PLEDGE_CALLBACK_PATH = "/out/pledge-complete";
const PLEDGE_WEB_CALLBACK_PATH = "/member/pledges/complete";

const resolveCallbackUrl = (client: PaymentClient): string | undefined => {
  if (client === "mobile") {
    const configured = process.env.PAYSTACK_PLEDGE_CALLBACK_URL?.trim();
    if (configured) return configured;
  }

  const frontendUrl = process.env.Frontend_URL?.trim();

  if (!frontendUrl) {
    logger.warn(
      "[pledge] no callback URL configured (set PAYSTACK_PLEDGE_CALLBACK_URL or Frontend_URL); the payer will not be redirected back after paying",
    );
    return undefined;
  }

  return `${frontendUrl.replace(/\/+$/, "")}${
    client === "web" ? PLEDGE_WEB_CALLBACK_PATH : PLEDGE_CALLBACK_PATH
  }`;
};

/** The payer fields every payment start needs, already checked for an email. */
type Payer = {
  id: number;
  name: string;
  email: string;
};

type ReceiptRow = {
  id: string;
  reference: string;
  pledge_title: string;
  payer_name: string;
  payer_email: string;
  amount: number;
  fee: number;
  currency: string;
  channel: string | null;
  paid_at: Date | null;
  // Not awaited when written, so null here usually means SMTP has not finished
  // rather than that the receipt failed. sendReceipt's own log is authoritative.
  receipt_sent_at: Date | null;
};

const RECEIPT_ROW_SELECT = {
  id: true,
  reference: true,
  pledge_title: true,
  payer_name: true,
  payer_email: true,
  amount: true,
  fee: true,
  currency: true,
  channel: true,
  paid_at: true,
  receipt_sent_at: true,
} as const;

/**
 * A receipt that fails to send must never unwind a payment that succeeded, so
 * this swallows its errors. `receipt_sent_at` staying null is the signal that a
 * retry is owed, which only holds if it is stamped exclusively on real
 * delivery - and `sendEmail` resolves with `{ success: false }` rather than
 * throwing for most failures, so that flag has to be checked explicitly.
 */
const sendReceipt = async (
  payment: ReceiptRow,
  outstanding: number | null,
): Promise<void> => {
  if (payment.receipt_sent_at) return;

  let result: Awaited<ReturnType<typeof sendEmail>>;

  try {
    result = await sendEmail(
      pledgeReceiptTemplate({
        payer_name: payment.payer_name,
        pledge_title: payment.pledge_title,
        amount_minor_units: payment.amount,
        fee_minor_units: payment.fee,
        currency: payment.currency,
        reference: payment.reference,
        channel: payment.channel,
        paid_at: payment.paid_at,
        outstanding,
      }),
      payment.payer_email,
      "Your pledge redemption receipt",
    );
  } catch (error) {
    logger.error(
      `[pledge] receipt email threw for ${payment.reference}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { reference: payment.reference },
    );
    return;
  }

  if (!result.success) {
    // The reason is interpolated into the message, not left in metadata: this
    // repo's winston console transport renders only { level, message,
    // timestamp }, so a metadata-only cause is silently dropped.
    logger.error(
      `[pledge] receipt email rejected for ${payment.reference}: ${result.error}`,
      { reference: payment.reference },
    );
    return;
  }

  try {
    await prisma.pledge_payment.update({
      where: { id: payment.id },
      data: { receipt_sent_at: new Date() },
    });
  } catch (error) {
    // The email genuinely went out; only the stamp failed. Treating that as a
    // send failure would leave receipt_sent_at null claiming a retry is owed.
    logger.error(
      `[pledge] receipt for ${payment.reference} was sent but receipt_sent_at failed to save`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
};

/** What is still owed on a pledger's pledge, in major units. */
const outstandingForPledger = async (
  pledgerId: number,
): Promise<number | null> => {
  const pledger = await prisma.pledger.findUnique({
    where: { id: pledgerId },
    select: { pledged_amount: true, redemptions: { select: { amount: true } } },
  });

  if (!pledger) return null;

  const redeemed = pledger.redemptions.reduce(
    (sum, row) => sum + toDecimalNumber(row.amount),
    0,
  );

  return Math.max(toDecimalNumber(pledger.pledged_amount) - redeemed, 0);
};

/**
 * The single settlement path for pledge payments. Both the webhook and the
 * on-demand verify call this, and it is safe to call any number of times for
 * the same reference.
 */
export const settlePledgePayment = async (
  transaction: PaystackTransaction,
): Promise<void> => {
  const reference = transaction?.reference;
  if (!reference) return;

  const payment = await prisma.pledge_payment.findUnique({
    where: { reference },
  });

  // Unknown reference: acknowledge and move on. An error would make Paystack
  // retry forever for a payment we will never recognise.
  if (!payment) {
    logger.warn(`[pledge] settlement for unknown reference ${reference}`);
    return;
  }

  // Cheap pre-check. It does NOT close the race between a webhook and a verify
  // call arriving together - the conditional update below is what does that.
  if (payment.status === "success") return;

  const paystackStatus = String(transaction.status || "").toLowerCase();

  if (paystackStatus !== "success") {
    if (!TERMINAL_FAILURE_STATUSES.has(paystackStatus)) {
      // ongoing/pending/processing/queued - not resolved yet. Leave it pending.
      return;
    }

    // Conditional for the same reason as the success write: Paystack lets a
    // payer retry a failed attempt on the same reference, so failed -> success
    // is a real transition, and a slow stale "failed" must not walk a collected
    // payment back in a financial table.
    await prisma.pledge_payment.updateMany({
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

  // The payer is charged the redemption PLUS the fee they cover, so what
  // Paystack collected must be compared against amount_charged.
  const expectedCharge = payment.amount_charged ?? payment.amount;

  if (amountPaid === null) {
    logger.error(
      `[pledge] could not parse collected amount for ${reference}: expected charge ${expectedCharge}, collected ${transaction.amount}`,
      { reference, expected: expectedCharge, collected: transaction.amount },
    );
  } else if (amountPaid !== expectedCharge) {
    logger.error(
      `[pledge] amount mismatch on ${reference}: expected charge ${expectedCharge}, collected ${amountPaid}`,
      { reference, expected: expectedCharge, collected: amountPaid },
    );
  }

  const reportedFee = Number(transaction.fees);
  const feeActual = Number.isInteger(reportedFee) ? reportedFee : null;

  if (feeActual !== null && feeActual !== payment.fee) {
    logger.error(
      `[pledge] fee schedule drift on ${reference}: grossed up by ${payment.fee}, Paystack charged ${feeActual}. Check PAYSTACK_FEE_PERCENT / _CAP_MINOR_UNITS / _FLAT_MINOR_UNITS`,
      { reference, assumed: payment.fee, actual: feeActual },
    );
  }

  const parsedPaidAt = transaction.paid_at ? new Date(transaction.paid_at) : null;
  // An invalid or absent paid_at stays null rather than being fabricated as
  // "now": an invented settlement timestamp buckets a delayed webhook into the
  // wrong reporting period, which is worse than an absent one.
  const paidAt =
    parsedPaidAt && !Number.isNaN(parsedPaidAt.getTime()) ? parsedPaidAt : null;

  // A single conditional update, not read-check-write: MySQL row-locks for the
  // duration of the UPDATE, so exactly one of a racing webhook and verify call
  // can flip status here. The loser matches zero rows and does nothing further,
  // so the redemption is written once and the receipt sent once.
  const claimed = await prisma.pledge_payment.updateMany({
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
    // Someone else settled it first. No second write, no second redemption,
    // and no second receipt.
    return;
  }

  await creditRedemption(reference);

  const updated = await prisma.pledge_payment.findUnique({
    where: { reference },
    select: RECEIPT_ROW_SELECT,
  });

  if (!updated) return;

  const outstanding = payment.pledger_id
    ? await outstandingForPledger(payment.pledger_id)
    : null;

  // Deliberately not awaited: this runs inside the webhook's acknowledgement
  // path and Paystack retries a slow 200, so a slow SMTP send here would
  // manufacture the very race the conditional update just resolved.
  void sendReceipt(updated, outstanding);
};

/**
 * Turns a settled payment into a ledger entry against the pledger.
 *
 * Separate from the status flip above so the money is recorded as collected
 * even if this fails - the payment row is authoritative about the charge, and
 * `redemption_id` staying null is the signal that the ledger entry is owed.
 */
const creditRedemption = async (reference: string): Promise<void> => {
  const payment = await prisma.pledge_payment.findUnique({
    where: { reference },
    select: {
      id: true,
      amount: true,
      pledger_id: true,
      redemption_id: true,
      paid_at: true,
      channel: true,
      user_id: true,
    },
  });

  if (!payment || payment.redemption_id) return;

  if (!payment.pledger_id) {
    logger.error(
      `[pledge] ${reference} settled but its pledger no longer exists, so no redemption was recorded`,
      { reference },
    );
    return;
  }

  try {
    const redemption = await prisma.pledge_redemption.create({
      data: {
        pledger_id: payment.pledger_id,
        // Minor units back to the Decimal(15,2) the ledger stores.
        amount: new Prisma.Decimal(payment.amount).dividedBy(100),
        date: payment.paid_at ?? new Date(),
        method: ONLINE_REDEMPTION_METHOD,
        note: `Online payment ${reference}${
          payment.channel ? ` via ${payment.channel}` : ""
        }`,
        recorded_by_user_id: payment.user_id ?? null,
      },
      select: { id: true },
    });

    // redemption_id is UNIQUE, so if a racing settle got here first this update
    // fails rather than crediting the pledger twice.
    await prisma.pledge_payment.update({
      where: { id: payment.id },
      data: { redemption_id: redemption.id },
    });
  } catch (error) {
    logger.error(
      `[pledge] ${reference} settled but the redemption could not be recorded: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { reference },
    );
  }
};

export class PledgePaymentService {
  /**
   * What a payment will actually cost, without creating anything. Computed
   * server-side so a client copy of the fee formula cannot drift from the
   * configured rate and quote one figure while the card is charged another.
   */
  previewFee(amountMinorUnits: number) {
    const fee = computeDonorBorneFee(amountMinorUnits);

    return {
      amount: amountMinorUnits,
      fee,
      amount_charged: amountMinorUnits + fee,
    };
  }

  /** Every pledge the caller is personally a pledger on. */
  async listMine(userId: number | undefined) {
    if (!userId) throw new PledgeHttpError(401, "Not authorized");

    const rows = await prisma.pledger.findMany({
      where: { user_id: userId },
      include: {
        redemptions: true,
        group: {
          include: {
            // event_mgt holds no title of its own - the human name lives on the
            // event_act it points at, hence the second hop.
            pledge: { include: { event: { include: { event: true } } } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    return rows.map((row) => {
      const pledge = row.group.pledge;
      const pledged = toDecimalNumber(row.pledged_amount);
      const redeemed = row.redemptions.reduce(
        (sum, redemption) => sum + toDecimalNumber(redemption.amount),
        0,
      );
      const remaining = Math.max(pledged - redeemed, 0);

      return {
        pledger_id: row.id,
        pledge_id: pledge.id,
        title: pledge.title,
        event_name: pledge.event?.event?.event_name ?? null,
        deadline: pledge.deadline,
        currency: pledge.currency,
        group_label: row.group.label,
        pledged_amount: pledged,
        redeemed,
        remaining,
        percent: pledged > 0 ? Math.round((redeemed / pledged) * 100) : 0,
        status: pledged > 0 && redeemed >= pledged ? "completed" : "in_progress",
        // The single flag the clients gate their Pay button on.
        can_be_paid_online:
          Boolean(pledge.subaccount_code) &&
          pledge.paystack_synced_at !== null &&
          remaining > 0,
        redemptions: row.redemptions.map((redemption) => ({
          id: redemption.id,
          amount: toDecimalNumber(redemption.amount),
          date: redemption.date,
          method: redemption.method,
          note: redemption.note,
        })),
      };
    });
  }

  /**
   * The payer, with the email a receipt needs already guaranteed. Shared by
   * every member-facing entry point so the 401/404/422 wording cannot drift.
   */
  private async loadPayer(userId: number | undefined): Promise<Payer> {
    if (!userId) throw new PledgeHttpError(401, "Not authorized");

    const payer = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!payer) throw new PledgeHttpError(404, "User not found");

    if (!payer.email) {
      throw new PledgeHttpError(
        422,
        "Add an email address to your profile before paying a pledge",
      );
    }

    return { id: payer.id, name: payer.name, email: payer.email };
  }

  async initialize(
    userId: number | undefined,
    payload: InitializePledgePaymentPayload,
  ) {
    const payer = await this.loadPayer(userId);

    return this.startPayment(
      payer,
      payload.pledger_id,
      payload.amount,
      payload.client,
    );
  }

  /**
   * A fresh attempt at an existing one, for a payer whose payment did not go
   * through. A NEW reference is minted rather than reusing the old one:
   * Paystack requires references to be unique per initialization, and keeping
   * each attempt as its own row is what lets the failed one still be produced
   * in a dispute. The pledge and the amount are read off the original row, so a
   * retry cannot become a payment against a different pledge.
   *
   * The outstanding balance is re-checked by startPayment, so a retry of an
   * amount that has since been redeemed another way is refused with the real
   * balance rather than overpaying the pledge.
   */
  async retry(userId: number | undefined, payload: RetryPledgePaymentPayload) {
    const payer = await this.loadPayer(userId);
    const existing = await this.loadOwnPayment(payer.id, payload.reference);
    const status = await this.resolveStatus(existing);

    if (status === "success") {
      throw new PledgeHttpError(
        409,
        "This payment already went through. Check your payment history.",
      );
    }

    if (!PAYER_ACTIONABLE_STATUSES.has(status)) {
      throw new PledgeHttpError(
        409,
        "This payment is still being processed. Please wait a moment before trying again.",
      );
    }

    // pledger_id is SetNull, so replacing a pledge's groups detaches old
    // payments from the pledger they were made for. There is nothing left to
    // credit a retry to, so it cannot be restarted from here.
    if (!existing.pledger_id) {
      throw new PledgeHttpError(
        409,
        "This pledge has changed since that attempt. Start the payment again from your pledges.",
      );
    }

    return this.startPayment(
      payer,
      existing.pledger_id,
      existing.amount,
      payload.client,
    );
  }

  /**
   * Removes a payer's own attempt that never collected money.
   *
   * A hard delete, not a soft one: the row records an attempt, not a receipt,
   * it produced no redemption, and nothing downstream counts a non-success row.
   * A successful payment can never be deleted here, and a pending one is
   * verified against Paystack first - so the only rows that can go are ones
   * Paystack itself has already called dead.
   */
  async deleteOwn(userId: number | undefined, reference: string) {
    const payer = await this.loadPayer(userId);
    const existing = await this.loadOwnPayment(payer.id, reference);
    const status = await this.resolveStatus(existing);

    if (status === "success") {
      throw new PledgeHttpError(
        409,
        "A completed payment cannot be deleted. Contact the church office if this is wrong.",
      );
    }

    if (!PAYER_ACTIONABLE_STATUSES.has(status)) {
      throw new PledgeHttpError(
        409,
        "This payment is still being processed and cannot be removed yet. Please try again shortly.",
      );
    }

    // Conditional on both status AND redemption_id, not a plain delete by id: a
    // webhook could settle this row between resolveStatus reading it and this
    // statement running, and deleting a settled payment would erase a collected
    // redemption. count 0 means exactly that happened.
    const removed = await prisma.pledge_payment.deleteMany({
      where: {
        reference,
        user_id: payer.id,
        status: { not: "success" },
        redemption_id: null,
      },
    });

    if (removed.count === 0) {
      throw new PledgeHttpError(
        409,
        "This payment completed while you were removing it. Check your payment history.",
      );
    }

    return { reference };
  }

  /** The caller's own attempt, or a 404 that does not reveal whose it is. */
  private async loadOwnPayment(userId: number, reference: string) {
    const existing = await prisma.pledge_payment.findUnique({
      where: { reference },
      select: {
        id: true,
        reference: true,
        user_id: true,
        branch_id: true,
        status: true,
        amount: true,
        pledger_id: true,
      },
    });

    // Same 404 for "no such reference" and "not yours", so this cannot be used
    // to probe which references exist.
    if (!existing || existing.user_id !== userId) {
      throw new PledgeHttpError(404, "Payment not found");
    }

    return existing;
  }

  /**
   * The status to act on, having given Paystack the last word on a pending row.
   *
   * A pending row may be a live mobile money charge or a checkout the payer
   * closed half an hour ago. Asking Paystack settles it through the same
   * idempotent path as the webhook. If that call fails, "pending" is returned
   * unchanged - which makes the caller refuse the action, the safe direction
   * when we cannot tell whether money moved.
   */
  private async resolveStatus(existing: {
    reference: string;
    branch_id: number | null;
    status: string;
  }): Promise<string> {
    if (existing.status !== "pending") return existing.status;

    try {
      const transaction = await verifyTransaction(
        existing.reference,
        existing.branch_id,
      );
      await settlePledgePayment(transaction);
    } catch (error) {
      logger.warn(
        `[pledge] could not verify ${existing.reference} before a payer action: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { reference: existing.reference },
      );
      return "pending";
    }

    const settled = await prisma.pledge_payment.findUnique({
      where: { reference: existing.reference },
      select: { status: true },
    });

    return settled?.status ?? "pending";
  }

  /**
   * Creates the attempt row and hands it to Paystack. Shared by initialize and
   * retry so the balance cap, the fee gross-up, the callback URL and the drift
   * marking cannot drift apart between the two entry points.
   */
  private async startPayment(
    payer: Payer,
    pledgerId: number,
    amount: number,
    client: PaymentClient,
  ) {
    const pledger = await prisma.pledger.findUnique({
      where: { id: pledgerId },
      include: {
        redemptions: { select: { amount: true } },
        group: { include: { pledge: true } },
      },
    });

    // Same 404 for "no such pledger" and "not yours", so this cannot be used to
    // probe which pledger ids exist.
    if (!pledger || pledger.user_id !== payer.id) {
      throw new PledgeHttpError(404, "Pledge not found");
    }

    const pledge = pledger.group.pledge;

    if (!pledge.subaccount_code || pledge.paystack_synced_at === null) {
      throw new PledgeHttpError(
        409,
        "This pledge cannot take online payments yet. Please contact the church office",
      );
    }

    const redeemed = pledger.redemptions.reduce(
      (sum, row) => sum + toDecimalNumber(row.amount),
      0,
    );
    const remainingMinorUnits = toMinorUnits(
      Math.max(toDecimalNumber(pledger.pledged_amount) - redeemed, 0),
    );

    if (remainingMinorUnits <= 0) {
      throw new PledgeHttpError(409, "This pledge has already been fully redeemed");
    }

    // Capping at the outstanding balance rather than accepting anything: an
    // overpayment on a pledge has no meaning in the ledger, and refunding one
    // is manual work for the finance team.
    if (amount > remainingMinorUnits) {
      throw new PledgeHttpError(
        422,
        `The outstanding balance on this pledge is ${pledge.currency} ${(
          remainingMinorUnits / 100
        ).toFixed(2)}`,
      );
    }

    const reference = buildReference();

    // The payer covers the Paystack fee, so the pledge's subaccount receives
    // the whole redemption. `amount` is the redemption; the card is charged the
    // sum.
    const fee = computeDonorBorneFee(amount);
    const amountCharged = amount + fee;

    const payment = await prisma.pledge_payment.create({
      data: {
        reference,
        pledge_id: pledge.id,
        pledger_id: pledger.id,
        pledge_title: pledge.title ?? `Pledge #${pledge.id}`,
        payer_name: payer.name,
        payer_email: payer.email,
        subaccount_code: pledge.subaccount_code,
        user_id: payer.id,
        amount,
        fee,
        amount_charged: amountCharged,
        currency: pledge.currency,
        status: "pending",
        branch_id: pledge.branch_id,
      },
      select: PAYMENT_SELECT,
    });

    const callbackUrl = resolveCallbackUrl(client);

    try {
      const result = await initializeTransaction(
        {
          email: payer.email,
          amount: amountCharged,
          currency: pledge.currency,
          reference,
          subaccount: pledge.subaccount_code,
          // The fee is routed to the main account as a flat charge and the main
          // account named as bearer, so it receives exactly the fee and
          // immediately pays it out, netting zero, while the subaccount keeps
          // the whole redemption. Naming the subaccount as bearer is rejected
          // by Paystack ("Invalid split transaction values").
          ...(fee > 0 && { transaction_charge: fee }),
          bearer: "account",
          ...(callbackUrl && { callback_url: callbackUrl }),
          metadata: {
            pledge_id: pledge.id,
            pledger_id: pledger.id,
            pledge_title: pledge.title,
            user_id: payer.id,
            redemption_minor_units: amount,
            fee_minor_units: fee,
          },
        },
        pledge.branch_id,
      );

      return {
        checkoutUrl: result.authorization_url,
        reference,
        payment,
      };
    } catch (error) {
      // Best effort: if this fails too, the caller must still see the original
      // Paystack error rather than a generic failure from this update.
      await prisma.pledge_payment
        .update({ where: { id: payment.id }, data: { status: "failed" } })
        .catch(() => undefined);

      await this.markDriftedIfSubaccountRejected(pledge.id, pledge.title, error);

      throw toFinanceError(error, "Unable to start this payment");
    }
  }

  /**
   * Paystack rejecting the subaccount means this pledge cannot receive money at
   * all - most often because the secret key now belongs to a different Paystack
   * account than the one the subaccount was created under, which a key rotation
   * does silently. Clearing paystack_synced_at withholds the pledge from the
   * pay flow and surfaces it as drifted, where re-saving mints a fresh one.
   */
  private async markDriftedIfSubaccountRejected(
    pledgeId: number,
    pledgeTitle: string | null,
    error: unknown,
  ): Promise<void> {
    const message = isPaystackFailure(error) ? error.message : "";

    if (!/subaccount/i.test(message)) return;

    logger.error(
      `[pledge] Paystack rejected the subaccount for "${
        pledgeTitle ?? `Pledge #${pledgeId}`
      }" (${message}). Withholding it from payers until it is re-synced`,
      { pledge_id: pledgeId, message },
    );

    await prisma.pledge
      .update({ where: { id: pledgeId }, data: { paystack_synced_at: null } })
      .catch(() => undefined);
  }

  /** On-demand settle, for the moment the payer returns from the browser. */
  async verify(userId: number | undefined, reference: string) {
    if (!userId) throw new PledgeHttpError(401, "Not authorized");

    const existing = await prisma.pledge_payment.findUnique({
      where: { reference },
      select: { id: true, user_id: true, branch_id: true, status: true },
    });

    if (!existing || existing.user_id !== userId) {
      throw new PledgeHttpError(404, "Payment not found");
    }

    // Already settled: return it without spending a Paystack API call. Paystack
    // rate-limits per integration, and a flaky client polling this must not
    // degrade initialization for everyone else.
    if (existing.status === "success") {
      return prisma.pledge_payment.findUnique({
        where: { reference },
        select: PAYMENT_SELECT,
      });
    }

    try {
      const transaction = await verifyTransaction(reference, existing.branch_id);
      await settlePledgePayment(transaction);
    } catch (error) {
      throw toFinanceError(error, "Unable to verify this payment");
    }

    return prisma.pledge_payment.findUnique({
      where: { reference },
      select: PAYMENT_SELECT,
    });
  }

  async listMyPayments(
    userId: number | undefined,
    pagination: { page: number; take: number },
  ) {
    if (!userId) throw new PledgeHttpError(401, "Not authorized");

    const take = Math.min(pagination.take, MAX_LIST_PAGE_SIZE);
    // skip is recomputed from the CLAMPED take: reusing a skip derived from an
    // unclamped one would silently drop every row between page 1 and the offset.
    const skip = (pagination.page - 1) * take;
    const where = { user_id: userId };

    const [data, total] = await Promise.all([
      prisma.pledge_payment.findMany({
        where,
        select: PAYMENT_SELECT,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.pledge_payment.count({ where }),
    ]);

    return { data, total };
  }

  /** Every payment against one pledge, for the finance team. */
  async listForPledge(
    pledgeId: number,
    pagination: { page: number; take: number },
  ) {
    const take = Math.min(pagination.take, MAX_LIST_PAGE_SIZE);
    const skip = (pagination.page - 1) * take;
    const where = { pledge_id: pledgeId };

    const [data, total] = await Promise.all([
      prisma.pledge_payment.findMany({
        where,
        select: PAYMENT_SELECT,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.pledge_payment.count({ where }),
    ]);

    return { data, total };
  }
}
