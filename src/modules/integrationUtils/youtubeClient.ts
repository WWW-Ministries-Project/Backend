import axios from "axios";

/*
  Shared YouTube Data API client.

  One HTTP client used by both live-stream detection and the sermon ingest
  feature, so the key's referer workaround and request handling live in one
  place rather than being copied per feature.
*/

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 10 * 1000;

export const youtubeConfig = () => {
  const channelId = (process.env.YOUTUBE_CHANNEL_ID || "UCEdXLYbtPZFk1wXrOKBX0qw").trim();
  return {
    apiKey: (process.env.YOUTUBE_API_KEY || "").trim(),
    referer: (process.env.YOUTUBE_API_REFERER || "").trim(),
    channelId,
    // UU… is the channel's full uploads playlist; UULV… the Live tab only;
    // UULF… the Videos tab (regular uploads, excluding shorts/live).
    liveTabPlaylistId: `UULV${channelId.slice(2)}`,
    uploadsPlaylistId: `UU${channelId.slice(2)}`,
    videosTabPlaylistId: `UULF${channelId.slice(2)}`,
  };
};

export const isYoutubeConfigured = (): boolean => Boolean(youtubeConfig().apiKey);

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

export const youtubeGet = async (
  path: string,
  params: Record<string, string>,
): Promise<Record<string, any>> => {
  const { apiKey, referer } = youtubeConfig();
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
