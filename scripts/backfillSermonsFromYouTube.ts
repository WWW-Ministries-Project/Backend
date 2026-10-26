/**
 * One-time backfill: import the existing YouTube catalogue as sermons.
 *
 *   npx ts-node --transpile-only scripts/backfillSermonsFromYouTube.ts
 *
 * Reads config/credentials from .env (DATABASE_URL, YOUTUBE_API_KEY, …), so the
 * dotenv side-effect import below must run before Models/context instantiates
 * the Prisma client. Hits the YouTube Data API and writes to the database — run
 * it deliberately, not in CI.
 */
import "dotenv/config";
import { youtubeGet, youtubeConfig } from "../src/modules/integrationUtils/youtubeClient";
import { ingestVideoById } from "../src/modules/sermons/youtubeIngest/youtubeIngestService";
import { syncSermonSeries } from "../src/modules/sermons/youtubeIngest/seriesSyncService";

// Walk the channel's Videos-tab playlist (UULF…, the same list the mobile app
// used) and ingest each video WITHOUT notifying managers (bulk import), then
// sync series. Safe to re-run: already-ingested videos report "skipped-existing".
async function main() {
  const { videosTabPlaylistId } = youtubeConfig();
  let pageToken: string | undefined;
  let ingested = 0;
  do {
    const page = await youtubeGet("playlistItems", {
      part: "contentDetails",
      playlistId: videosTabPlaylistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of (page.items ?? []) as any[]) {
      const videoId = item?.contentDetails?.videoId;
      if (!videoId) continue;
      const res = await ingestVideoById(videoId, { notify: false });
      if (res.status === "ingested") ingested += 1;
      console.log(`${videoId}: ${res.status}`);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  const series = await syncSermonSeries();
  console.log(`Backfill done. Ingested ${ingested}. Series:`, series);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
