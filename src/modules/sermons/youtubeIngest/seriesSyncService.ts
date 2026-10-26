import { prisma } from "../../../Models/context";
import { youtubeGet, youtubeConfig } from "../../integrationUtils/youtubeClient";

const INGEST_BRANCH_ID = Number(process.env.SERMON_INGEST_BRANCH_ID || 1);
const INGEST_AUTHOR_USER_ID = Number(process.env.SERMON_INGEST_AUTHOR_USER_ID || 1);

/** Pull the channel's playlists and upsert each as a sermon_series, then assign
 *  member sermons (that we have ingested) to the series in playlist order. */
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
      assigned += await assignPlaylistItems(pl.id, series.id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { series: seriesCount, assigned };
};

/** Set series_id + position for the sermons we already hold that belong to this
 *  playlist, in playlist order. Videos we have not ingested are skipped. */
const assignPlaylistItems = async (playlistId: string, seriesId: number): Promise<number> => {
  let pageToken: string | undefined;
  let position = 0;
  let assigned = 0;
  do {
    const page = await youtubeGet("playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of (page.items ?? []) as any[]) {
      const videoId = item?.contentDetails?.videoId;
      if (!videoId) continue;
      const res = await prisma.sermon.updateMany({
        where: { video_id: videoId },
        data: { series_id: seriesId, position },
      });
      assigned += res.count;
      position += 1;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return assigned;
};
