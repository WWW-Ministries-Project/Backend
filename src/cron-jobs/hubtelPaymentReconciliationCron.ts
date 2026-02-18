import cron from "node-cron";
import { OrderService } from "../modules/orders/orderService";

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
    console.error(
      "[ERROR] Hubtel pending payment reconciliation failed:",
      error.message || error,
    );
  } finally {
    isReconciling = false;
  }
}

cron.schedule("*/10 * * * *", async () => {
  await reconcilePendingHubtelPaymentsJob();
});
