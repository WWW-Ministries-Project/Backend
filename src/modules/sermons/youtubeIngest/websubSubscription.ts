import axios from "axios";
import { youtubeConfig } from "../../integrationUtils/youtubeClient";

const HUB = (process.env.YOUTUBE_WEBSUB_HUB || "https://pubsubhubbub.appspot.com/subscribe").trim();
const CALLBACK = (process.env.YOUTUBE_WEBSUB_CALLBACK_URL || "").trim();
const SECRET = (process.env.YOUTUBE_WEBSUB_SECRET || "").trim();
const LEASE = String(Number(process.env.YOUTUBE_WEBSUB_LEASE_SECONDS || 432000));

export const isWebsubConfigured = (): boolean => Boolean(CALLBACK && SECRET);

/** (Re)subscribe to the channel's upload feed. Idempotent — a repeat is a lease renewal. */
export const subscribeToChannelFeed = async (
  mode: "subscribe" | "unsubscribe" = "subscribe",
): Promise<void> => {
  const { channelId } = youtubeConfig();
  const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
  const form = new URLSearchParams({
    "hub.callback": CALLBACK,
    "hub.topic": topic,
    "hub.mode": mode,
    "hub.verify": "async",
    "hub.secret": SECRET,
    "hub.lease_seconds": LEASE,
  });
  await axios.post(HUB, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10 * 1000,
  });
};
