import crypto from "node:crypto";
export type FeedEntry = { videoId: string; channelId: string; title?: string; published?: string };
const tag = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : undefined;
};
export const parseFeedEntry = (xml: string): FeedEntry | null => {
  const entryMatch = /<entry\b[\s\S]*?<\/entry>/.exec(xml);
  if (!entryMatch) return null;
  const entry = entryMatch[0];
  const videoId = tag(entry, "videoId");
  const channelId = tag(entry, "channelId");
  if (!videoId || !channelId) return null;
  return { videoId, channelId, title: tag(entry, "title"), published: tag(entry, "published") };
};
export const verifyHubSignature = (rawBody: string, header: string | undefined, secret: string): boolean => {
  if (!header || !secret) return false;
  const [algo, sent] = header.split("=");
  if (algo !== "sha1" || !sent) return false;
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(sent, "hex"); const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const ingestNotificationDedupeKey = (videoId: string, recipientUserId: number): string =>
  `sermon.ingested:video:${videoId}:recipient:${recipientUserId}`;
