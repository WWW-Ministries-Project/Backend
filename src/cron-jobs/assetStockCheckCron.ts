import cron from "node-cron";
import { runStockCheckAutoReminders } from "../modules/assets/asset-stock-check";

let isStockCheckReminderJobRunning = false;

/** Reminds counters who haven't submitted as an open stock check nears its due date. */
export async function runStockCheckReminderJob() {
  if (isStockCheckReminderJobRunning) {
    return;
  }

  isStockCheckReminderJobRunning = true;
  try {
    const { sent } = await runStockCheckAutoReminders();
    console.info("[INFO] Stock check reminders sent", { sent });
  } catch (error: any) {
    console.error("[ERROR] Stock check reminder job failed:", error?.message || String(error));
  } finally {
    isStockCheckReminderJobRunning = false;
  }
}

// Once a day at 08:00 server time. ASSET_STOCK_CHECK_REMINDER_CRON overrides.
const DEFAULT_CRON = "0 8 * * *";
const configuredCron = process.env.ASSET_STOCK_CHECK_REMINDER_CRON?.trim();
if (configuredCron && !cron.validate(configuredCron)) {
  console.warn(`[WARN] Invalid ASSET_STOCK_CHECK_REMINDER_CRON "${configuredCron}"; using ${DEFAULT_CRON}`);
}
const reminderCron = configuredCron && cron.validate(configuredCron) ? configuredCron : DEFAULT_CRON;

cron.schedule(reminderCron, () => {
  void runStockCheckReminderJob();
});
