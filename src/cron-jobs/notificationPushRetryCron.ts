import cron from "node-cron";
import { notificationPushService } from "../modules/notifications/notificationPushService";

let isNotificationPushRetryJobRunning = false;

export async function processNotificationPushRetriesJob() {
  if (isNotificationPushRetryJobRunning) {
    return;
  }

  isNotificationPushRetryJobRunning = true;

  try {
    const result = await notificationPushService.processPendingPushDeliveryJobs();
    if (result.processed > 0 || result.dead > 0 || result.requeued > 0) {
      console.info("[INFO] Notification push retry job:", result);
    }
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error("[ERROR] Notification push retry job failed:", normalizedError);
  } finally {
    isNotificationPushRetryJobRunning = false;
  }
}

cron.schedule("* * * * *", async () => {
  await processNotificationPushRetriesJob();
});
