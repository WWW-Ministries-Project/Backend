import cron from "node-cron";
import {
  isLiveStreamPollingConfigured,
  liveStreamService,
} from "../modules/liveStream/liveStreamService";
import { notificationService } from "../modules/notifications/notificationService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isLiveStreamJobRunning = false;
// Ticks every minute; the service itself decides (via `next_check_at`)
// whether this tick spends YouTube quota.
const LIVE_STREAM_CRON = process.env.LIVE_STREAM_CRON || "20 * * * * *";

export async function processLiveStreamJob() {
  if (isLiveStreamJobRunning) {
    return;
  }

  isLiveStreamJobRunning = true;

  try {
    await liveStreamService.refreshLiveStreamState();
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Live stream job", normalizedError);
      return;
    }

    console.error("[ERROR] Live stream job failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "live-stream",
        errorMessage: normalizedError,
        actionUrl: "/home/dashboard",
        // One alert per day: a bad key or exhausted quota fails every check.
        dedupeKey: `job:live-stream:${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (notificationError) {
      console.error(
        "[ERROR] Live stream job failure alert failed:",
        normalizeCronJobErrorMessage(notificationError),
      );
    }
  } finally {
    isLiveStreamJobRunning = false;
  }
}

if (!isLiveStreamPollingConfigured()) {
  console.info("[INFO] Live stream job disabled: YOUTUBE_API_KEY is not set.");
} else if (!cron.validate(LIVE_STREAM_CRON)) {
  console.error(`[ERROR] Live stream job disabled: invalid LIVE_STREAM_CRON "${LIVE_STREAM_CRON}".`);
} else {
  cron.schedule(LIVE_STREAM_CRON, async () => {
    await processLiveStreamJob();
  });

  void processLiveStreamJob();
}
