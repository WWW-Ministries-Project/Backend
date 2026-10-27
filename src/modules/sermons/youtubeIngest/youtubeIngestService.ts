import { notificationService } from "../../notifications/notificationService";
import { listUserIdsWithDomainPermission } from "../../../middleWare/authorization";
import { ingestNotificationDedupeKey } from "./websub";
import { youtubeGet, youtubeConfig } from "../../integrationUtils/youtubeClient";
import { classifyVideo } from "./videoClassification";
import { mapVideoToSermonFields } from "./videoMapping";
import { sermonService } from "../sermonService";

// Deep link into the dashboard sermon manager (frontend route).
const SERMON_MANAGE_URL = "/home/communication/sermons";

/** Notify every sermon manager (Sermons manage permission) that a sermon was
 *  imported — inbox + email + web push, one per video, deduped per recipient. */
export const notifySermonManagers = async (sermon: { id: number; title: string; video_id: string }): Promise<void> => {
  const recipientUserIds = await listUserIdsWithDomainPermission("Sermons", "manage");
  if (!recipientUserIds.length) return;
  await notificationService.createManyInAppNotifications(
    recipientUserIds.map((recipientUserId) => ({
      type: "sermon.ingested",
      title: "New sermon imported",
      body: `"${sermon.title}" was imported from YouTube. Tap to review or edit it.`,
      recipientUserId,
      entityType: "sermon",
      entityId: String(sermon.id),
      actionUrl: SERMON_MANAGE_URL,
      priority: "MEDIUM",
      sendPush: true,
      sendEmail: true,
      emailSubject: "New sermon imported",
      dedupeKey: ingestNotificationDedupeKey(sermon.video_id, recipientUserId),
    })),
  );
};

export type IngestResult = { status: "ingested" | "skipped-existing" | "skipped-shorts-or-live" | "not-found" };

/** Fetch one video's full metadata, skip Shorts/live, ingest + notify.
 *  Idempotent: an already-ingested video_id short-circuits before any write. */
export const ingestVideoById = async (
  videoId: string,
  opts: { notify?: boolean } = {},
): Promise<IngestResult> => {
  const body = await youtubeGet("videos", {
    part: "snippet,contentDetails,liveStreamingDetails,status",
    id: videoId,
  });
  const resource = Array.isArray(body.items) ? body.items[0] : undefined;
  if (!resource) return { status: "not-found" };
  if (resource.snippet?.channelId && resource.snippet.channelId !== youtubeConfig().channelId) {
    return { status: "skipped-shorts-or-live" };
  }
  if (resource.status?.privacyStatus && resource.status.privacyStatus !== "public") {
    return { status: "skipped-shorts-or-live" };
  }
  if (classifyVideo(resource) !== "video") return { status: "skipped-shorts-or-live" };

  const fields = mapVideoToSermonFields(resource);
  const { sermon, created } = await sermonService.ingestSermon(fields);
  if (!created) return { status: "skipped-existing" };

  if (opts.notify !== false) {
    await notifySermonManagers({ id: Number(sermon.id), title: sermon.title, video_id: fields.video_id });
  }
  return { status: "ingested" };
};
