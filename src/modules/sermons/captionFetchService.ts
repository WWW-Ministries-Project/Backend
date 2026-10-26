// The free transcript path: fetch a YouTube video's existing captions.
//
// yt-dlp downloads the English subtitle track (manual if present, else the
// auto-generated one) as WebVTT — no OpenAI cost, no 25MB limit, and it handles
// the proof-of-origin token that broke plain HTTP scraping. We then parse the
// VTT into the same TranscriptSegment shape Whisper produces.
//
// Returns [] when the video has no English captions; the caller then falls back
// to Whisper. Never throws for the "no captions" case — only genuine tool
// failures propagate.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ytDlp } from "./ytdlp";
import type { TranscriptSegment } from "./sermonTranscriptService";

const SUB_LANGS = process.env.SERMON_SUB_LANGS || "en,en-US,en-GB,en-orig";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });

/** "00:01:36.941" / "01:36.941" → seconds. */
const parseTimestamp = (value: string): number => {
  const parts = value.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

/** Strips VTT inline markup (`<00:00:01.000>`, `<c>…</c>`) and decodes entities. */
const cleanCueText = (lines: string[]): string =>
  decodeEntities(
    lines
      .join(" ")
      .replace(/<[^>]+>/g, "") // inline timestamp + <c> tags
      .replace(/^\s*&gt;&gt;\s*/g, "") // leftover speaker arrows
      .replace(/\s+/g, " "),
  ).trim();

/**
 * Parses WebVTT into segments. YouTube auto-captions scroll, so consecutive
 * cues repeat the same words; we drop a cue whose text duplicates, or is wholly
 * contained in, the previously kept one. Exported for tests.
 */
export const parseVtt = (vtt: string): TranscriptSegment[] => {
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  const segments: TranscriptSegment[] = [];
  let lastText = "";

  for (const block of blocks) {
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex === -1) continue; // header / NOTE / styling block

    const timeMatch = lines[timeLineIndex].match(
      /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*((\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/,
    );
    if (!timeMatch) continue;
    const startRaw = lines[timeLineIndex].split("-->")[0].trim().replace(",", ".");
    const endRaw = timeMatch[2].replace(",", ".");
    const offset = parseTimestamp(startRaw);
    const duration = Math.max(0, parseTimestamp(endRaw) - offset);

    const text = cleanCueText(lines.slice(timeLineIndex + 1));
    if (!text || text === "[music]") continue;

    // Scroll-dedupe: skip exact repeats and prefix-contained fragments.
    if (text === lastText) continue;
    if (lastText && lastText.includes(text)) continue;
    if (lastText && text.startsWith(lastText)) {
      // This cue extends the previous one — replace rather than append.
      segments[segments.length - 1] = { text, offset: segments[segments.length - 1].offset, duration };
      lastText = text;
      continue;
    }

    segments.push({ text, offset, duration });
    lastText = text;
  }

  return segments;
};

/** Fetches and parses English captions for a video, or [] if none exist. */
export const fetchAutoCaptions = async (videoId: string): Promise<TranscriptSegment[]> => {
  const id = String(videoId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return [];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `caps-${id}-`));
  try {
    await ytDlp(
      [
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        SUB_LANGS,
        "--sub-format",
        "vtt",
        "--skip-download",
        "--no-playlist",
        "-o",
        path.join(dir, "sub"),
        `https://www.youtube.com/watch?v=${id}`,
      ],
      "yt-dlp caption fetch",
    );

    const vttFile = fs.readdirSync(dir).find((name) => name.endsWith(".vtt"));
    if (!vttFile) return [];
    return parseVtt(fs.readFileSync(path.join(dir, vttFile), "utf8"));
  } catch {
    // Any failure here is treated as "no captions" — Whisper is the fallback.
    return [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
