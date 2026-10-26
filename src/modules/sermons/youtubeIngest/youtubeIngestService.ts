import { notificationService } from "../../notifications/notificationService";
import { listUserIdsWithDomainPermission } from "../../../middleWare/authorization";
import { ingestNotificationDedupeKey } from "./websub";

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
