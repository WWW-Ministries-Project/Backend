export type VideoKind = "video" | "short" | "live";
export const parseIsoDurationSeconds = (iso: string | undefined): number => {
  if (!iso) return 0;
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
};
const SHORT_MAX_SECONDS = 60;
export const classifyVideo = (resource: {
  contentDetails?: { duration?: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string };
}): VideoKind => {
  const live = resource.liveStreamingDetails;
  if (live) {
    const currentlyLive = Boolean(live.actualStartTime) && !live.actualEndTime;
    const upcoming = Boolean(live.scheduledStartTime) && !live.actualStartTime;
    if (currentlyLive || upcoming) return "live";
    // finished broadcast (actualEndTime set) falls through to normal duration logic
  }
  const seconds = parseIsoDurationSeconds(resource.contentDetails?.duration);
  if (seconds > 0 && seconds <= SHORT_MAX_SECONDS) return "short";
  return "video";
};
