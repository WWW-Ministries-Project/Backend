/**
 * messagingBirthdayCron.ts
 *
 * Every 15 minutes: if the birthday template is on, the church-local time
 * has passed the configured send time and today has not run yet, queue
 * today's birthday messages. Catches up after a restart past send time.
 */
import cron from "node-cron";
import { notificationService } from "../modules/notifications/notificationService";
import { runBirthdays } from "../modules/messaging/messagingService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isBirthdayJobRunning = false;
const MESSAGING_BIRTHDAY_CRON = process.env.MESSAGING_BIRTHDAY_CRON || "*/15 * * * *";

export async function processBirthdayMessagesJob() {
  if (isBirthdayJobRunning) return;
  isBirthdayJobRunning = true;
  try {
    const queued = await runBirthdays();
    if (queued) console.info(`[INFO] Queued birthday messages for ${queued} member(s)`);
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Birthday messages job", normalizedError);
      return;
    }
    console.error("[ERROR] Birthday messages job failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "messaging-birthday",
        errorMessage: normalizedError,
        actionUrl: "/home/notifications",
        dedupeKey: `job:messaging-birthday:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch (notificationError) {
      const normalizedNotificationError =
        normalizeCronJobErrorMessage(notificationError);
      if (isDatabaseUnavailableError(notificationError)) {
        logDatabaseUnavailableWarning(
          "Birthday messages job failure alert",
          normalizedNotificationError,
        );
      } else {
        console.error(
          "[ERROR] Birthday messages job failure alert failed:",
          normalizedNotificationError,
        );
      }
    }
  } finally {
    isBirthdayJobRunning = false;
  }
}

if (!cron.validate(MESSAGING_BIRTHDAY_CRON)) {
  console.error(`[ERROR] Birthday messages job disabled: invalid MESSAGING_BIRTHDAY_CRON "${MESSAGING_BIRTHDAY_CRON}".`);
} else {
  cron.schedule(MESSAGING_BIRTHDAY_CRON, () => {
    void processBirthdayMessagesJob();
  });
}
