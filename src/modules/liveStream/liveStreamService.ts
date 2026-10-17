import axios from "axios";
import { prisma } from "../../Models/context";
import { notificationDeviceService } from "../notifications/notificationDeviceService";

/*
  YouTube live detection.

  One cron on the server asks YouTube about the channel and stores the answer
  in the `live_stream_state` singleton; every phone reads that row through
  `GET /live-stream/status`. Phones polling YouTube directly would multiply
  the key's 10,000-unit daily quota by the number of members.

  Each check costs 2 units: `playlistItems.list` on the channel's Live-tab
  playlist (UULV…) for the latest broadcast ids, then `videos.list` on those
  ids for their live state. `search.list?eventType=live` would answer in one
  call but costs 100 units. Checks are paced by `next_check_at` — tighter
  while a broadcast is live or about to start, relaxed otherwise — so a day
  costs a few hundred units.
*/

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const STATE_ID = 1;

export const LIVE_STREAM_NOTIFICATION_TYPE = "livestream.started";

export type LiveStreamStatus = "LIVE" | "UPCOMING" | "OFFLINE";

const readMinutes = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MINUTE_MS = 60 * 1000;
/** Gap between checks when nothing is live or imminent. */
const IDLE_INTERVAL_MS = readMinutes("LIVE_STREAM_IDLE_POLL_MINUTES", 5) * MINUTE_MS;
/** Gap between checks while live — only needs to notice the stream ending. */
const LIVE_INTERVAL_MS = readMinutes("LIVE_STREAM_LIVE_POLL_MINUTES", 2) * MINUTE_MS;
/** Gap between checks around an upcoming broadcast's scheduled start. */
const IMMINENT_INTERVAL_MS = readMinutes("LIVE_STREAM_IMMINENT_POLL_MINUTES", 1) * MINUTE_MS;
/** Back-off after a failed check, so a bad key or exhausted quota is not hammered. */
const ERROR_INTERVAL_MS = readMinutes("LIVE_STREAM_ERROR_POLL_MINUTES", 30) * MINUTE_MS;

/** "Imminent" spans 15 minutes before to 60 minutes after the scheduled start. */
const IMMINENT_BEFORE_MS = 15 * MINUTE_MS;
const IMMINENT_AFTER_MS = 60 * MINUTE_MS;
/** YouTube leaves abandoned "upcoming" broadcasts in place forever; ignore
 *  ones more than 2 hours overdue or more than 7 days out. */
const UPCOMING_OVERDUE_MS = 2 * 60 * MINUTE_MS;
const UPCOMING_HORIZON_MS = 7 * 24 * 60 * MINUTE_MS;
/** A stream already running this long when first seen (server was down, or
 *  first deploy mid-service) is shown but not pushed about. */
const NOTIFY_MAX_AGE_MS = 60 * MINUTE_MS;
/** If the cron stops, stop claiming "live" from an old row. */
const STALE_AFTER_MS = 20 * MINUTE_MS;
/** How long a read of the row is reused across status requests. */
const STATUS_CACHE_MS = 15 * 1000;

const CANDIDATE_COUNT = 10;
const REQUEST_TIMEOUT_MS = 10 * 1000;

const config = () => {
  const channelId = (process.env.YOUTUBE_CHANNEL_ID || "UCEdXLYbtPZFk1wXrOKBX0qw").trim();
  return {
    apiKey: (process.env.YOUTUBE_API_KEY || "").trim(),
    referer: (process.env.YOUTUBE_API_REFERER || "").trim(),
    // UU… is the channel's full uploads playlist; UULV… the Live tab only.
    liveTabPlaylistId: `UULV${channelId.slice(2)}`,
    uploadsPlaylistId: `UU${channelId.slice(2)}`,
  };
};

export const isLiveStreamPollingConfigured = (): boolean => Boolean(config().apiKey);

type Broadcast = {
  status: Exclude<LiveStreamStatus, "OFFLINE">;
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  scheduledStartAt: Date | null;
  actualStartAt: Date | null;
};

export type LiveStreamPayload = {
  status: "live" | "upcoming" | "offline";
  videoId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  youtubeUrl: string | null;
  scheduledStartAt: string | null;
  actualStartAt: string | null;
  checkedAt: string | null;
};

/**
 * The shared key is HTTP-referrer restricted and, today, accepts only this
 * origin: no Referer and the production hosts all get 403. Same workaround as
 * the website's sync script and the mobile client. Inert once the key is
 * unrestricted.
 */
const FALLBACK_REFERER = "http://localhost:3000/";

/** The Referer that last got through, so a configured one the key rejects
 *  costs one failed call per process rather than one per check. */
let workingReferer: string | null = null;

const isRefererBlocked = (error: any): boolean =>
  error?.response?.status === 403 &&
  /referer/i.test(String(error?.response?.data?.error?.message ?? ""));

const youtubeGet = async (
  path: string,
  params: Record<string, string>,
): Promise<Record<string, any>> => {
  const { apiKey, referer } = config();
  // Configured Referer first, then the fallback. A YOUTUBE_API_REFERER set to
  // an origin the key does not allow would otherwise fail every check and
  // leave the app reading "offline" through a live broadcast.
  const candidates = [...new Set([workingReferer, referer, FALLBACK_REFERER].filter(Boolean) as string[])];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const response = await axios.get(`${YOUTUBE_API}/${path}`, {
        params: { ...params, key: apiKey },
        headers: { Referer: candidate },
        timeout: REQUEST_TIMEOUT_MS,
      });
      workingReferer = candidate;
      return response.data && typeof response.data === "object" ? response.data : {};
    } catch (error) {
      if (!isRefererBlocked(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const pickThumbnail = (thumbnails: Record<string, any> | undefined): string | null => {
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const url = thumbnails?.[size]?.url;
    if (typeof url === "string" && url) return url;
  }
  return null;
};

const playlistVideoIds = async (playlistId: string): Promise<string[]> => {
  const body = await youtubeGet("playlistItems", {
    part: "contentDetails",
    playlistId,
    maxResults: String(CANDIDATE_COUNT),
  });
  const items: any[] = Array.isArray(body.items) ? body.items : [];
  return items
    .map((item) => item?.contentDetails?.videoId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
};

/** The latest broadcast ids. A channel that has never streamed has no Live
 *  tab playlist (404); fall back to its uploads, which list broadcasts too. */
const candidateVideoIds = async (): Promise<string[]> => {
  const { liveTabPlaylistId, uploadsPlaylistId } = config();
  try {
    return await playlistVideoIds(liveTabPlaylistId);
  } catch (error: any) {
    if (error?.response?.status !== 404) throw error;
    return playlistVideoIds(uploadsPlaylistId);
  }
};

/** Live beats upcoming; among live, the most recently started; among
 *  upcoming, the soonest within the horizon. */
const pickBroadcast = (videos: any[], now: Date): Broadcast | null => {
  const broadcasts: Broadcast[] = [];

  for (const video of videos) {
    const videoId = typeof video?.id === "string" ? video.id : "";
    const content = video?.snippet?.liveBroadcastContent;
    const details = video?.liveStreamingDetails || {};
    if (!videoId || (content !== "live" && content !== "upcoming")) continue;
    if (parseDate(details.actualEndTime)) continue;

    const scheduledStartAt = parseDate(details.scheduledStartTime);
    if (content === "upcoming") {
      if (!scheduledStartAt) continue;
      const offset = scheduledStartAt.getTime() - now.getTime();
      if (offset < -UPCOMING_OVERDUE_MS || offset > UPCOMING_HORIZON_MS) continue;
    }

    broadcasts.push({
      status: content === "live" ? "LIVE" : "UPCOMING",
      videoId,
      title: String(video?.snippet?.title || "Live service").slice(0, 255),
      thumbnailUrl: pickThumbnail(video?.snippet?.thumbnails),
      scheduledStartAt,
      actualStartAt: parseDate(details.actualStartTime),
    });
  }

  const live = broadcasts
    .filter((item) => item.status === "LIVE")
    .sort((a, b) => (b.actualStartAt?.getTime() ?? 0) - (a.actualStartAt?.getTime() ?? 0));
  if (live.length) return live[0];

  const upcoming = broadcasts
    .filter((item) => item.status === "UPCOMING")
    .sort((a, b) => (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0));
  return upcoming[0] ?? null;
};

const fetchCurrentBroadcast = async (now: Date): Promise<Broadcast | null> => {
  const ids = await candidateVideoIds();
  if (!ids.length) return null;

  const body = await youtubeGet("videos", {
    part: "snippet,liveStreamingDetails",
    id: ids.join(","),
  });
  return pickBroadcast(Array.isArray(body.items) ? body.items : [], now);
};

const nextCheckDelay = (broadcast: Broadcast | null, now: Date): number => {
  if (broadcast?.status === "LIVE") return LIVE_INTERVAL_MS;
  if (broadcast?.status === "UPCOMING" && broadcast.scheduledStartAt) {
    const offset = broadcast.scheduledStartAt.getTime() - now.getTime();
    if (offset <= IMMINENT_BEFORE_MS && offset >= -IMMINENT_AFTER_MS) {
      return IMMINENT_INTERVAL_MS;
    }
    // Wake for the imminent window instead of sleeping through its start.
    if (offset > IMMINENT_BEFORE_MS) {
      return Math.max(IMMINENT_INTERVAL_MS, Math.min(IDLE_INTERVAL_MS, offset - IMMINENT_BEFORE_MS));
    }
  }
  return IDLE_INTERVAL_MS;
};

const errorMessageOf = (error: any): string => {
  const reason = error?.response?.data?.error?.errors?.[0]?.reason;
  const message = error?.response?.data?.error?.message || error?.message || String(error);
  return String(reason ? `${reason}: ${message}` : message).slice(0, 1024);
};

/**
 * Push "we're live" once per broadcast. The conditional update is the claim:
 * only the process whose update matched sends, so two app instances running
 * the cron (or a restart mid-send) cannot notify twice.
 */
const notifyIfNewlyLive = async (broadcast: Broadcast, now: Date): Promise<void> => {
  if (broadcast.status !== "LIVE") return;

  const startedAt = broadcast.actualStartAt ?? now;
  const tooOld = now.getTime() - startedAt.getTime() > NOTIFY_MAX_AGE_MS;

  const claim = await prisma.live_stream_state.updateMany({
    where: {
      id: STATE_ID,
      OR: [{ notified_video_id: null }, { notified_video_id: { not: broadcast.videoId } }],
    },
    data: {
      notified_video_id: broadcast.videoId,
      notified_at: now,
    },
  });
  if (claim.count !== 1 || tooOld) return;

  const result = await notificationDeviceService.broadcastExpoPush({
    id: `livestream:${broadcast.videoId}`,
    type: LIVE_STREAM_NOTIFICATION_TYPE,
    title: "We're live on YouTube",
    body: broadcast.title,
    actionUrl: "/member/watch",
    entityType: "LIVE_STREAM",
    entityId: broadcast.videoId,
    priority: "HIGH",
  });
  console.info(
    `[INFO] Live stream notification: video=${broadcast.videoId} sent=${result.sent} failed=${result.failed}`,
  );
};

/**
 * One cron tick: does nothing until `next_check_at`, then asks YouTube,
 * stores the answer and schedules the next check.
 */
const refreshLiveStreamState = async (): Promise<{ checked: boolean; status?: LiveStreamStatus }> => {
  const now = new Date();
  const state = await prisma.live_stream_state.findUnique({ where: { id: STATE_ID } });
  if (state?.next_check_at && state.next_check_at > now) {
    return { checked: false };
  }

  let broadcast: Broadcast | null;
  try {
    broadcast = await fetchCurrentBroadcast(now);
  } catch (error) {
    const lastError = errorMessageOf(error);
    await prisma.live_stream_state.upsert({
      where: { id: STATE_ID },
      create: { id: STATE_ID, last_error: lastError, next_check_at: new Date(now.getTime() + ERROR_INTERVAL_MS) },
      update: { last_error: lastError, next_check_at: new Date(now.getTime() + ERROR_INTERVAL_MS) },
    });
    throw new Error(`YouTube live check failed: ${lastError}`);
  }

  const data = {
    status: (broadcast?.status ?? "OFFLINE") as LiveStreamStatus,
    video_id: broadcast?.videoId ?? null,
    title: broadcast?.title ?? null,
    thumbnail_url: broadcast?.thumbnailUrl ?? null,
    scheduled_start_at: broadcast?.scheduledStartAt ?? null,
    actual_start_at: broadcast?.actualStartAt ?? null,
    checked_at: now,
    next_check_at: new Date(now.getTime() + nextCheckDelay(broadcast, now)),
    last_error: null,
  };
  await prisma.live_stream_state.upsert({
    where: { id: STATE_ID },
    create: { id: STATE_ID, ...data },
    update: data,
  });
  invalidateStatusCache();

  if (broadcast) {
    await notifyIfNewlyLive(broadcast, now);
  }

  return { checked: true, status: data.status };
};

const OFFLINE_PAYLOAD = (checkedAt: Date | null): LiveStreamPayload => ({
  status: "offline",
  videoId: null,
  title: null,
  thumbnailUrl: null,
  youtubeUrl: null,
  scheduledStartAt: null,
  actualStartAt: null,
  checkedAt: checkedAt ? checkedAt.toISOString() : null,
});

let statusCache: { at: number; row: Awaited<ReturnType<typeof readState>> } | null = null;

const readState = () => prisma.live_stream_state.findUnique({ where: { id: STATE_ID } });

const invalidateStatusCache = () => {
  statusCache = null;
};

/** The current broadcast for the app. Stale or overdue rows read as offline. */
const getLiveStreamStatus = async (): Promise<LiveStreamPayload> => {
  const nowMs = Date.now();
  if (!statusCache || nowMs - statusCache.at > STATUS_CACHE_MS) {
    statusCache = { at: nowMs, row: await readState() };
  }
  const row = statusCache.row;

  if (!row || !row.video_id || row.status === "OFFLINE") {
    return OFFLINE_PAYLOAD(row?.checked_at ?? null);
  }
  if (!row.checked_at || nowMs - row.checked_at.getTime() > STALE_AFTER_MS) {
    return OFFLINE_PAYLOAD(row.checked_at ?? null);
  }
  if (
    row.status === "UPCOMING" &&
    row.scheduled_start_at &&
    nowMs - row.scheduled_start_at.getTime() > UPCOMING_OVERDUE_MS
  ) {
    return OFFLINE_PAYLOAD(row.checked_at);
  }

  return {
    status: row.status === "LIVE" ? "live" : "upcoming",
    videoId: row.video_id,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    youtubeUrl: `https://www.youtube.com/watch?v=${row.video_id}`,
    scheduledStartAt: row.scheduled_start_at ? row.scheduled_start_at.toISOString() : null,
    actualStartAt: row.actual_start_at ? row.actual_start_at.toISOString() : null,
    checkedAt: row.checked_at.toISOString(),
  };
};

export const liveStreamService = {
  refreshLiveStreamState,
  getLiveStreamStatus,
};
