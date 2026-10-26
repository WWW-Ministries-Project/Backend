import cron from "node-cron";
import { batchTranscribeRecent } from "../modules/sermons/sermonBatchTranscribeService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isJobRunning = false;
// Every 6 hours by default. The free caption path is cheap; the job skips videos
// already transcribed, so a tick usually fetches only what is new.
const SERMON_TRANSCRIBE_CRON = process.env.SERMON_TRANSCRIBE_CRON || "0 */6 * * *";
const DISABLED = ["false", "0", "no"].includes(
  String(process.env.SERMON_TRANSCRIBE_ENABLED ?? "true").trim().toLowerCase(),
);

export async function processSermonTranscribeJob() {
  if (isJobRunning) return;
  isJobRunning = true;
  try {
    const summary = await batchTranscribeRecent();
    console.info(
      `[INFO] Sermon transcribe job: ${summary.transcribed} new, ${summary.cached} cached, ` +
        `${summary.skipped} skipped, ${summary.failed} failed (of ${summary.checked}).`,
    );
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Sermon transcribe job", normalizedError);
      return;
    }
    console.error("[ERROR] Sermon transcribe job failed:", normalizedError);
  } finally {
    isJobRunning = false;
  }
}

if (DISABLED) {
  console.info("[INFO] Sermon transcribe job disabled: SERMON_TRANSCRIBE_ENABLED is false.");
} else if (!cron.validate(SERMON_TRANSCRIBE_CRON)) {
  console.error(
    `[ERROR] Sermon transcribe job disabled: invalid SERMON_TRANSCRIBE_CRON "${SERMON_TRANSCRIBE_CRON}".`,
  );
} else {
  cron.schedule(SERMON_TRANSCRIBE_CRON, async () => {
    await processSermonTranscribeJob();
  });
}
