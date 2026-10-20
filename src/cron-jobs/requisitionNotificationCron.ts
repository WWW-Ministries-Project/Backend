import cron from "node-cron";
import { processPendingRequisitionNotificationEvents } from "../modules/requisitions/requisition-approval-workflow";
import { runRequisitionAutoReminders } from "../modules/requisitions/requisition-redesign";
import { notificationService } from "../modules/notifications/notificationService";

let isRequisitionNotificationJobRunning = false;
const REQUISITION_CRITICAL_JOB_DEFAULT_CRONS = ["*/5 * * * *"];
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

  // Retry pending requisition notifications frequently to avoid long delivery gaps.
  cron.schedule(cronExpression, async () => {
    await processRequisitionNotificationEventsJob();
  });
}

void processRequisitionNotificationEventsJob();

let isRequisitionReminderJobRunning = false;

/** Chases approvers who have held a requisition past the reply time. */
export async function runRequisitionReminderJob() {
  if (isRequisitionReminderJobRunning) {
    return;
  }

  isRequisitionReminderJobRunning = true;
  try {
    const { sent } = await runRequisitionAutoReminders();
    console.info("[INFO] Requisition approval reminders sent", { sent });
  } catch (error: any) {
    console.error(
      "[ERROR] Requisition approval reminder job failed:",
      error?.message || String(error),
    );
  } finally {
    isRequisitionReminderJobRunning = false;
  }
}

// Once a day, at 08:00 server time, so reminders land at the start of the day.
const REQUISITION_REMINDER_DEFAULT_CRON = "0 8 * * *";
const configuredReminderCron = process.env.REQUISITION_REMINDER_CRON?.trim();
if (configuredReminderCron && !cron.validate(configuredReminderCron)) {
  console.warn(
    `[WARN] Invalid REQUISITION_REMINDER_CRON "${configuredReminderCron}"; using ${REQUISITION_REMINDER_DEFAULT_CRON}`,
  );
}
const reminderCron =
  configuredReminderCron && cron.validate(configuredReminderCron)
    ? configuredReminderCron
    : REQUISITION_REMINDER_DEFAULT_CRON;

cron.schedule(reminderCron, async () => {
  await runRequisitionReminderJob();
});
