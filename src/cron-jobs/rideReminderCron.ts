/**
 * rideReminderCron.ts
 *
 * Runs every five minutes. On the day of the service, reminds each driver and
 * their accepted passengers REMINDER_LEAD_MINUTES before the driver sets off
 * (the "we'll remind you Sunday at 6:45 AM" the app promises). Each ride is
 * claimed with `reminder_sent` before sending, so overlapping ticks or a
 * second worker never double-send.
 */

import cron from "node-cron";
import { sendDueReminders } from "../modules/rides/rideService";
import { churchMinutesNow, churchToday } from "../modules/rides/rideHelpers";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isRideReminderJobRunning = false;
const RIDE_REMINDER_CRON = process.env.RIDE_REMINDER_CRON || "*/5 * * * *";

export async function processRideRemindersJob() {
  if (isRideReminderJobRunning) {
    return;
  }

  isRideReminderJobRunning = true;
  try {
    const now = new Date();
    const sent = await sendDueReminders(churchToday(now), churchMinutesNow(now));
    if (sent) {
      console.info(`[INFO] Sent ride reminders for ${sent} ride(s)`);
    }
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Ride reminder job", normalizedError);
      return;
    }
    console.error("[ERROR] Ride reminder job failed:", normalizedError);
  } finally {
    isRideReminderJobRunning = false;
  }
}

if (!cron.validate(RIDE_REMINDER_CRON)) {
  console.error(`[ERROR] Ride reminder job disabled: invalid RIDE_REMINDER_CRON "${RIDE_REMINDER_CRON}".`);
} else {
  cron.schedule(RIDE_REMINDER_CRON, () => {
    void processRideRemindersJob();
  });
}
