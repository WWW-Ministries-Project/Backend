import cron from "node-cron";
import { syncSermonSeries } from "../modules/sermons/youtubeIngest/seriesSyncService";
import { isYoutubeConfigured } from "../modules/integrationUtils/youtubeClient";
import { notificationService } from "../modules/notifications/notificationService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isSeriesSyncJobRunning = false;
const SERMON_SERIES_SYNC_CRON =
  process.env.SERMON_SERIES_SYNC_CRON || "0 */6 * * *";

export async function processSeriesSyncJob() {
  if (isSeriesSyncJobRunning) {
    return;
  }

  isSeriesSyncJobRunning = true;

  try {
    await syncSermonSeries();
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);

    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Sermon series sync job", normalizedError);
      return;
    }

    console.error("[ERROR] Sermon series sync failed:", normalizedError);
    try {
      await notificationService.notifyAdminsJobFailed({
        jobName: "Sermon series sync",
        errorMessage: normalizedError,
        actionUrl: "/home/communication/sermons",
        dedupeKey: "sermon.series.sync.failed",
      });
    } catch (notificationError) {
      console.error(
        "[ERROR] Sermon series sync failure alert failed:",
        normalizeCronJobErrorMessage(notificationError),
      );
    }
  } finally {
    isSeriesSyncJobRunning = false;
  }
}

if (!isYoutubeConfigured()) {
  console.info(
    "[INFO] Sermon series sync job disabled: YOUTUBE_API_KEY is not set.",
  );
} else if (!cron.validate(SERMON_SERIES_SYNC_CRON)) {
  console.error(
    `[ERROR] Sermon series sync job disabled: invalid SERMON_SERIES_SYNC_CRON "${SERMON_SERIES_SYNC_CRON}".`,
  );
} else {
  cron.schedule(SERMON_SERIES_SYNC_CRON, async () => {
    await processSeriesSyncJob();
  });
}
