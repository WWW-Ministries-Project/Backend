import cron from "node-cron";
import { processPendingRequisitionNotificationEvents } from "../modules/requisitions/requisition-approval-workflow";
import { notificationService } from "../modules/notifications/notificationService";

let isRequisitionNotificationJobRunning = false;

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

cron.schedule("5 * * * * *", async () => {
  await processRequisitionNotificationEventsJob();
});
