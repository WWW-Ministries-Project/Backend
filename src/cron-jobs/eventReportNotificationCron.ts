import cron from "node-cron";
import { processPendingEventReportNotificationEvents } from "../modules/eventReports/eventReportService";
import { notificationService } from "../modules/notifications/notificationService";

let isRunning = false;

export async function processEventReportNotificationEventsJob() {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    await processPendingEventReportNotificationEvents();
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
    isRunning = false;
  }
}

cron.schedule("* * * * *", async () => {
  await processEventReportNotificationEventsJob();
});
