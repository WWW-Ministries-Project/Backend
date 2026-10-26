// Bulk-transcribes the channel's recent sermons so search has something to find.
//
// The mobile app's sermons come straight from YouTube, so the backend has no
// list of them. We read the channel's public RSS feed (free, no API key — the
// same feed yt-dlp and the website could use) for the most recent video ids,
// then transcribe each one that is not already stored.
//
// By default this is the FREE path only (captionsOnly): it never spends OpenAI
// credit. Whisper is used as a fallback for uncaptioned videos only when
// explicitly allowed, so an unattended cron can't run up a bill.

import { hasTranscript } from "./sermonTranscriptStore";
import { transcribeVideo } from "./whisperTranscriptionService";
import type { TranscriptSource } from "./sermonTranscriptStore";

const CHANNEL_ID = process.env.SERMON_YOUTUBE_CHANNEL_ID || "UCEdXLYbtPZFk1wXrOKBX0qw";
const DEFAULT_LIMIT = Number(process.env.SERMON_TRANSCRIBE_BATCH_LIMIT || 15);
const ALLOW_WHISPER = ["true", "1", "yes"].includes(
  String(process.env.SERMON_TRANSCRIBE_ALLOW_WHISPER ?? "false").trim().toLowerCase(),
);

export type BatchItemResult = {
  video_id: string;
  status: "transcribed" | "cached" | "skipped" | "failed";
  source?: TranscriptSource;
  error?: string;
};

export type BatchSummary = {
  checked: number;
  transcribed: number;
  cached: number;
  skipped: number;
  failed: number;
  items: BatchItemResult[];
};

/** The channel's most recent video ids, newest first, from its RSS feed. */
export const fetchRecentChannelVideoIds = async (limit: number): Promise<string[]> => {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  if (!res.ok) throw new Error(`Channel feed responded ${res.status}`);
  const xml = await res.text();
  const ids = [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map((m) => m[1]);
  return Array.from(new Set(ids)).slice(0, Math.max(1, limit));
};

/**
 * Transcribes recent channel videos not already stored. Sequential on purpose —
 * this runs in the background and each item shells out to yt-dlp. Never throws
 * per item; failures are recorded and the run continues.
 */
export const batchTranscribeRecent = async (
  options: { limit?: number; allowWhisper?: boolean } = {},
): Promise<BatchSummary> => {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const allowWhisper = options.allowWhisper ?? ALLOW_WHISPER;
  const ids = await fetchRecentChannelVideoIds(limit);

  const items: BatchItemResult[] = [];
  for (const id of ids) {
    if (await hasTranscript(id)) {
      items.push({ video_id: id, status: "cached" });
      continue;
    }
    try {
      const result = await transcribeVideo(id, { captionsOnly: !allowWhisper });
      items.push({ video_id: id, status: "transcribed", source: result.source });
    } catch (error) {
      // 422 = no captions and Whisper was off for this run: a skip, not a failure.
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 422) {
        items.push({ video_id: id, status: "skipped" });
      } else {
        items.push({ video_id: id, status: "failed", error: (error as Error).message });
      }
    }
  }

  return {
    checked: items.length,
    transcribed: items.filter((i) => i.status === "transcribed").length,
    cached: items.filter((i) => i.status === "cached").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    failed: items.filter((i) => i.status === "failed").length,
    items,
  };
};
