/**
 * messagingDispatchCron.ts
 *
 * Every minute: promote due scheduled messages, then send one batch of the
 * outbox. Uses the worker's runExclusive with the post-enqueue nudge so
 * the two never overlap in this process; per-row claims cover other workers.
 */
import cron from "node-cron";
import { promoteDueDispatches } from "../modules/messaging/messagingService";
import { consumeRerunRequest, processPendingRecipients, runExclusive } from "../modules/messaging/worker";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

const MESSAGING_DISPATCH_CRON = process.env.MESSAGING_DISPATCH_CRON || "* * * * *";

export async function processMessagingDispatchJob() {
  try {
    let passes = 0;
    do {
      const ran = await runExclusive(async () => {
        await promoteDueDispatches();
        await processPendingRecipients();
      });
      if (!ran) return;
      passes += 1;
    } while (consumeRerunRequest() && passes < 5);
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Messaging dispatch job", normalizedError);
      return;
    }
    console.error("[ERROR] Messaging dispatch job failed:", normalizedError);
  }
}

if (!cron.validate(MESSAGING_DISPATCH_CRON)) {
  console.error(`[ERROR] Messaging dispatch job disabled: invalid MESSAGING_DISPATCH_CRON "${MESSAGING_DISPATCH_CRON}".`);
} else {
  cron.schedule(MESSAGING_DISPATCH_CRON, () => {
    void processMessagingDispatchJob();
  });
}
