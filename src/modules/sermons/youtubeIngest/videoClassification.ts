export type VideoKind = "video" | "short" | "live";
export const parseIsoDurationSeconds = (iso: string | undefined): number => {
  if (!iso) return 0;
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
};
const SHORT_MAX_SECONDS = 60;
export const classifyVideo = (resource: { contentDetails?: { duration?: string }; liveStreamingDetails?: unknown; }): VideoKind => {
  if (resource.liveStreamingDetails) return "live";
  const seconds = parseIsoDurationSeconds(resource.contentDetails?.duration);
  if (seconds > 0 && seconds <= SHORT_MAX_SECONDS) return "short";
  return "video";
};
