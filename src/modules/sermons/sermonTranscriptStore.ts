// Where transcribed sermon captions live between requests.
//
// Whisper transcription costs money and taking it is slow, so a transcript must
// be computed once and kept. Transcripts are stored in the `sermon_transcript`
// table, keyed by YouTube video id (sermons on mobile come straight from
// YouTube, so there is no sermon row to hang them off). `segments` is the JSON
// array of { text, offset, duration } cues.

import { prisma } from "../../Models/context";
import type { TranscriptSegment } from "./sermonTranscriptService";

export type TranscriptSource = "captions" | "whisper";

export type StoredTranscript = {
  video_id: string;
  segments: TranscriptSegment[];
  /** "captions" (free YouTube track) or "whisper" (OpenAI fallback). */
  source: TranscriptSource;
  /** The caption language or the Whisper model name. */
  model: string;
  created_at: string;
};

// YouTube ids are [A-Za-z0-9_-]{11}; validate anyway so nothing odd reaches the
// store as a key.
const safeId = (videoId: string): string | null => {
  const id = String(videoId || "").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
};

export const hasTranscript = async (videoId: string): Promise<boolean> => {
  const id = safeId(videoId);
  if (!id) return false;
  const row = await prisma.sermon_transcript.findUnique({
    where: { video_id: id },
    select: { video_id: true },
  });
  return Boolean(row);
};

export const readTranscript = async (videoId: string): Promise<StoredTranscript | null> => {
  const id = safeId(videoId);
  if (!id) return null;
  const row = await prisma.sermon_transcript.findUnique({ where: { video_id: id } });
  if (!row) return null;
  const segments = Array.isArray(row.segments) ? (row.segments as unknown as TranscriptSegment[]) : [];
  return {
    video_id: row.video_id,
    segments,
    source: row.source as TranscriptSource,
    model: row.model,
    created_at: row.created_at.toISOString(),
  };
};

export const writeTranscript = async (
  videoId: string,
  segments: TranscriptSegment[],
  source: TranscriptSource,
  model: string,
): Promise<StoredTranscript> => {
  const id = safeId(videoId);
  if (!id) throw new Error(`Invalid video id: ${videoId}`);
  // Prisma needs the segment objects as a plain JSON value.
  const segmentsJson = segments as unknown as object;
  const row = await prisma.sermon_transcript.upsert({
    where: { video_id: id },
    create: { video_id: id, segments: segmentsJson, source, model },
    update: { segments: segmentsJson, source, model },
  });
  return {
    video_id: row.video_id,
    segments,
    source,
    model,
    created_at: row.created_at.toISOString(),
  };
};

export const listTranscribed = async (): Promise<string[]> => {
  const rows = await prisma.sermon_transcript.findMany({ select: { video_id: true } });
  return rows.map((row) => row.video_id);
};
