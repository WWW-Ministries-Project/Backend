import { Prisma } from "@prisma/client";
import client from "prom-client";
import { Response } from "express";
import { prisma } from "../../Models/context";
import { sendEmail } from "../../utils/emailService";
import { buildUnifiedEmailTemplate } from "../../utils/mail_templates/unifiedEmailTemplate";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

export type NotificationPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

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
  inAppEnabled: boolean;
  emailEnabled: boolean;
};

type SseClient = {
  res: Response;
  heartbeat: NodeJS.Timeout;
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SSE_HEARTBEAT_MS = 25_000;
const SSE_RETRY_MS = 5_000;
const ACTION_URL_FALLBACK = "/home/notifications";

const sseClientsByUserId = new Map<number, Set<SseClient>>();

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

const writeSse = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const registerSseClient = (userId: number, res: Response) => {
  const clientState: SseClient = {
    res,
    heartbeat: setInterval(() => {
      writeSse(res, "heartbeat", {
        now: new Date().toISOString(),
      });
    }, SSE_HEARTBEAT_MS),
  };

  const existingClients = sseClientsByUserId.get(userId) || new Set<SseClient>();
  existingClients.add(clientState);
  sseClientsByUserId.set(userId, existingClients);

  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  writeSse(res, "connected", {
    userId: String(userId),
    now: new Date().toISOString(),
  });

  const onClose = () => {
    clearInterval(clientState.heartbeat);
    const userClients = sseClientsByUserId.get(userId);
    if (!userClients) return;

    userClients.delete(clientState);
    if (userClients.size === 0) {
      sseClientsByUserId.delete(userId);
    }
  };

  res.on("close", onClose);
  res.on("error", onClose);
};

const broadcastToUser = (userId: number, event: string, data: unknown) => {
  const userClients = sseClientsByUserId.get(userId);
  if (!userClients?.size) {
    return;
  }

  for (const clientState of userClients) {
    try {
      writeSse(clientState.res, event, data);
    } catch (error) {
      clearInterval(clientState.heartbeat);
      userClients.delete(clientState);
    }
  }

  if (userClients.size === 0) {
    sseClientsByUserId.delete(userId);
  }
};

const updateUnreadBacklogMetric = async () => {
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

const hasSuperAdminPermission = (permissions: unknown): boolean => {
  const permissionObject = parsePermissionsObject(permissions);
  return Object.values(permissionObject).some(
    (value) => typeof value === "string" && value === "Super_Admin",
  );
};

const getNotificationPreference = async (
  userId: number,
  notificationType: string,
): Promise<NotificationPreference> => {
  const preference = await prisma.notification_preference.findUnique({
    where: {
      user_id_type: {
        user_id: userId,
        type: notificationType,
      },
    },
    select: {
      in_app_enabled: true,
      email_enabled: true,
    },
  });

  if (!preference) {
    return {
      inAppEnabled: true,
      emailEnabled: true,
    };
  }

  return {
    inAppEnabled: preference.in_app_enabled !== false,
    emailEnabled: preference.email_enabled !== false,
  };
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

const sendUnreadCountToUser = async (userId: number) => {
  const unreadCount = await prisma.in_app_notification.count({
    where: {
      recipient_user_id: userId,
      is_read: false,
    },
  });

  broadcastToUser(userId, "unread_count", {
    unreadCount,
  });
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
      },
    }),
    getNotificationPreference(recipientUserId, trimmedType),
  ]);

  if (!recipientUser || recipientUser.is_active === false) {
    return null;
  }

  let row: NotificationRow | null = null;

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
    }
  }

  const shouldSendEmail = (input.sendEmail ?? true) && preference.emailEnabled;
  if (shouldSendEmail && recipientUser.email) {
    try {
      const actionUrlForEmail = toAbsoluteActionUrl(actionUrl);
      const template = buildEmailTemplate({
        title: trimmedTitle,
        body: trimmedBody,
        actionUrl: actionUrlForEmail,
      });

      await sendEmail(
        template,
        recipientUser.email,
        String(input.emailSubject || trimmedTitle),
        {
          throwOnError: true,
        },
      );

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
  }

  if (!row) {
    return null;
  }

  const payload = toPayload(row);
  broadcastToUser(recipientUserId, "notification", payload);
  void sendUnreadCountToUser(recipientUserId);
  void updateUnreadBacklogMetric();

  return payload;
};

const createManyInAppNotifications = async (
  inputs: CreateNotificationInput[],
): Promise<NotificationPayload[]> => {
  const notifications: NotificationPayload[] = [];

  for (const input of inputs) {
    const created = await createInAppNotification(input);
    if (created) {
      notifications.push(created);
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
  prisma.in_app_notification.count({
    where: {
      recipient_user_id: userId,
      is_read: false,
    },
  });

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
  broadcastToUser(userId, "notification_updated", payload);
  void sendUnreadCountToUser(userId);
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
  broadcastToUser(userId, "notification_updated", payload);
  void sendUnreadCountToUser(userId);
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

  broadcastToUser(userId, "notifications_read_all", {
    updated: updateResult.count,
  });
  void sendUnreadCountToUser(userId);
  void updateUnreadBacklogMetric();
  return { updated: updateResult.count };
};

const startSseStream = async (userId: number, res: Response): Promise<void> => {
  registerSseClient(userId, res);
  await sendUnreadCountToUser(userId);
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
    .filter((user) => hasSuperAdminPermission(user.access?.permissions))
    .map((user) => user.id);
};

const notifyAdminsJobFailed = async (args: {
  jobName: string;
  errorMessage: string;
  actionUrl?: string | null;
  dedupeKey?: string | null;
}) => {
  const adminUserIds = await listAdminUserIds();
  if (!adminUserIds.length) {
    return;
  }

  const body = `${args.jobName} failed: ${args.errorMessage}`;

  await createManyInAppNotifications(
    adminUserIds.map((recipientUserId) => ({
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
};

export const notificationService = {
  createInAppNotification,
  createManyInAppNotifications,
  listNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markNotificationAsUnread,
  markAllNotificationsAsRead,
  startSseStream,
  pruneOldNotifications,
  notifyAdminsJobFailed,
};

