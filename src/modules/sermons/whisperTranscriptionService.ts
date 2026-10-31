// Produces and stores a sermon transcript, free path first.
//
//   transcribeVideo(id):
//     1. already stored?            → return it (nothing fetched, nothing billed)
//     2. free YouTube captions?     → store + return  (captionFetchService)
//     3. otherwise Whisper fallback → download audio, chunk, transcribe, store
//
// The Whisper fallback: yt-dlp pulls the audio downmixed to 16kHz mono 48kbps
// mp3; ffmpeg splits it into ≤10-minute chunks (Whisper caps uploads at 25MB; a
// 10-min 48kbps mono chunk is ~3.6MB); each chunk is transcribed with segment
// timestamps and the chunk's start time is added back so offsets are global.
//
// The OpenAI key is resolved through AiCredentialService, so it honours the same
// env-override-then-DB precedence as the rest of the AI module (OPENAI_API_KEY).
//
// Host requirements: yt-dlp + ffmpeg on PATH, and CA certs for yt-dlp's TLS
// (see ytdlp.ts). The node:18-alpine deploy image needs `apk add ffmpeg
// ca-certificates` plus a yt-dlp install.

import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import { AiCredentialService } from "../ai/aiCredentialService";
import { fetchAutoCaptions } from "./captionFetchService";
import { writeTranscript, readTranscript, type TranscriptSource } from "./sermonTranscriptStore";
import type { TranscriptSegment } from "./sermonTranscriptService";
import { ytDlp } from "./ytdlp";

const CHUNK_SECONDS = Number(process.env.WHISPER_CHUNK_SECONDS || 600);
// whisper-1 is the model that returns segment timestamps via verbose_json; the
// gpt-4o transcribe models do not, so timestamps would be lost if swapped in.
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const FFMPEG_CMD = process.env.FFMPEG_CMD || "ffmpeg";
// Hard ceiling so a mis-click can't transcribe a 6-hour stream and run up a bill.
const MAX_DURATION_SECONDS = Number(process.env.WHISPER_MAX_DURATION_SECONDS || 4 * 60 * 60);

export class TranscriptionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "TranscriptionError";
    this.statusCode = statusCode;
  }
}

const runFfmpeg = (args: string[], label: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(FFMPEG_CMD, args, { maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new TranscriptionError(`${label} failed: ${stderr || error.message}`));
      else resolve();
    });
  });

/** Rejects absurdly long videos before spending anything on them. */
const assertDurationOk = async (url: string): Promise<void> => {
  try {
    const out = await ytDlp(["--no-playlist", "--print", "%(duration)s", url], "yt-dlp duration probe");
    const seconds = Number(String(out).trim());
    if (Number.isFinite(seconds) && seconds > MAX_DURATION_SECONDS) {
      throw new TranscriptionError(
        `Video is ${Math.round(seconds / 60)} min, over the ${Math.round(
          MAX_DURATION_SECONDS / 60,
        )} min transcription limit`,
        413,
      );
    }
  } catch (error) {
    if (error instanceof TranscriptionError && error.statusCode === 413) throw error;
    // A probe failure is not fatal — proceed and let the download surface it.
  }
};

const downloadAudio = async (url: string, dir: string): Promise<string> => {
  await ytDlp(
    [
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--postprocessor-args",
      "ffmpeg:-ar 16000 -ac 1 -b:a 48k",
      "-o",
      path.join(dir, "audio.%(ext)s"),
      url,
    ],
    "yt-dlp audio download",
  );
  const file = path.join(dir, "audio.mp3");
  if (!fs.existsSync(file)) {
    throw new TranscriptionError("Audio download produced no file (video may be unavailable)");
  }
  return file;
};

const chunkAudio = async (file: string, dir: string): Promise<string[]> => {
  const pattern = path.join(dir, "chunk_%03d.mp3");
  await runFfmpeg(
    ["-i", file, "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-c", "copy", pattern],
    "ffmpeg chunking",
  );
  return fs
    .readdirSync(dir)
    .filter((name) => /^chunk_\d+\.mp3$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
};

const transcribeChunk = async (
  openai: OpenAI,
  file: string,
  startOffset: number,
): Promise<TranscriptSegment[]> => {
  const result: any = await openai.audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: TRANSCRIBE_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = Array.isArray(result?.segments) ? result.segments : [];
  return segments
    .map((seg: any) => ({
      text: String(seg?.text ?? "").trim(),
      offset: startOffset + (Number(seg?.start) || 0),
      duration: Math.max(0, (Number(seg?.end) || 0) - (Number(seg?.start) || 0)),
    }))
    .filter((seg: TranscriptSegment) => seg.text.length > 0);
};

const getOpenAI = async (): Promise<OpenAI> => {
  const credential = await new AiCredentialService().getActiveCredential("openai");
  return new OpenAI({ apiKey: credential.api_key });
};

/** The paid fallback: audio → chunks → Whisper. No store/cache logic. */
const runWhisper = async (videoId: string): Promise<TranscriptSegment[]> => {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  await assertDurationOk(url);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sermon-${videoId}-`));
  try {
    const openai = await getOpenAI();
    const audio = await downloadAudio(url, dir);
    const chunks = await chunkAudio(audio, dir);
    if (chunks.length === 0) throw new TranscriptionError("Audio chunking produced no segments");

    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      segments.push(...(await transcribeChunk(openai, chunks[i], i * CHUNK_SECONDS)));
    }
    return segments;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export type TranscribeResult = {
  video_id: string;
  segments: TranscriptSegment[];
  cached: boolean;
  source: TranscriptSource;
  model: string;
};

/**
 * Ensures a transcript exists for a video and returns it. Tries the stored copy,
 * then free YouTube captions, then Whisper. `cached` is true when it was already
 * on disk (nothing fetched, nothing billed).
 */
export const transcribeVideo = async (
  videoId: string,
  options: { force?: boolean; captionsOnly?: boolean } = {},
): Promise<TranscribeResult> => {
  const id = String(videoId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    throw new TranscriptionError("Invalid YouTube video id", 400);
  }

  if (!options.force) {
    const existing = await readTranscript(id);
    if (existing) {
      return {
        video_id: id,
        segments: existing.segments,
        cached: true,
        source: existing.source,
        model: existing.model,
      };
    }
  }

  // 1. Free path: existing YouTube captions.
  const captions = await fetchAutoCaptions(id);
  if (captions.length > 0) {
    await writeTranscript(id, captions, "captions", "youtube");
    return { video_id: id, segments: captions, cached: false, source: "captions", model: "youtube" };
  }

  // The free path missed. Callers that must not spend credit (the batch cron)
  // stop here rather than fall through to the paid model.
  if (options.captionsOnly) {
    throw new TranscriptionError("No captions available and Whisper is disabled for this run", 422);
  }

  // 2. Paid fallback: Whisper.
  const segments = await runWhisper(id);
  if (segments.length === 0) throw new TranscriptionError("Transcription returned no speech");
  await writeTranscript(id, segments, "whisper", TRANSCRIBE_MODEL);
  return { video_id: id, segments, cached: false, source: "whisper", model: TRANSCRIBE_MODEL };
};
