import { settleContribution } from "../../modules/finance/GivingOption/contributionService";
import {
  PLEDGE_REFERENCE_PREFIX,
  settlePledgePayment,
} from "../../modules/pledges/payments/service";
import type { PaystackTransaction } from "./paystackTransaction";

/**
 * One webhook, several kinds of payment.
 *
 * Paystack posts every charge.success to the single signed endpoint at
 * PAYSTACK_WEBHOOK_PATH, and index.ts retains the raw request body only for
 * that path - so a second receiver could not verify a signature even if one
 * were registered. Which settlement path an event belongs to is therefore
 * decided here, by the prefix on the reference we generated for it.
 *
 * Prefix, not "try both": each settler logs an unknown reference as a warning,
 * so fanning every event out to all of them would fill the log with false
 * alarms for payments that simply belong to another flow.
 */
export const handlePaystackChargeEvent = async (event: {
  event?: string;
  data?: PaystackTransaction;
}): Promise<void> => {
  // Only charge.success moves money. Other events are acknowledged and ignored.
  if (event?.event !== "charge.success" || !event.data) return;

  const reference = String(event.data.reference || "");

  if (reference.startsWith(PLEDGE_REFERENCE_PREFIX)) {
    await settlePledgePayment(event.data);
    return;
  }

  // Everything else falls to giving, which is where references without a
  // recognised prefix came from before pledge payments existed.
  await settleContribution(event.data);
};
