import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";
import { notificationPushService } from "../modules/notifications/notificationPushService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isNotificationPushRetryJobRunning = false;
const LOG_EMPTY_RETRY_RUNS = process.env.NOTIFICATION_PUSH_RETRY_LOG_EMPTY === "true";
const NOTIFICATION_PUSH_RETRY_CRON =
  process.env.NOTIFICATION_PUSH_RETRY_CRON || "* * * * *";

export async function processNotificationPushRetriesJob() {
  if (isNotificationPushRetryJobRunning) {
    return;
  }

  isNotificationPushRetryJobRunning = true;

  try {
    const result = await notificationPushService.processPendingPushDeliveryJobs();
    if (
      LOG_EMPTY_RETRY_RUNS ||
      result.processed > 0 ||
      result.dead > 0 ||
      result.requeued > 0
    ) {
      console.info("[INFO] Notification push retry job:", result);
    }
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning(
        "Notification push retry job",
        normalizedError,
      );
      return;
    }

    console.error("[ERROR] Notification push retry job failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "notification-push-retry",
        errorMessage: normalizedError,
        actionUrl: "/home/notifications",
        dedupeKey: `job:notification-push-retry:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch (notificationError) {
      const normalizedNotificationError =
        normalizeCronJobErrorMessage(notificationError);

      if (isDatabaseUnavailableError(notificationError)) {
        logDatabaseUnavailableWarning(
          "Notification push retry job failure alert",
          normalizedNotificationError,
        );
      } else {
        console.error(
          "[ERROR] Notification push retry job failure alert failed:",
          normalizedNotificationError,
        );
      }
    }
  } finally {
    isNotificationPushRetryJobRunning = false;
  }
}

// Retry transient push failures promptly so device notifications do not stall.
cron.schedule(NOTIFICATION_PUSH_RETRY_CRON, async () => {
  await processNotificationPushRetriesJob();
});

void processNotificationPushRetriesJob();
