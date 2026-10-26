import { Prisma } from "@prisma/client";
import client from "prom-client";
import { prisma } from "../../Models/context";
import { sendEmail } from "../../utils/emailService";
import { buildUnifiedEmailTemplate } from "../../utils/mail_templates/unifiedEmailTemplate";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import { systemNotificationSettingsService } from "../settings/systemNotificationSettingsService";
import {
  getNotificationPreferenceOption,
  isKnownNotificationType,
  listNotificationPreferenceTypes,
  type NotificationPreferenceChannelAvailability,
} from "./notificationPreferenceCatalog";
import { notificationPushService } from "./notificationPushService";
import { notificationDeviceService } from "./notificationDeviceService";
import { notificationSmsService } from "./notificationSmsService";
import { toUser as emitToUserSocket } from "../realtime/realtimeEmit";
import type { RealtimeEventMap, RealtimeEventName } from "../realtime/realtimeEvents";

export type NotificationPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const DATABASE_UNAVAILABLE_PATTERNS = [
  /can't reach database server/i,
  /\bp1001\b/i,
  /econnrefused/i,
  /etimedout/i,
  /server has closed the connection/i,
] as const;

// True when an error represents transient database-unreachability (infra blip,
// restart, network partition) rather than an actionable failure. Accepts either
// a thrown error or a pre-normalized message string.
const isDatabaseUnavailableError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return DATABASE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message));
};

type NotificationRow = {
  id: number;
  dedupe_key: string | null;
  type: string;
  title: string;
  body: string;
  recipient_user_id: number;
  actor_user_id: number | null;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  priority: NotificationPriority;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
};

export type NotificationPayload = {
  id: string;
  dedupeKey: string | null;
  type: string;
  title: string;
  body: string;
  recipientUserId: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  priority: NotificationPriority;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type CreateNotificationInput = {
  type: string;
  title: string;
  body: string;
  recipientUserId: number;
  actorUserId?: number | null;
  entityType?: string | null;
  entityId?: string | number | null;
  actionUrl?: string | null;
  priority?: NotificationPriority;
  dedupeKey?: string | null;
  emailSubject?: string;
  sendEmail?: boolean;
  sendSms?: boolean;
  smsBody?: string;
  /**
   * Part of a fan-out (one event, many recipients). Its email/push deliveries
   * wait in a separate lane behind one-to-one notifications, so a church-wide
   * post queued for hundreds of members can't hold up a ride being accepted.
   */
  bulk?: boolean;
  /**
   * Web/Expo push for the in-app row. Default true. False keeps the in-app
   * row (bell) but sends no push.
   */
  sendPush?: boolean;
  /**
   * The caller (an admin-configured policy, e.g. the appointment
   * notification matrix) decides email/SMS: `sendEmail`/`sendSms` are honoured
   * unless the recipient explicitly turned that channel off for this type.
   * Without it SMS also needs the recipient to have opted in.
   */
  channelsFromPolicy?: boolean;
};

type NotificationListArgs = {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
};

type NotificationListResult = {
  data: NotificationPayload[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

type NotificationPreference = {
  type: string;
  title: string;
  description: string;
  category: string;
  availableChannels: NotificationPreferenceChannelAvailability;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  hasStoredPreference: boolean;
};

export type NotificationPreferencePayload = NotificationPreference;

export type UpdateNotificationPreferenceInput = {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  smsEnabled?: boolean;
};

type NotificationPreferenceChannel = "inApp" | "email" | "sms";

type NotificationDeliveryTask = () => Promise<void>;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const ACTION_URL_FALLBACK = "/home/notifications";
const NOTIFICATION_DELIVERY_CONCURRENCY = (() => {
  const parsed = Number(process.env.NOTIFICATION_DELIVERY_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 2;
  }
  return Math.min(parsed, 10);
})();

const notificationDeliveryTaskQueue: NotificationDeliveryTask[] = [];
const bulkNotificationDeliveryTaskQueue: NotificationDeliveryTask[] = [];
let activeNotificationDeliveryWorkers = 0;

const getOrCreateCounter = (
  name: string,
  help: string,
  labelNames: string[],
): client.Counter<string> => {
  const existing = client.register.getSingleMetric(
    name,
  ) as client.Counter<string> | undefined;

  if (existing) {
    return existing;
  }

  return new client.Counter({
    name,
    help,
    labelNames,
  });
};

const getOrCreateGauge = (
  name: string,
  help: string,
): client.Gauge<string> => {
  const existing = client.register.getSingleMetric(
    name,
  ) as client.Gauge<string> | undefined;

  if (existing) {
    return existing;
  }

  return new client.Gauge({
    name,
    help,
  });
};

const notificationCreatedCounter = getOrCreateCounter(
  "in_app_notifications_created_total",
  "Count of in-app notifications created",
  ["type", "priority"],
);

const notificationReadCounter = getOrCreateCounter(
  "in_app_notifications_read_total",
  "Count of in-app notifications marked as read/unread",
  ["action"],
);

const notificationDeliveryFailureCounter = getOrCreateCounter(
  "in_app_notifications_delivery_failures_total",
  "Count of notification delivery failures by channel",
  ["channel", "type"],
);

const notificationEmailSentCounter = getOrCreateCounter(
  "in_app_notifications_email_sent_total",
  "Count of notification emails sent",
  ["type"],
);

const unreadBacklogGauge = getOrCreateGauge(
  "in_app_notifications_unread_backlog",
  "Current unread in-app notifications across users",
);

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const runNotificationDeliveryQueue = () => {
  while (activeNotificationDeliveryWorkers < NOTIFICATION_DELIVERY_CONCURRENCY) {
    // One-to-one deliveries first; the fan-out lane only gets idle workers.
    const task = notificationDeliveryTaskQueue.shift() ?? bulkNotificationDeliveryTaskQueue.shift();
    if (!task) {
      return;
    }

    activeNotificationDeliveryWorkers += 1;
    void task()
      .catch(() => {
        // Task handlers already emit delivery-failure metrics per channel.
      })
      .finally(() => {
        activeNotificationDeliveryWorkers -= 1;
        runNotificationDeliveryQueue();
      });
  }
};

const enqueueNotificationDelivery = (task: NotificationDeliveryTask, bulk = false) => {
  (bulk ? bulkNotificationDeliveryTaskQueue : notificationDeliveryTaskQueue).push(task);
  runNotificationDeliveryQueue();
};

const parseNotificationPriority = (value?: string | null): NotificationPriority =>
  value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL"
    ? value
    : "MEDIUM";

const normalizeActionUrl = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const isAbsoluteHttpUrl = (value: string): boolean =>
  /^https?:\/\//i.test(value);

const toAbsoluteActionUrl = (actionUrl: string | null): string | null => {
  if (!actionUrl) {
    return null;
  }

  if (isAbsoluteHttpUrl(actionUrl)) {
    return actionUrl;
  }

  const frontendBaseUrl = String(process.env.Frontend_URL || "").trim();
  if (!frontendBaseUrl) {
    return actionUrl;
  }

  const normalizedBaseUrl = frontendBaseUrl.replace(/\/+$/, "");
  const normalizedActionUrl = actionUrl.startsWith("/")
    ? actionUrl
    : `/${actionUrl}`;

  return `${normalizedBaseUrl}${normalizedActionUrl}`;
};

const toPayload = (row: NotificationRow): NotificationPayload => ({
  id: String(row.id),
  dedupeKey: row.dedupe_key,
  type: row.type,
  title: row.title,
  body: row.body,
  recipientUserId: String(row.recipient_user_id),
  actorUserId:
    row.actor_user_id !== null && row.actor_user_id !== undefined
      ? String(row.actor_user_id)
      : null,
  entityType: row.entity_type || null,
  entityId: row.entity_id || null,
  actionUrl: row.action_url || null,
  priority: parseNotificationPriority(row.priority),
  isRead: Boolean(row.is_read),
  readAt: row.read_at ? row.read_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

// Realtime delivery to the web dashboard is socket.io only. `event` strings
// must be keys of RealtimeEventMap (realtimeEvents.ts).
const broadcastToUser = (
  userId: number,
  event: RealtimeEventName,
  data: unknown,
) => {
  if (data && typeof data === "object") {
    emitToUserSocket(userId, event, data as RealtimeEventMap[RealtimeEventName]);
  }
};

// The gauge counts unread rows across every user, and every created or read
// notification asks for a refresh — so a 500-member fan-out used to run 500
// table-wide counts, un-awaited, against a 10-connection pool. A gauge only
// needs to be roughly current: one count in flight, at most every 30s.
const UNREAD_BACKLOG_REFRESH_MS = 30_000;
let unreadBacklogRefreshedAt = 0;

const updateUnreadBacklogMetric = async () => {
  const now = Date.now();
  if (now - unreadBacklogRefreshedAt < UNREAD_BACKLOG_REFRESH_MS) return;
  unreadBacklogRefreshedAt = now;
  try {
    const unreadCount = await prisma.in_app_notification.count({
      where: {
        is_read: false,
      },
    });
    unreadBacklogGauge.set(unreadCount);
  } catch (error) {
    // Metric update should never interrupt request flow.
  }
};

const parsePermissionsObject = (permissions: unknown): Record<string, unknown> => {
  if (!permissions) return {};

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return {};

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions);
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Record<string, unknown>;
      }
    } catch (error) {
      return {};
    }

    return {};
  }

  if (typeof permissions === "object" && !Array.isArray(permissions)) {
    return permissions as Record<string, unknown>;
  }

  return {};
};

// Automatic system/infra failure alerts (raw Prisma errors, pool exhaustion,
// etc.) must go only to platform admins — the same audience that can already
// manage the manual override at Settings > System Notifications
// (`Permissions.can_manage_settings` in src/middleWare/authorization.ts).
// This used to check for "Super_Admin" on ANY single domain, which also
// matches a business-domain admin (e.g. Super_Admin scoped only to
// Financials or Marketplace) — a department head, not a platform admin —
// and had been paging those staff with unreadable backend error text.
const SETTINGS_PERMISSION_KEYS = ["Settings", "Access_rights", "Access rights"];
const SETTINGS_MANAGE_VALUES = new Set(["Can_Manage", "Super_Admin"]);

const canManageSystemSettings = (permissions: unknown): boolean => {
  const permissionObject = parsePermissionsObject(permissions);
  return SETTINGS_PERMISSION_KEYS.some((key) => {
    const value = permissionObject[key];
    return typeof value === "string" && SETTINGS_MANAGE_VALUES.has(value);
  });
};

const normalizeNotificationType = (value: unknown): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new InputValidationError("Notification type is required");
  }

  return trimmed;
};

const toNotificationPreferencePayload = (
  notificationType: string,
  preference:
    | {
        in_app_enabled: boolean;
        email_enabled: boolean;
        sms_enabled: boolean;
      }
    | null,
): NotificationPreference => {
  const option = getNotificationPreferenceOption(notificationType);
  if (!preference) {
    return {
      type: notificationType,
      title: option.title,
      description: option.description,
      category: option.category,
      availableChannels: option.availableChannels,
      inAppEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      hasStoredPreference: false,
    };
  }

  return {
    type: notificationType,
    title: option.title,
    description: option.description,
    category: option.category,
    availableChannels: option.availableChannels,
    inAppEnabled: preference.in_app_enabled !== false,
    emailEnabled: preference.email_enabled !== false,
    smsEnabled: preference.sms_enabled === true,
    hasStoredPreference: true,
  };
};

const getNotificationPreference = async (
  userId: number,
  notificationType: string,
): Promise<NotificationPreference> => {
  const normalizedType = normalizeNotificationType(notificationType);
  if (!isKnownNotificationType(normalizedType)) {
    throw new NotFoundError(`Unknown notification type: ${normalizedType}`);
  }
  const preference = await prisma.notification_preference.findUnique({
    where: {
      user_id_type: {
        user_id: userId,
        type: normalizedType,
      },
    },
    select: {
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: true,
    },
  });

  return toNotificationPreferencePayload(normalizedType, preference);
};

const listNotificationPreferences = async (
  userId: number,
  notificationTypes?: string[],
): Promise<NotificationPreferencePayload[]> => {
  const normalizedTypes = Array.from(
    new Set((notificationTypes || []).map((type) => normalizeNotificationType(type))),
  );

  if (normalizedTypes.length > 0) {
    const storedPreferences = await prisma.notification_preference.findMany({
      where: {
        user_id: userId,
        type: {
          in: normalizedTypes,
        },
      },
      select: {
        type: true,
        in_app_enabled: true,
        email_enabled: true,
        sms_enabled: true,
      },
    });

    const storedByType = new Map(
      storedPreferences.map((preference) => [preference.type, preference]),
    );

    return normalizedTypes.map((type) =>
      toNotificationPreferencePayload(type, storedByType.get(type) || null),
    );
  }

  const storedPreferences = await prisma.notification_preference.findMany({
    where: {
      user_id: userId,
    },
    select: {
      type: true,
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: true,
    },
  });

  const storedByType = new Map(
    storedPreferences.map((preference) => [preference.type, preference]),
  );

  return listNotificationPreferenceTypes(storedPreferences.map((preference) => preference.type))
    .map((type) => toNotificationPreferencePayload(type, storedByType.get(type) || null));
};

const updateNotificationPreference = async (
  userId: number,
  notificationType: string,
  updates: UpdateNotificationPreferenceInput,
): Promise<NotificationPreferencePayload> => {
  const normalizedType = normalizeNotificationType(notificationType);
  // Only catalog-known types may be stored — otherwise any authenticated caller
  // can upsert unbounded junk preference rows for arbitrary type strings.
  if (!isKnownNotificationType(normalizedType)) {
    throw new NotFoundError(`Unknown notification type: ${normalizedType}`);
  }

  // Writes are clamped to the type's available channels so a stored flag can
  // never enable a channel the catalog/UI marks unavailable (the send-side
  // channel filter trusts the stored boolean).
  const availableChannels = getNotificationPreferenceOption(normalizedType)
    .availableChannels;
  const data: {
    in_app_enabled?: boolean;
    email_enabled?: boolean;
    sms_enabled?: boolean;
  } = {};

  if (updates.inAppEnabled !== undefined) {
    data.in_app_enabled = availableChannels.inApp && updates.inAppEnabled;
  }
  if (updates.emailEnabled !== undefined) {
    data.email_enabled = availableChannels.email && updates.emailEnabled;
  }
  if (updates.smsEnabled !== undefined) {
    data.sms_enabled = availableChannels.sms && updates.smsEnabled;
  }

  if (!Object.keys(data).length) {
    throw new InputValidationError("At least one preference value is required");
  }

  const updated = await prisma.notification_preference.upsert({
    where: {
      user_id_type: {
        user_id: userId,
        type: normalizedType,
      },
    },
    update: data,
    create: {
      user_id: userId,
      type: normalizedType,
      in_app_enabled: availableChannels.inApp && (updates.inAppEnabled ?? true),
      email_enabled: availableChannels.email && (updates.emailEnabled ?? true),
      sms_enabled: availableChannels.sms && (updates.smsEnabled ?? false),
    },
    select: {
      type: true,
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: true,
    },
  });

  return toNotificationPreferencePayload(updated.type, updated);
};

const filterUserIdsByChannelPreference = async (
  userIds: number[],
  notificationType: string,
  channel: NotificationPreferenceChannel,
): Promise<number[]> => {
  const normalizedType = normalizeNotificationType(notificationType);
  const normalizedUserIds = Array.from(
    new Set(
      userIds.filter(
        (userId): userId is number =>
          Number.isInteger(Number(userId)) && Number(userId) > 0,
      ),
    ),
  );

  if (!normalizedUserIds.length) {
    return [];
  }

  const storedPreferences = await prisma.notification_preference.findMany({
    where: {
      user_id: {
        in: normalizedUserIds,
      },
      type: normalizedType,
    },
    select: {
      user_id: true,
      in_app_enabled: channel === "inApp",
      email_enabled: channel === "email",
      sms_enabled: channel === "sms",
    },
  });

  const storedByUserId = new Map(
    storedPreferences.map((preference) => [preference.user_id, preference]),
  );

  return normalizedUserIds.filter((userId) => {
    const preference = storedByUserId.get(userId);
    if (!preference) {
      return channel === "sms" ? false : true;
    }

    if (channel === "inApp") {
      return preference.in_app_enabled !== false;
    }
    if (channel === "email") {
      return preference.email_enabled !== false;
    }

    return preference.sms_enabled === true;
  });
};

const buildEmailTemplate = (args: {
  title: string;
  body: string;
  actionUrl: string | null;
}) =>
  buildUnifiedEmailTemplate({
    preheader: args.title,
    headerTitle: args.title,
    headerText: "You have a new in-app notification.",
    greeting: "Hello,",
    message: args.body,
    actionLabel: args.actionUrl ? "Open notification" : undefined,
    actionUrl: args.actionUrl || undefined,
    showActionUrl: Boolean(args.actionUrl),
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Open app",
  });

const isDuplicateDedupeKeyError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const getRowByDedupeKey = async (dedupeKey: string): Promise<NotificationRow | null> => {
  const row = await prisma.in_app_notification.findUnique({
    where: {
      dedupe_key: dedupeKey,
    },
    select: {
      id: true,
      dedupe_key: true,
      type: true,
      title: true,
      body: true,
      recipient_user_id: true,
      actor_user_id: true,
      entity_type: true,
      entity_id: true,
      action_url: true,
      priority: true,
      is_read: true,
      read_at: true,
      created_at: true,
    },
  });

  return row as NotificationRow | null;
};

const getUnreadCountForUser = async (userId: number): Promise<number> =>
  prisma.in_app_notification.count({
    where: {
      recipient_user_id: userId,
      is_read: false,
    },
  });

const emitUnreadCountToUser = (userId: number, unreadCount: number) => {
  broadcastToUser(userId, "unread_count", {
    unreadCount,
  });
};

const sendUnreadCountToUser = async (userId: number): Promise<number> => {
  // Callers fire-and-forget this (`void sendUnreadCountToUser(...)`). A transient
  // DB error in the count must not surface as an unhandled rejection.
  try {
    const unreadCount = await getUnreadCountForUser(userId);
    emitUnreadCountToUser(userId, unreadCount);
    return unreadCount;
  } catch (error) {
    return 0;
  }
};

const createInAppNotification = async (
  input: CreateNotificationInput,
): Promise<NotificationPayload | null> => {
  const recipientUserId = parsePositiveInt(input.recipientUserId);
  if (!recipientUserId) {
    throw new InputValidationError("recipientUserId must be a positive integer");
  }

  const trimmedType = String(input.type || "").trim();
  const trimmedTitle = String(input.title || "").trim();
  const trimmedBody = String(input.body || "").trim();

  if (!trimmedType) {
    throw new InputValidationError("type is required");
  }
  if (!trimmedTitle) {
    throw new InputValidationError("title is required");
  }
  if (!trimmedBody) {
    throw new InputValidationError("body is required");
  }

  const actorUserId = parsePositiveInt(input.actorUserId);
  const entityType = input.entityType ? String(input.entityType).trim() : null;
  const entityId =
    input.entityId !== undefined &&
    input.entityId !== null &&
    String(input.entityId).trim()
      ? String(input.entityId).trim()
      : null;
  const actionUrl = normalizeActionUrl(input.actionUrl) || ACTION_URL_FALLBACK;
  const priority = parseNotificationPriority(input.priority || "MEDIUM");
  const dedupeKey =
    input.dedupeKey && String(input.dedupeKey).trim()
      ? String(input.dedupeKey).trim()
      : null;

  const [recipientUser, preference] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: recipientUserId,
      },
      select: {
        id: true,
        email: true,
        is_active: true,
        user_info: {
          select: {
            primary_number: true,
            country_code: true,
          },
        },
      },
    }),
    getNotificationPreference(recipientUserId, trimmedType),
  ]);

  if (!recipientUser || recipientUser.is_active === false) {
    return null;
  }

  let row: NotificationRow | null = null;
  let isDuplicate = false;

  if (preference.inAppEnabled) {
    try {
      const created = await prisma.in_app_notification.create({
        data: {
          dedupe_key: dedupeKey,
          type: trimmedType,
          title: trimmedTitle,
          body: trimmedBody,
          recipient_user_id: recipientUserId,
          actor_user_id: actorUserId || null,
          entity_type: entityType,
          entity_id: entityId,
          action_url: actionUrl,
          priority,
          is_read: false,
        },
        select: {
          id: true,
          dedupe_key: true,
          type: true,
          title: true,
          body: true,
          recipient_user_id: true,
          actor_user_id: true,
          entity_type: true,
          entity_id: true,
          action_url: true,
          priority: true,
          is_read: true,
          read_at: true,
          created_at: true,
        },
      });

      row = created as NotificationRow;
      notificationCreatedCounter.labels(trimmedType, priority).inc();
    } catch (error) {
      if (!dedupeKey || !isDuplicateDedupeKeyError(error)) {
        notificationDeliveryFailureCounter.labels("in_app", trimmedType).inc();
        throw error;
      }

      row = await getRowByDedupeKey(dedupeKey);
      if (!row) {
        throw error;
      }
      isDuplicate = true;
    }
  }

  // A duplicate dedupe hit means the original notification was already created
  // and dispatched on all channels. Dedupe must suppress DELIVERY, not just the
  // inbox row — re-running email/SMS/push/expo here would double-send. Return
  // the existing payload without re-dispatching or re-broadcasting.
  if (isDuplicate) {
    return row ? toPayload(row) : null;
  }

  const policyChannels = input.channelsFromPolicy === true;
  const shouldSendEmail =
    (input.sendEmail ?? true) && preference.emailEnabled;
  const recipientEmail = recipientUser.email?.trim() || "";
  if (shouldSendEmail && recipientEmail) {
    const actionUrlForEmail = toAbsoluteActionUrl(actionUrl);
    const template = buildEmailTemplate({
      title: trimmedTitle,
      body: trimmedBody,
      actionUrl: actionUrlForEmail,
    });
    const emailSubject = String(input.emailSubject || trimmedTitle);

    enqueueNotificationDelivery(async () => {
      try {
        await sendEmail(template, recipientEmail, emailSubject, {
          throwOnError: true,
        });

        notificationEmailSentCounter.labels(trimmedType).inc();

        if (row) {
          await prisma.in_app_notification.update({
            where: {
              id: row.id,
            },
            data: {
              email_sent_at: new Date(),
            },
          });
        }
      } catch (error) {
        notificationDeliveryFailureCounter.labels("email", trimmedType).inc();
      }
    }, input.bulk);
  }

  const shouldSendSms =
    input.sendSms === true &&
    (preference.smsEnabled ||
      (policyChannels && !preference.hasStoredPreference));
  if (shouldSendSms) {
    const smsBody = String(input.smsBody || trimmedBody).trim();
    if (smsBody) {
      const smsResult = await notificationSmsService.queueNotificationSms({
        notificationId: row?.id || null,
        notificationType: trimmedType,
        recipientUserId,
        phoneNumber: recipientUser.user_info?.primary_number || null,
        countryCode: recipientUser.user_info?.country_code || null,
        message: smsBody,
        dedupeKey,
      });

      if (
        !smsResult.queued &&
        !smsResult.disabled &&
        smsResult.reason !== "deduped"
      ) {
        notificationDeliveryFailureCounter.labels("sms", trimmedType).inc();
      }
    }
  }

  if (!row) {
    return null;
  }

  const payload = toPayload(row);
  broadcastToUser(recipientUserId, "notification", payload);
  void sendUnreadCountToUser(recipientUserId);
  void updateUnreadBacklogMetric();

  if (input.sendPush === false) {
    return payload;
  }

  enqueueNotificationDelivery(async () => {
    try {
      const pushDelivery = await notificationPushService.deliverNotificationPush({
        id: payload.id,
        dedupeKey: payload.dedupeKey,
        recipientUserId: payload.recipientUserId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        actionUrl: payload.actionUrl,
        entityType: payload.entityType,
        entityId: payload.entityId,
        priority: payload.priority,
        createdAt: payload.createdAt,
      });

      if (pushDelivery.failed > 0) {
        notificationDeliveryFailureCounter.labels("push", trimmedType).inc(
          pushDelivery.failed,
        );
      }
    } catch (error) {
      notificationDeliveryFailureCounter.labels("push", trimmedType).inc();
    }
  }, input.bulk);

  enqueueNotificationDelivery(async () => {
    try {
      const expoDelivery = await notificationDeviceService.deliverExpoPush(
        {
          id: payload.id,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          actionUrl: payload.actionUrl,
          entityType: payload.entityType,
          entityId: payload.entityId,
          priority: payload.priority,
        },
        Number(payload.recipientUserId),
      );

      if (expoDelivery.failed > 0) {
        notificationDeliveryFailureCounter
          .labels("expo_push", trimmedType)
          .inc(expoDelivery.failed);
      }
    } catch (error) {
      notificationDeliveryFailureCounter
        .labels("expo_push", trimmedType)
        .inc();
    }
  }, input.bulk);

  return payload;
};

// Each notification targets its own recipient, so a fan-out can run with
// bounded concurrency instead of one-at-a-time (serial N queries per recipient).
const CREATE_MANY_CONCURRENCY = 5;

const createManyInAppNotifications = async (
  inputs: CreateNotificationInput[],
): Promise<NotificationPayload[]> => {
  const notifications: NotificationPayload[] = [];

  for (let start = 0; start < inputs.length; start += CREATE_MANY_CONCURRENCY) {
    const batch = inputs.slice(start, start + CREATE_MANY_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((input) => createInAppNotification(input)),
    );

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        notifications.push(result.value);
      } else if (result.status === "rejected") {
        console.error(
          `[ERROR] createManyInAppNotifications item failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    }
  }

  return notifications;
};

const listNotifications = async (
  userId: number,
  args: NotificationListArgs = {},
): Promise<NotificationListResult> => {
  const page =
    Number.isInteger(args.page) && (args.page || 0) > 0 ? Number(args.page) : 1;
  const limit =
    Number.isInteger(args.limit) && (args.limit || 0) > 0
      ? Math.min(Number(args.limit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * limit;

  const where = {
    recipient_user_id: userId,
    ...(args.unreadOnly ? { is_read: false } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.in_app_notification.findMany({
      where,
      orderBy: {
        created_at: "desc",
      },
      skip,
      take: limit,
      select: {
        id: true,
        dedupe_key: true,
        type: true,
        title: true,
        body: true,
        recipient_user_id: true,
        actor_user_id: true,
        entity_type: true,
        entity_id: true,
        action_url: true,
        priority: true,
        is_read: true,
        read_at: true,
        created_at: true,
      },
    }),
    prisma.in_app_notification.count({ where }),
  ]);

  return {
    data: rows.map((row) => toPayload(row as NotificationRow)),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
};

const getUnreadCount = async (userId: number): Promise<number> =>
  getUnreadCountForUser(userId);

const markNotificationAsRead = async (
  userId: number,
  notificationId: number,
): Promise<NotificationPayload> => {
  const updateResult = await prisma.in_app_notification.updateMany({
    where: {
      id: notificationId,
      recipient_user_id: userId,
    },
    data: {
      is_read: true,
      read_at: new Date(),
    },
  });

  if (!updateResult.count) {
    throw new NotFoundError("Notification not found");
  }

  notificationReadCounter.labels("read_single").inc();

  const row = await prisma.in_app_notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      dedupe_key: true,
      type: true,
      title: true,
      body: true,
      recipient_user_id: true,
      actor_user_id: true,
      entity_type: true,
      entity_id: true,
      action_url: true,
      priority: true,
      is_read: true,
      read_at: true,
      created_at: true,
    },
  });

  if (!row || row.recipient_user_id !== userId) {
    throw new NotFoundError("Notification not found");
  }

  const payload = toPayload(row as NotificationRow);
  const unreadCount = await getUnreadCountForUser(userId);

  broadcastToUser(userId, "notification_updated", {
    notificationId: payload.id,
    recipientUserId: payload.recipientUserId,
    notification: payload,
    unreadCount,
  });
  emitUnreadCountToUser(userId, unreadCount);
  void updateUnreadBacklogMetric();
  return payload;
};

const markNotificationAsUnread = async (
  userId: number,
  notificationId: number,
): Promise<NotificationPayload> => {
  const updateResult = await prisma.in_app_notification.updateMany({
    where: {
      id: notificationId,
      recipient_user_id: userId,
    },
    data: {
      is_read: false,
      read_at: null,
    },
  });

  if (!updateResult.count) {
    throw new NotFoundError("Notification not found");
  }

  notificationReadCounter.labels("mark_unread_single").inc();

  const row = await prisma.in_app_notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      dedupe_key: true,
      type: true,
      title: true,
      body: true,
      recipient_user_id: true,
      actor_user_id: true,
      entity_type: true,
      entity_id: true,
      action_url: true,
      priority: true,
      is_read: true,
      read_at: true,
      created_at: true,
    },
  });

  if (!row || row.recipient_user_id !== userId) {
    throw new NotFoundError("Notification not found");
  }

  const payload = toPayload(row as NotificationRow);
  const unreadCount = await getUnreadCountForUser(userId);

  broadcastToUser(userId, "notification_updated", {
    notificationId: payload.id,
    recipientUserId: payload.recipientUserId,
    notification: payload,
    unreadCount,
  });
  emitUnreadCountToUser(userId, unreadCount);
  void updateUnreadBacklogMetric();
  return payload;
};

const markAllNotificationsAsRead = async (
  userId: number,
): Promise<{ updated: number }> => {
  const updateResult = await prisma.in_app_notification.updateMany({
    where: {
      recipient_user_id: userId,
      is_read: false,
    },
    data: {
      is_read: true,
      read_at: new Date(),
    },
  });

  if (updateResult.count > 0) {
    notificationReadCounter.labels("read_all").inc(updateResult.count);
  }

  const unreadCount = await getUnreadCountForUser(userId);
  broadcastToUser(userId, "notifications_read_all", {
    recipientUserId: String(userId),
    updated: updateResult.count,
    unreadCount,
  });
  emitUnreadCountToUser(userId, unreadCount);
  void updateUnreadBacklogMetric();
  return { updated: updateResult.count };
};

const clearAllNotifications = async (
  userId: number,
): Promise<{ deleted: number }> => {
  const result = await prisma.in_app_notification.deleteMany({
    where: {
      recipient_user_id: userId,
    },
  });

  const [unreadCount, totalCount] = await prisma.$transaction([
    prisma.in_app_notification.count({
      where: {
        recipient_user_id: userId,
        is_read: false,
      },
    }),
    prisma.in_app_notification.count({
      where: {
        recipient_user_id: userId,
      },
    }),
  ]);

  broadcastToUser(userId, "notifications_cleared", {
    recipientUserId: String(userId),
    deleted: result.count,
    unreadCount,
    totalCount,
  });
  emitUnreadCountToUser(userId, unreadCount);
  void updateUnreadBacklogMetric();

  return { deleted: result.count };
};

/**
 * Deletes the given notifications, owner-scoped: ids that belong to another
 * user (or no longer exist) are silently ignored. Mirrors
 * clearAllNotifications' side effects so open streams stay in sync.
 */
const deleteNotifications = async (
  userId: number,
  ids: number[],
): Promise<{ deleted: number }> => {
  const result = await prisma.in_app_notification.deleteMany({
    where: {
      id: { in: ids },
      recipient_user_id: userId,
    },
  });

  const unreadCount = await prisma.in_app_notification.count({
    where: {
      recipient_user_id: userId,
      is_read: false,
    },
  });

  broadcastToUser(userId, "notifications_deleted", {
    recipientUserId: String(userId),
    ids: ids.map(String),
    deleted: result.count,
    unreadCount,
  });
  emitUnreadCountToUser(userId, unreadCount);
  void updateUnreadBacklogMetric();

  return { deleted: result.count };
};

const pruneOldNotifications = async (
  retentionDays = 90,
): Promise<{ deleted: number }> => {
  const effectiveRetentionDays =
    Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 90;
  const cutoffDate = new Date(
    Date.now() - effectiveRetentionDays * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.in_app_notification.deleteMany({
    where: {
      created_at: {
        lt: cutoffDate,
      },
    },
  });

  void updateUnreadBacklogMetric();
  return { deleted: result.count };
};

const listAdminUserIds = async (): Promise<number[]> => {
  const users = await prisma.user.findMany({
    where: {
      NOT: {
        is_active: false,
      },
    },
    select: {
      id: true,
      access: {
        select: {
          permissions: true,
        },
      },
    },
  });

  return users
    .filter((user) => canManageSystemSettings(user.access?.permissions))
    .map((user) => user.id);
};

const listSystemFailureRecipientUserIds = async (): Promise<number[]> => {
  const configuredRecipients =
    await systemNotificationSettingsService.getConfiguredSystemFailureRecipientUserIds();

  if (configuredRecipients.length > 0) {
    return configuredRecipients;
  }

  return listAdminUserIds();
};

const notifyAdminsJobFailed = async (args: {
  jobName: string;
  errorMessage: string;
  actionUrl?: string | null;
  dedupeKey?: string | null;
}) => {
  // A transient "can't reach database" blip is infrastructure noise, not an
  // actionable job failure. Paging admins CRITICAL for it cries wolf (and would
  // itself fail while the DB is down). Log and skip.
  if (isDatabaseUnavailableError(args.errorMessage)) {
    console.warn(
      `[WARN] Skipping admin job failure notification for ${args.jobName}: originating error is database-unavailable: ${args.errorMessage}`,
    );
    return;
  }

  try {
    const recipientUserIds = await listSystemFailureRecipientUserIds();
    if (!recipientUserIds.length) {
      return;
    }

    // Recipients here are org admins (Settings-manage), not necessarily
    // engineers — the caller already logs `args.errorMessage` in full via
    // console.error/console.warn for whoever is on call. Don't also mail raw
    // Prisma/DB error text (stack-shaped strings, pool config, table names)
    // to an admin who can't act on it and shouldn't see backend internals.
    const body = `${args.jobName} failed and needs attention. Check the server logs for details.`;

    await createManyInAppNotifications(
      recipientUserIds.map((recipientUserId) => ({
        type: "system.job_failed",
        title: "System Job Failure",
        body,
        recipientUserId,
        priority: "CRITICAL",
        actionUrl: args.actionUrl || "/home/dashboard",
        dedupeKey: args.dedupeKey
          ? `${args.dedupeKey}:recipient:${recipientUserId}`
          : null,
      })),
    );
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      const message =
        error instanceof Error ? error.message : String(error || "");
      console.warn(
        `[WARN] Skipping admin job failure notification for ${args.jobName}: database unavailable: ${message}`,
      );
      return;
    }

    throw error;
  }
};

export const notificationService = {
  createInAppNotification,
  createManyInAppNotifications,
  filterUserIdsByChannelPreference,
  getNotificationPreference,
  listNotificationPreferences,
  updateNotificationPreference,
  listNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markNotificationAsUnread,
  markAllNotificationsAsRead,
  clearAllNotifications,
  deleteNotifications,
  pruneOldNotifications,
  notifyAdminsJobFailed,
};
