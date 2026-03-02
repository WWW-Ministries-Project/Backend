import cron from "node-cron";
import { OrderService } from "../modules/orders/orderService";
import { notificationService } from "../modules/notifications/notificationService";

const orderService = new OrderService();

let isReconciling = false;

export async function reconcilePendingHubtelPaymentsJob() {
  if (isReconciling) {
    return;
  }

  const hasHubtelConfig =
    Boolean(process.env.HUBTEL_POS_ID) && Boolean(process.env.HUBTEL_AUTH);
  if (!hasHubtelConfig) {
    return;
  }

  isReconciling = true;

  try {
    const result = await orderService.reconcilePendingHubtelPayments(100);
    console.log("[INFO] Hubtel pending payment reconciliation:", result);
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Hubtel pending payment reconciliation failed:",
      normalizedError,
    );
    await notificationService.notifyAdminsJobFailed({
      jobName: "hubtel-payment-reconciliation",
      errorMessage: normalizedError,
      actionUrl: "/home/dashboard",
      dedupeKey: `job:hubtel-reconciliation:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isReconciling = false;
  }
}

cron.schedule("*/10 * * * *", async () => {
  await reconcilePendingHubtelPaymentsJob();
});
