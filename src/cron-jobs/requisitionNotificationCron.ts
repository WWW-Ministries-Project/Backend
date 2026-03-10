import cron from "node-cron";
import { processPendingRequisitionNotificationEvents } from "../modules/requisitions/requisition-approval-workflow";
import { notificationService } from "../modules/notifications/notificationService";

let isRequisitionNotificationJobRunning = false;
const REQUISITION_CRITICAL_JOB_DEFAULT_CRONS = ["5 5 * * *", "5 11 * * *"];
const REQUISITION_CRITICAL_JOB_CRONS = (() => {
  const configured = process.env.REQUISITION_NOTIFICATION_CRONS;
  if (!configured) {
    return REQUISITION_CRITICAL_JOB_DEFAULT_CRONS;
  }

  const parsed = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => Boolean(value));

  return parsed.length ? parsed : REQUISITION_CRITICAL_JOB_DEFAULT_CRONS;
})();

export async function processRequisitionNotificationEventsJob() {
  if (isRequisitionNotificationJobRunning) {
    return;
  }

  isRequisitionNotificationJobRunning = true;
  const startedAt = Date.now();

  try {
    console.info("[INFO] Starting requisition notification event processing job");
    await processPendingRequisitionNotificationEvents();
    console.info("[INFO] Requisition notification event processing completed", {
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Requisition notification event processing failed:",
      normalizedError,
    );
    await notificationService.notifyAdminsJobFailed({
      jobName: "requisition-notification-events",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:requisition-notification-events:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isRequisitionNotificationJobRunning = false;
  }
}

for (const cronExpression of REQUISITION_CRITICAL_JOB_CRONS) {
  if (!cron.validate(cronExpression)) {
    console.warn(
      `[WARN] Skipping invalid REQUISITION_NOTIFICATION_CRONS expression: ${cronExpression}`,
    );
    continue;
  }

  // Critical notification job runs twice daily (5-6am and 11am-12pm), server timezone.
  cron.schedule(cronExpression, async () => {
    await processRequisitionNotificationEventsJob();
  });
}
