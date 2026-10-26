import Router from "express";
import express from "express";
import { parseFeedEntry, verifyHubSignature } from "./websub";
import { ingestVideoById } from "./youtubeIngestService";
import { youtubeConfig } from "../../integrationUtils/youtubeClient";

const router = Router();
const WEBSUB_SECRET = (process.env.YOUTUBE_WEBSUB_SECRET || "").trim();

// GET: hub verification handshake. Echo hub.challenge ONLY for our channel's
// topic and a mode we asked for; otherwise 404.
router.get("/", (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const topic = String(req.query["hub.topic"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  const { channelId } = youtubeConfig();
  const expectedTopic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
  if ((mode === "subscribe" || mode === "unsubscribe") && topic === expectedTopic && challenge) {
    return res.status(200).type("text/plain").send(challenge);
  }
  return res.status(404).end();
});

// POST: content delivery. Route-scoped text parser (global express.json won't
// parse atom+xml); verify HMAC over the raw string before processing.
router.post(
  "/",
  express.text({ type: ["application/atom+xml", "application/xml", "text/xml"] }),
  async (req, res) => {
    const rawBody = typeof req.body === "string" ? req.body : "";
    const signatureHeader = req.headers["x-hub-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifyHubSignature(rawBody, signature, WEBSUB_SECRET)) {
      return res.status(202).end(); // ack so the hub stops retrying; do not process
    }
    res.status(204).end(); // ack immediately; ingest async so a slow YouTube call can't time out the hub
    const entry = parseFeedEntry(rawBody);
    if (!entry) return;
    try {
      await ingestVideoById(entry.videoId);
    } catch (error) {
      console.error(`[ERROR] YouTube ingest failed for ${entry.videoId}:`, error);
    }
  },
);

export default router;
