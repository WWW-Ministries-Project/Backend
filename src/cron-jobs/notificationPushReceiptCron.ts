import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";
import { notificationDeviceService } from "../modules/notifications/notificationDeviceService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isNotificationPushReceiptJobRunning = false;
const LOG_EMPTY_RECEIPT_RUNS =
  process.env.NOTIFICATION_PUSH_RECEIPT_LOG_EMPTY === "true";
// Receipts take time to become available; polling once a minute is plenty.
const NOTIFICATION_PUSH_RECEIPT_CRON =
  process.env.NOTIFICATION_PUSH_RECEIPT_CRON || "* * * * *";

export async function processNotificationPushReceiptsJob() {
  if (isNotificationPushReceiptJobRunning) {
    return;
  }

  isNotificationPushReceiptJobRunning = true;

  try {
    const result = await notificationDeviceService.pollExpoPushReceipts();
    if (
      LOG_EMPTY_RECEIPT_RUNS ||
      result.checked > 0 ||
      result.deactivated > 0 ||
      result.cleared > 0
    ) {
      console.info("[INFO] Notification push receipt job:", result);
    }
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning(
        "Notification push receipt job",
        normalizedError,
      );
      return;
    }

    console.error(
      "[ERROR] Notification push receipt job failed:",
      normalizedError,
    );
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "notification-push-receipt",
        errorMessage: normalizedError,
        actionUrl: "/home/notifications",
        dedupeKey: `job:notification-push-receipt:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch (notificationError) {
      const normalizedNotificationError =
        normalizeCronJobErrorMessage(notificationError);

      if (isDatabaseUnavailableError(notificationError)) {
        logDatabaseUnavailableWarning(
          "Notification push receipt job failure alert",
          normalizedNotificationError,
        );
      } else {
        console.error(
          "[ERROR] Notification push receipt job failure alert failed:",
          normalizedNotificationError,
        );
      }
    }
  } finally {
    isNotificationPushReceiptJobRunning = false;
  }
}

// Poll Expo for delivery receipts so dead device tokens get deactivated.
cron.schedule(NOTIFICATION_PUSH_RECEIPT_CRON, async () => {
  await processNotificationPushReceiptsJob();
});

void processNotificationPushReceiptsJob();
