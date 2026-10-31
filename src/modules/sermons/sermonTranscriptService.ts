// Spoken-word search over sermon videos.
//
// Sermons on the mobile app come straight from the church's YouTube channel, so
// there is no transcript in our database to search. We transcribe each video
// once with OpenAI Whisper (see whisperTranscriptionService), persist the
// result (see sermonTranscriptStore), and this module runs a keyword match over
// the stored transcript so a member can find the message where a word was
// actually *said*, not only where it appears in the title.
//
// This module is network-free and cheap: it only reads already-stored
// transcripts and matches in memory. A video that has not been transcribed yet
// simply yields no match. The matcher (`matchTranscript`) is pure and unit
// tested; the store swap (disk → DB) and the transcription cost both live
// behind other modules.

import { readTranscript } from "./sermonTranscriptStore";

export type TranscriptSegment = {
  /** The spoken text of this cue. */
  text: string;
  /** Seconds from the start of the video — the deep-link / seek target. */
  offset: number;
  /** How long the cue runs, seconds. */
  duration: number;
};

export type TranscriptMatch = {
  video_id: string;
  /** A window of transcript text around the match, for display. */
  snippet: string;
  /** Seconds into the video where the match starts — for seek-on-tap. */
  offset: number;
  /** How many times the query was found in the transcript. */
  count: number;
};

/** Cap per request so one search can't scan an unbounded number of videos. */
const MAX_VIDEOS_PER_SEARCH = 50;
/** Characters of context to show on each side of a match. */
const SNIPPET_PAD = 60;

// ── Matching (pure) ──────────────────────────────────────────────────────────

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Builds one lowercase haystack plus, per character, the segment offset it
 *  belongs to — so a char hit maps back to a seek time. */
const buildIndex = (segments: TranscriptSegment[]) => {
  let text = "";
  const offsetAt: number[] = [];
  for (const seg of segments) {
    const piece = normalize(seg.text);
    if (!piece) continue;
    if (text) {
      text += " ";
      offsetAt.push(seg.offset);
    }
    for (let c = 0; c < piece.length; c += 1) offsetAt.push(seg.offset);
    text += piece;
  }
  return { text, offsetAt };
};

const makeSnippet = (text: string, at: number, length: number): string => {
  const start = Math.max(0, at - SNIPPET_PAD);
  const end = Math.min(text.length, at + length + SNIPPET_PAD);
  const core = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
};

/**
 * Finds `query` inside a transcript. Pure and deterministic — this is the unit
 * under test. Tries the whole phrase first; if that misses, requires every
 * token to appear and anchors the snippet on the first one. Returns null when
 * nothing matches or the query is empty.
 */
export const matchTranscript = (
  segments: TranscriptSegment[],
  query: string,
): Omit<TranscriptMatch, "video_id"> | null => {
  const q = normalize(query);
  if (!q || segments.length === 0) return null;
  const { text, offsetAt } = buildIndex(segments);
  if (!text) return null;

  // Whole-phrase match: count every occurrence, anchor on the first.
  let from = text.indexOf(q);
  if (from !== -1) {
    const first = from;
    let count = 0;
    while (from !== -1) {
      count += 1;
      from = text.indexOf(q, from + q.length);
    }
    return { snippet: makeSnippet(text, first, q.length), offset: offsetAt[first] ?? 0, count };
  }

  // Token match: all tokens must be present somewhere; anchor on the earliest.
  const tokens = q.split(" ").filter(Boolean);
  let earliest = Infinity;
  for (const token of tokens) {
    const index = text.indexOf(token);
    if (index === -1) return null; // AND semantics — a missing token means no match.
    if (index < earliest) earliest = index;
  }
  if (earliest === Infinity) return null;
  return { snippet: makeSnippet(text, earliest, tokens[0].length), offset: offsetAt[earliest] ?? 0, count: 1 };
};

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Searches the spoken content of the given videos for `query`, reading each
 * one's stored transcript. Videos not yet transcribed, or with no match, are
 * omitted. Result order follows the input id order. Network-free.
 */
export const searchTranscripts = async (
  query: string,
  videoIds: string[],
): Promise<TranscriptMatch[]> => {
  const q = normalize(query);
  if (!q) return [];

  const ids = Array.from(
    new Set(videoIds.map((v) => String(v || "").trim()).filter(Boolean)),
  ).slice(0, MAX_VIDEOS_PER_SEARCH);

  const results = await Promise.all(
    ids.map(async (id) => {
      const stored = await readTranscript(id);
      if (!stored) return null;
      const match = matchTranscript(stored.segments, q);
      return match ? { video_id: id, ...match } : null;
    }),
  );
  return results.filter((r): r is TranscriptMatch => r !== null);
};
