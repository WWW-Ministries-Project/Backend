/**
 * appointmentNotificationCron.ts
 *
 * Every 15 minutes (APPOINTMENT_JOBS_CRON, default "7,22,37,52 * * * *" so it
 * stays off the minute the other crons share): appointment nudges, overdue
 * alerts, unanswered notices, reminders and outcome prompts. Each is sent
 * once per booking; see src/modules/appointment/appointment-jobs.ts.
 */

import cron from "node-cron";
import { runAppointmentJobs } from "../modules/appointment/appointment-jobs";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isAppointmentJobRunning = false;
const APPOINTMENT_JOBS_CRON =
  process.env.APPOINTMENT_JOBS_CRON || "7,22,37,52 * * * *";

export async function processAppointmentJobs() {
  if (isAppointmentJobRunning) {
    return;
  }

  isAppointmentJobRunning = true;
  try {
    const counts = await runAppointmentJobs();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total) {
      console.info("[INFO] Appointment notifications sent", counts);
    }
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Appointment notification job", normalizedError);
      return;
    }
    console.error("[ERROR] Appointment notification job failed:", normalizedError);
  } finally {
    isAppointmentJobRunning = false;
  }
}

if (!cron.validate(APPOINTMENT_JOBS_CRON)) {
  console.error(
    `[ERROR] Appointment notification job disabled: invalid APPOINTMENT_JOBS_CRON "${APPOINTMENT_JOBS_CRON}".`,
  );
} else {
  cron.schedule(APPOINTMENT_JOBS_CRON, () => {
    void processAppointmentJobs();
  });
}
