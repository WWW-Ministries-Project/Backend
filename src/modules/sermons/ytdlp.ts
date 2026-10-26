// Shared subprocess helpers for the transcript pipeline.
//
// Both the free caption path (captionFetchService) and the Whisper fallback
// (whisperTranscriptionService) shell out to yt-dlp, so the invocation lives
// here once. `YTDLP_CMD` may carry args ("python3 -m yt_dlp" from a pip
// install); `run` is a thin promisified execFile.
//
// Host note: yt-dlp uses the system Python's TLS trust store. On a box whose
// Python lacks CA certs (common on macOS) set SSL_CERT_FILE to a certifi bundle,
// or yt-dlp fails with CERTIFICATE_VERIFY_FAILED. The deploy image must install
// ca-certificates (and ffmpeg + yt-dlp).

import { execFile } from "child_process";

const YTDLP_CMD = process.env.YTDLP_CMD || "python3 -m yt_dlp";

export const run = (cmd: string, args: string[], label: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${label} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout.toString());
    });
  });

/** Splits a possibly multi-token command ("python3 -m yt_dlp") into argv parts. */
const splitCmd = (cmd: string): [string, string[]] => {
  const parts = cmd.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
};

export const ytDlp = (args: string[], label: string): Promise<string> => {
  const [cmd, pre] = splitCmd(YTDLP_CMD);
  return run(cmd, [...pre, ...args], label);
};
