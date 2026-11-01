import { prisma } from "../../../Models/context";
import { youtubeGet, youtubeConfig } from "../../integrationUtils/youtubeClient";

const INGEST_BRANCH_ID = Number(process.env.SERMON_INGEST_BRANCH_ID || 1);
const INGEST_AUTHOR_USER_ID = Number(process.env.SERMON_INGEST_AUTHOR_USER_ID || 1);

/** Pull the channel's playlists and upsert each as a sermon_series, then assign
 *  member sermons (that we have ingested) to the series in playlist order.
 *
 *  A channel's playlists.list covers everything shown on the channel home —
 *  Shorts collections, Live, music, promos — not only sermon series. We only
 *  store a playlist as a series when it actually contains sermons we already
 *  hold; a playlist whose videos we never ingested (Shorts/live/other) is
 *  skipped so the catalogue stays series + videos, not the whole home page. */
export const syncSermonSeries = async (): Promise<{ series: number; assigned: number }> => {
  const { channelId } = youtubeConfig();
  let pageToken: string | undefined;
  let seriesCount = 0;
  let assigned = 0;
  do {
    const page = await youtubeGet("playlists", {
      part: "snippet,contentDetails",
      channelId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const pl of (page.items ?? []) as any[]) {
      if (!pl?.id || (pl.contentDetails?.itemCount ?? 0) === 0) continue;

      // The playlist's video ids in playlist order.
      const orderedVideoIds = await playlistVideoIds(pl.id);
      // Of those, the ones we actually hold as sermons. None → this playlist is
      // not a sermon series (Shorts/live/other); do not create a series for it.
      const ingested = await prisma.sermon.findMany({
        where: { video_id: { in: orderedVideoIds } },
        select: { video_id: true },
      });
      if (ingested.length === 0) continue;
      const ingestedIds = new Set(
        ingested.map((r) => r.video_id).filter((v): v is string => Boolean(v)),
      );

      const series = await prisma.sermon_series.upsert({
        where: { youtube_playlist_id: pl.id },
        create: {
          youtube_playlist_id: pl.id,
          title: (pl.snippet?.title ?? "Series").trim(),
          description: (pl.snippet?.description ?? "").trim() || null,
          status: "PUBLISHED",
          published_at: new Date(),
          branch_id: INGEST_BRANCH_ID,
          created_by: INGEST_AUTHOR_USER_ID,
        },
        update: { title: (pl.snippet?.title ?? "Series").trim() },
        select: { id: true },
      });
      seriesCount += 1;
      assigned += await assignInOrder(series.id, orderedVideoIds, ingestedIds);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { series: seriesCount, assigned };
};

/** Collect a playlist's video ids in playlist order. */
const playlistVideoIds = async (playlistId: string): Promise<string[]> => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await youtubeGet("playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of (page.items ?? []) as any[]) {
      const videoId = item?.contentDetails?.videoId;
      if (videoId) ids.push(videoId);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
};

/** Set series_id + position for the sermons we hold that belong to this
 *  playlist, in playlist order. Videos we have not ingested are skipped, so
 *  position counts only ingested sermons (contiguous from 0). */
const assignInOrder = async (
  seriesId: number,
  orderedVideoIds: string[],
  ingestedIds: Set<string>,
): Promise<number> => {
  let position = 0;
  let assigned = 0;
  for (const videoId of orderedVideoIds) {
    if (!ingestedIds.has(videoId)) continue;
    const res = await prisma.sermon.updateMany({
      where: { video_id: videoId },
      data: { series_id: seriesId, position },
    });
    assigned += res.count;
    position += 1;
  }
  return assigned;
};
