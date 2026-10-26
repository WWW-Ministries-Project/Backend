import cron from "node-cron";
import {
  isWebsubConfigured,
  subscribeToChannelFeed,
} from "../modules/sermons/youtubeIngest/websubSubscription";
import { notificationService } from "../modules/notifications/notificationService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isWebsubRenewalJobRunning = false;
// A WebSub lease lasts YOUTUBE_WEBSUB_LEASE_SECONDS (default 5 days); renewing
// every 2 days keeps the subscription alive with comfortable margin.
const YOUTUBE_WEBSUB_RENEWAL_CRON =
  process.env.YOUTUBE_WEBSUB_RENEWAL_CRON || "0 0 */2 * *";

export async function processWebsubRenewalJob() {
  if (isWebsubRenewalJobRunning) {
    return;
  }

  isWebsubRenewalJobRunning = true;

  try {
    await subscribeToChannelFeed("subscribe");
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("YouTube WebSub renewal job", normalizedError);
      return;
    }

    console.error("[ERROR] YouTube WebSub renewal failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "YouTube WebSub renewal",
        errorMessage: normalizedError,
        actionUrl: "/home/communication/sermons",
        dedupeKey: "youtube.websub.renewal.failed",
      });
    } catch (notificationError) {
      console.error(
        "[ERROR] YouTube WebSub renewal failure alert failed:",
        normalizeCronJobErrorMessage(notificationError),
      );
    }
  } finally {
    isWebsubRenewalJobRunning = false;
  }
}

if (!isWebsubConfigured()) {
  console.info(
    "[INFO] YouTube WebSub renewal job disabled: YOUTUBE_WEBSUB_CALLBACK_URL / YOUTUBE_WEBSUB_SECRET are not set.",
  );
} else if (!cron.validate(YOUTUBE_WEBSUB_RENEWAL_CRON)) {
  console.error(
    `[ERROR] YouTube WebSub renewal job disabled: invalid YOUTUBE_WEBSUB_RENEWAL_CRON "${YOUTUBE_WEBSUB_RENEWAL_CRON}".`,
  );
} else {
  cron.schedule(YOUTUBE_WEBSUB_RENEWAL_CRON, async () => {
    await processWebsubRenewalJob();
  });

  // Subscribe immediately on boot so a fresh deploy has a live lease.
  void processWebsubRenewalJob();
}
