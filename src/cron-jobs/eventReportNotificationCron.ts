import cron from "node-cron";
import { processPendingEventReportNotificationEvents } from "../modules/eventReports/eventReportService";
import { notificationService } from "../modules/notifications/notificationService";

let isEventReportNotificationJobRunning = false;

export async function processEventReportNotificationEventsJob() {
  if (isEventReportNotificationJobRunning) {
    return;
  }

  isEventReportNotificationJobRunning = true;
  const startedAt = Date.now();

  try {
    console.info("[INFO] Starting event report notification event processing job");
    await processPendingEventReportNotificationEvents();
    console.info("[INFO] Event report notification event processing completed", {
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Event report notification event processing failed:",
      normalizedError,
    );

    await notificationService.notifyAdminsJobFailed({
      jobName: "event-report-notification-events",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:event-report-notification-events:${new Date()
        .toISOString()
        .slice(0, 13)}`,
    });
  } finally {
    isEventReportNotificationJobRunning = false;
  }
}

cron.schedule("20 * * * * *", async () => {
  await processEventReportNotificationEventsJob();
});
