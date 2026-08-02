import cron from "node-cron";
import { prisma } from "../Models/context";
import { verifyTransaction } from "../libs/paystack/paystackTransaction";
import { settleContribution } from "../modules/finance/GivingOption/contributionService";
import { notificationService } from "../modules/notifications/notificationService";
import logger from "../utils/logger-config";

let isReconciling = false;

/**
 * A contribution created seconds ago is a donor still on the Paystack page.
 * Asking Paystack about it wastes rate-limit budget on a payment that is
 * simply in progress, so only rows older than this are eligible.
 */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** Cap per run so a large backlog cannot turn one sweep into a Paystack flood. */
const BATCH_SIZE = 100;

export async function reconcilePendingGivingContributionsJob() {
  if (isReconciling) {
    return;
  }

  // Nothing can be verified without the secret key, and this must not spam
  // admin notifications on an environment where Paystack giving isn't set up.
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return;
  }

  isReconciling = true;

  try {
    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS);

    const pendingRows = await prisma.givingContribution.findMany({
      where: {
        status: "pending",
        createdAt: { lt: staleBefore },
      },
      select: { reference: true, branch_id: true },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });

    let checked = 0;
    let settled = 0;
    let errored = 0;

    // Sequential, not Promise.all: Paystack rate-limits per integration, and a
    // burst of concurrent verifies would risk throttling the live
    // /initialize calls that donors are waiting on right now.
    for (const row of pendingRows) {
      checked += 1;
      try {
        const transaction = await verifyTransaction(row.reference, row.branch_id);
        await settleContribution(transaction);

        // settleContribution returns void, so "settled" is measured by
        // re-reading the row: anything no longer pending after a successful
        // verify+settle round trip counts as settled by this sweep.
        const updated = await prisma.givingContribution.findUnique({
          where: { reference: row.reference },
          select: { status: true },
        });
        if (updated && updated.status !== "pending") {
          settled += 1;
        }
      } catch (error) {
        // One row's failure must not abort the batch - a single reference
        // Paystack no longer recognises should not prevent the rest from
        // reconciling.
        errored += 1;
        logger.error("[giving] reconciliation failed for reference", {
          reference: row.reference,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Giving contribution reconciliation summary", {
      checked,
      settled,
      errored,
    });
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error.message : String(error);
    logger.error(
      "[ERROR] Giving payment reconciliation failed:",
      normalizedError,
    );
    await notificationService.notifyAdminsJobFailed({
      jobName: "giving-payment-reconciliation",
      errorMessage: normalizedError,
      actionUrl: "/home/dashboard",
      dedupeKey: `job:giving-reconciliation:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isReconciling = false;
  }
}

// Runs every 30 minutes rather than daily like the Hubtel sweep: the gap this
// job closes involves money Paystack has already collected into the church's
// subaccount, so a stranded row should not sit unresolved for a full day.
cron.schedule("*/30 * * * *", async () => {
  await reconcilePendingGivingContributionsJob();
});
