import cron from "node-cron";
import { processPendingEventReportNotificationEvents } from "../modules/eventReports/eventReportService";
import { notificationService } from "../modules/notifications/notificationService";

let isEventReportNotificationJobRunning = false;
const EVENT_REPORT_CRITICAL_JOB_DEFAULT_CRONS = ["20 5 * * *", "20 11 * * *"];
const EVENT_REPORT_CRITICAL_JOB_CRONS = (() => {
  const configured = process.env.EVENT_REPORT_NOTIFICATION_CRONS;
  if (!configured) {
    return EVENT_REPORT_CRITICAL_JOB_DEFAULT_CRONS;
  }

  const parsed = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => Boolean(value));

  return parsed.length
    ? parsed
    : EVENT_REPORT_CRITICAL_JOB_DEFAULT_CRONS;
})();

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

for (const cronExpression of EVENT_REPORT_CRITICAL_JOB_CRONS) {
  if (!cron.validate(cronExpression)) {
    console.warn(
      `[WARN] Skipping invalid EVENT_REPORT_NOTIFICATION_CRONS expression: ${cronExpression}`,
    );
    continue;
  }

  // Critical notification job runs twice daily (5-6am and 11am-12pm), server timezone.
  cron.schedule(cronExpression, async () => {
    await processEventReportNotificationEventsJob();
  });
}
