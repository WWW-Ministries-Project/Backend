import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";
import { notificationSmsService } from "../modules/notifications/notificationSmsService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isNotificationSmsRetryJobRunning = false;
const LOG_EMPTY_RETRY_RUNS = process.env.NOTIFICATION_SMS_RETRY_LOG_EMPTY === "true";
const NOTIFICATION_SMS_RETRY_CRON =
  process.env.NOTIFICATION_SMS_RETRY_CRON || "* * * * *";

export async function processNotificationSmsRetriesJob() {
  if (!notificationSmsService.isSmsEnabled()) {
    return;
  }

  if (isNotificationSmsRetryJobRunning) {
    return;
  }

  isNotificationSmsRetryJobRunning = true;

  try {
    const result = await notificationSmsService.processPendingSmsDeliveryJobs();
    if (
      LOG_EMPTY_RETRY_RUNS ||
      result.processed > 0 ||
      result.sent > 0 ||
      result.requeued > 0 ||
      result.dead > 0
    ) {
      console.info("[INFO] Notification SMS retry job:", result);
    }
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning(
        "Notification SMS retry job",
        normalizedError,
      );
      return;
    }

    console.error("[ERROR] Notification SMS retry job failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "notification-sms-retry",
        errorMessage: normalizedError,
        actionUrl: "/home/notifications",
        dedupeKey: `job:notification-sms-retry:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch (notificationError) {
      const normalizedNotificationError =
        normalizeCronJobErrorMessage(notificationError);

      if (isDatabaseUnavailableError(notificationError)) {
        logDatabaseUnavailableWarning(
          "Notification SMS retry job failure alert",
          normalizedNotificationError,
        );
      } else {
        console.error(
          "[ERROR] Notification SMS retry job failure alert failed:",
          normalizedNotificationError,
        );
      }
    }
  } finally {
    isNotificationSmsRetryJobRunning = false;
  }
}

if (!notificationSmsService.isSmsEnabled()) {
  console.info(
    "[INFO] Notification SMS retry cron disabled: SMS delivery is not configured.",
  );
} else {
  cron.schedule(NOTIFICATION_SMS_RETRY_CRON, async () => {
    await processNotificationSmsRetriesJob();
  });
}
