import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";

let isRetentionJobRunning = false;
const NOTIFICATION_RETENTION_CRON =
  process.env.NOTIFICATION_RETENTION_CRON || "45 23 * * *";
const NOTIFICATION_RETENTION_DAYS = (() => {
  const parsed = Number(process.env.NOTIFICATION_RETENTION_DAYS);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 90;
  }
  return Math.min(parsed, 3650);
})();

export async function pruneOldNotificationsJob() {
  if (isRetentionJobRunning) {
    return;
  }

  isRetentionJobRunning = true;

  try {
    const result = await notificationService.pruneOldNotifications(
      NOTIFICATION_RETENTION_DAYS,
    );
    console.info("[INFO] Notification retention job:", {
      ...result,
      retentionDays: NOTIFICATION_RETENTION_DAYS,
    });
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

// Daily in off-peak window (11pm-1am), server timezone.
cron.schedule(NOTIFICATION_RETENTION_CRON, async () => {
  await pruneOldNotificationsJob();
});
