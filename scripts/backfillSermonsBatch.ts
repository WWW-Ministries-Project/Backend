// One-time batch backfill of the channel's existing sermons.
//
// Run it ON THE SERVER (co-located with the DB) for best speed:
//   npx ts-node --transpile-only scripts/backfillSermonsBatch.ts
//
// Far cheaper than scripts/backfillSermonsFromYouTube.ts (which fetched one
// video per videos.list call and ingested one row at a time):
//   - reads the channel's Videos-tab playlist (UULF…), which YouTube already
//     strips of Shorts and live broadcasts — so no per-video classification;
//   - fetches metadata in batches of 50 ids per videos.list call (1 quota unit
//     each) instead of one call per video;
//   - ingests each batch with set-based bulk writes (see ingestSermonsBatch).
//
// Idempotent: re-run it any time — already-stored videos are skipped. After the
// first run, the WebSub webhook keeps the catalogue current; you never need to
// backfill the whole channel again.
//
// Requires .env: DATABASE_URL, YOUTUBE_API_KEY (+ optional YOUTUBE_CHANNEL_ID,
// SERMON_INGEST_AUTHOR_USER_ID / _BRANCH_ID — default 1).
import "dotenv/config";
import { youtubeGet, youtubeConfig } from "../src/modules/integrationUtils/youtubeClient";
import { mapVideoToSermonFields } from "../src/modules/sermons/youtubeIngest/videoMapping";
import { sermonService } from "../src/modules/sermons/sermonService";
import { syncSermonSeries } from "../src/modules/sermons/youtubeIngest/seriesSyncService";

const BATCH = 50; // YouTube videos.list + Prisma createMany both handle 50 well.

async function main() {
  const { videosTabPlaylistId } = youtubeConfig();

  // 1) Collect every video id from the Videos-tab playlist.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await youtubeGet("playlistItems", {
      part: "contentDetails",
      playlistId: videosTabPlaylistId,
      maxResults: String(BATCH),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of (page.items ?? []) as any[]) {
      const vid = item?.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  console.log(`Videos tab: ${ids.length} videos.`);

  // 2) Fetch metadata 50 at a time and bulk-ingest each batch.
  let created = 0;
  let skipped = 0;
  let nonPublic = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const body = await youtubeGet("videos", { part: "snippet,status", id: chunk.join(",") });
    const items = (body.items ?? []) as any[];
    const fields = items
      .filter((v) => !v?.status?.privacyStatus || v.status.privacyStatus === "public")
      .map(mapVideoToSermonFields)
      .filter((f) => f.video_id);
    nonPublic += items.length - fields.length;
    const res = await sermonService.ingestSermonsBatch(fields);
    created += res.created;
    skipped += res.skipped;
    console.log(
      `batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(ids.length / BATCH)}: +${res.created} created, ${res.skipped} skipped (total created ${created})`,
    );
  }

  // 3) Map YouTube playlists onto sermon_series and assign members in order.
  const series = await syncSermonSeries();

  console.log(`Backfill done. created=${created}, skipped=${skipped}, nonPublic=${nonPublic}. Series:`, series);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
