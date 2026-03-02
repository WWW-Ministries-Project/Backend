import cron from "node-cron";
import { processPendingRequisitionNotificationEvents } from "../modules/requisitions/requisition-approval-workflow";

let isRunning = false;

export async function processRequisitionNotificationEventsJob() {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    await processPendingRequisitionNotificationEvents();
  } catch (error: any) {
    console.error(
      "[ERROR] Requisition notification event processing failed:",
      error?.message || error,
    );
  } finally {
    isRunning = false;
  }
}

cron.schedule("* * * * *", async () => {
  await processRequisitionNotificationEventsJob();
});
