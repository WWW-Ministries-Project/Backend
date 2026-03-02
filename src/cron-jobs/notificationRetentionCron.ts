import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";

let isRetentionJobRunning = false;

export async function pruneOldNotificationsJob() {
  if (isRetentionJobRunning) {
    return;
  }

  isRetentionJobRunning = true;

  try {
    const result = await notificationService.pruneOldNotifications(90);
    console.info("[INFO] Notification retention job:", result);
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error("[ERROR] Notification retention job failed:", normalizedError);

    await notificationService.notifyAdminsJobFailed({
      jobName: "notification-retention",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:notification-retention:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isRetentionJobRunning = false;
  }
}

// 03:00 daily server time
cron.schedule("0 3 * * *", async () => {
  await pruneOldNotificationsJob();
});

