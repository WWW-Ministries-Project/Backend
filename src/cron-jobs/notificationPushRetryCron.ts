import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";
import { notificationPushService } from "../modules/notifications/notificationPushService";

let isNotificationPushRetryJobRunning = false;
const LOG_EMPTY_RETRY_RUNS = process.env.NOTIFICATION_PUSH_RETRY_LOG_EMPTY === "true";
const NOTIFICATION_PUSH_RETRY_CRON =
  process.env.NOTIFICATION_PUSH_RETRY_CRON || "55 23 * * *";

export async function processNotificationPushRetriesJob() {
  if (notificationService.isSseOnlyModeEnabled()) {
    return;
  }

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
    const normalizedError = error?.message || String(error);
    console.error("[ERROR] Notification push retry job failed:", normalizedError);
    await notificationService.notifyAdminsJobFailed({
      jobName: "notification-push-retry",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:notification-push-retry:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isNotificationPushRetryJobRunning = false;
  }
}

if (notificationService.isSseOnlyModeEnabled()) {
  console.info(
    "[INFO] Notification push retry cron disabled: notifications are SSE-only.",
  );
} else {
  // Non-essential push retry runs daily in off-peak window, server timezone.
  cron.schedule(NOTIFICATION_PUSH_RETRY_CRON, async () => {
    await processNotificationPushRetriesJob();
  });
}
