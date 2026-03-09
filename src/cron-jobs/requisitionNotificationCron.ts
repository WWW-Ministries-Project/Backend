import cron from "node-cron";
import { processPendingRequisitionNotificationEvents } from "../modules/requisitions/requisition-approval-workflow";
import { notificationService } from "../modules/notifications/notificationService";

let isRunning = false;

export async function processRequisitionNotificationEventsJob() {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    await processPendingRequisitionNotificationEvents();
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
    isRunning = false;
  }
}

cron.schedule("5 * * * * *", async () => {
  await processRequisitionNotificationEventsJob();
});
