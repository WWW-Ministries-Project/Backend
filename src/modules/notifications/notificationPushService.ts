import { Prisma } from "@prisma/client";
import webpush from "web-push";
import { createHash } from "crypto";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";

export type PushPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PushDispatchInput = {
  id: string;
  dedupeKey?: string | null;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  priority: PushPriority;
  createdAt: string;
};

type PushMetadataInput = {
  userAgent?: string | null;
  platform?: string | null;
  language?: string | null;
  timezone?: string | null;
};

type NormalizedPushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  metadata: PushMetadataInput;
};

type PushSubscriptionRow = {
  id: string;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: Date | null;
  is_active: boolean;
};

type CanonicalPushPayload = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  icon: string;
  badge: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  priority: PushPriority;
  createdAt: string;
  notification: {
    id: string;
    title: string;
    body: string;
    actionUrl: string | null;
    icon: string;
    badge: string;
  };
  data: {
    type: string;
    entityType: string | null;
    entityId: string | null;
    priority: PushPriority;
    createdAt: string;
  };
};

type PushSendError = {
  statusCode: number | null;
  code: string;
  message: string;
};

type PushDeliverySummary = {
  attempted: number;
  sent: number;
  failed: number;
  queuedRetries: number;
};

type RetryProcessingSummary = {
  processed: number;
  sent: number;
  requeued: number;
  dead: number;
};

const DEFAULT_PUSH_ICON = "/pwa/icon-192.png";
const DEFAULT_PUSH_BADGE = "/pwa/icon-maskable-192.png";
const DEFAULT_PUSH_TTL_SECONDS = 86_400;
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const INVALID_SUBSCRIPTION_STATUS_CODES = new Set([404, 410]);
const MAX_TRANSIENT_RETRIES = 3;
const TRANSIENT_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const DEFAULT_RETRY_BATCH_SIZE = 50;
const MAX_LOG_ERROR_MESSAGE_LENGTH = 1000;

let vapidConfigured = false;
let vapidConfigAttempted = false;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimToNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const readEnv = (names: string[]): string => {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;

    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
};

const getPushPublicKeyFromEnv = (): string =>
  readEnv([
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "VAPID_PUBLIC_KEY",
    "NOTIFICATIONS_VAPID_PUBLIC_KEY",
  ]);

const getPushPrivateKeyFromEnv = (): string =>
  readEnv([
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "VAPID_PRIVATE_KEY",
    "NOTIFICATIONS_VAPID_PRIVATE_KEY",
  ]);

const getVapidSubjectFromEnv = (): string =>
  readEnv([
    "WEB_PUSH_VAPID_SUBJECT",
    "VAPID_SUBJECT",
    "NOTIFICATIONS_VAPID_SUBJECT",
  ]) || "mailto:no-reply@example.com";

const getPushIcon = (): string =>
  readEnv(["WEB_PUSH_NOTIFICATION_ICON", "PUSH_NOTIFICATION_ICON"]) ||
  DEFAULT_PUSH_ICON;

const getPushBadge = (): string =>
  readEnv(["WEB_PUSH_NOTIFICATION_BADGE", "PUSH_NOTIFICATION_BADGE"]) ||
  DEFAULT_PUSH_BADGE;

const isHttpsUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
};

const normalizeExpirationTime = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new InputValidationError("subscription.expirationTime is invalid");
    }

    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) {
      throw new InputValidationError("subscription.expirationTime is invalid");
    }

    return asDate;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsedDate = new Date(trimmed);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new InputValidationError("subscription.expirationTime is invalid");
    }

    return parsedDate;
  }

  throw new InputValidationError("subscription.expirationTime is invalid");
};

const normalizeOptionalMetadataValue = (
  value: unknown,
  maxLength: number,
): string | null => {
  const trimmed = trimToNull(value);
  if (!trimmed) return null;

  return truncate(trimmed, maxLength);
};

const toEndpointHash = (endpoint: string): string =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, 16);

const ensureVapidConfigured = (): boolean => {
  if (vapidConfigAttempted) {
    return vapidConfigured;
  }

  vapidConfigAttempted = true;

  const publicKey = getPushPublicKeyFromEnv();
  const privateKey = getPushPrivateKeyFromEnv();

  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(getVapidSubjectFromEnv(), publicKey, privateKey);
    vapidConfigured = true;
  } catch (error) {
    vapidConfigured = false;
    console.error("[ERROR] Web push VAPID configuration failed");
  }

  return vapidConfigured;
};

const normalizeSubscribePayload = (
  body: unknown,
): NormalizedPushSubscriptionInput => {
  if (!isObjectRecord(body)) {
    throw new InputValidationError("Request body is required");
  }

  const subscriptionSection = isObjectRecord(body.subscription)
    ? body.subscription
    : {};

  const endpoint =
    trimToNull(subscriptionSection.endpoint) ?? trimToNull(body.endpoint);

  if (!endpoint) {
    throw new InputValidationError("subscription.endpoint is required");
  }

  if (!isHttpsUrl(endpoint)) {
    throw new InputValidationError("subscription.endpoint must be an HTTPS URL");
  }

  if (endpoint.length > 512) {
    throw new InputValidationError("subscription.endpoint exceeds max length");
  }

  const keysSection = isObjectRecord(subscriptionSection.keys)
    ? subscriptionSection.keys
    : isObjectRecord(body.keys)
      ? body.keys
      : {};

  const p256dh = trimToNull(keysSection.p256dh);
  const auth = trimToNull(keysSection.auth);

  if (!p256dh || !auth) {
    throw new InputValidationError(
      "subscription.keys.p256dh and subscription.keys.auth are required",
    );
  }

  if (p256dh.length > 512 || auth.length > 512) {
    throw new InputValidationError("subscription.keys values exceed max length");
  }

  const expirationTimeRaw =
    subscriptionSection.expirationTime ?? body.expirationTime;

  return {
    endpoint,
    p256dh,
    auth,
    expirationTime: normalizeExpirationTime(expirationTimeRaw),
    metadata: {
      userAgent: normalizeOptionalMetadataValue(body.userAgent, 512),
      platform: normalizeOptionalMetadataValue(body.platform, 191),
      language: normalizeOptionalMetadataValue(body.language, 32),
      timezone: normalizeOptionalMetadataValue(body.timezone, 191),
    },
  };
};

const normalizeEndpointFromPayload = (body: unknown): string => {
  if (!isObjectRecord(body)) {
    throw new InputValidationError("Request body is required");
  }

  const subscriptionSection = isObjectRecord(body.subscription)
    ? body.subscription
    : {};

  const endpoint =
    trimToNull(subscriptionSection.endpoint) ?? trimToNull(body.endpoint);

  if (!endpoint) {
    throw new InputValidationError("subscription.endpoint is required");
  }

  if (!isHttpsUrl(endpoint)) {
    throw new InputValidationError("subscription.endpoint must be an HTTPS URL");
  }

  if (endpoint.length > 512) {
    throw new InputValidationError("subscription.endpoint exceeds max length");
  }

  return endpoint;
};

const normalizePushError = (error: unknown): PushSendError => {
  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
    body?: unknown;
    code?: unknown;
    name?: unknown;
  };

  const rawStatusCode = Number(candidate?.statusCode ?? candidate?.status);
  const statusCode = Number.isInteger(rawStatusCode) ? rawStatusCode : null;
  const rawMessageParts = [
    typeof candidate?.message === "string" ? candidate.message : "",
    typeof candidate?.body === "string" ? candidate.body : "",
  ]
    .map((part) => part.trim())
    .filter(Boolean);

  const fallbackMessage = "Push delivery failed";
  const message = truncate(
    rawMessageParts.length ? rawMessageParts.join(" | ") : fallbackMessage,
    MAX_LOG_ERROR_MESSAGE_LENGTH,
  );

  const code = statusCode
    ? String(statusCode)
    : typeof candidate?.code === "string" && candidate.code.trim()
      ? truncate(candidate.code.trim(), 64)
      : "UNKNOWN";

  return {
    statusCode,
    code,
    message,
  };
};

const getUrgencyFromPriority = (
  priority: PushPriority,
): "high" | "normal" | "low" => {
  if (priority === "CRITICAL" || priority === "HIGH") return "high";
  if (priority === "LOW") return "low";
  return "normal";
};

const sanitizeTopic = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\-_.~%]/g, "-")
    .slice(0, 32);

  return normalized || undefined;
};

const getRetryDelayMs = (retryAttemptNumber: number): number => {
  const index = Math.min(
    Math.max(retryAttemptNumber - 1, 0),
    TRANSIENT_RETRY_DELAYS_MS.length - 1,
  );
  return TRANSIENT_RETRY_DELAYS_MS[index];
};

const withJitter = (baseDelayMs: number): number => {
  const jitterRange = Math.floor(baseDelayMs * 0.2);
  const jitter = Math.floor(Math.random() * (jitterRange * 2 + 1)) - jitterRange;
  return Math.max(1_000, baseDelayMs + jitter);
};

const buildCanonicalPayload = (input: PushDispatchInput): CanonicalPushPayload => {
  const icon = getPushIcon();
  const badge = getPushBadge();

  return {
    id: input.id,
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    icon,
    badge,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    priority: input.priority,
    createdAt: input.createdAt,
    notification: {
      id: input.id,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
      icon,
      badge,
    },
    data: {
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      priority: input.priority,
      createdAt: input.createdAt,
    },
  };
};

const toPushSubscription = (row: PushSubscriptionRow): webpush.PushSubscription => ({
  endpoint: row.endpoint,
  expirationTime: row.expiration_time ? row.expiration_time.getTime() : null,
  keys: {
    p256dh: row.p256dh,
    auth: row.auth,
  },
});

const buildWebPushOptions = (
  payload: CanonicalPushPayload,
  topicCandidate: string,
): webpush.RequestOptions => {
  const options: webpush.RequestOptions = {
    TTL: DEFAULT_PUSH_TTL_SECONDS,
    urgency: getUrgencyFromPriority(payload.data.priority),
  };

  const topic = sanitizeTopic(topicCandidate);
  if (topic) {
    options.topic = topic;
  }

  return options;
};

const clearSubscriptionError = async (subscriptionId: string): Promise<void> => {
  await prisma.notification_push_subscription.updateMany({
    where: { id: subscriptionId },
    data: {
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
      last_seen_at: new Date(),
    },
  });
};

const markSubscriptionFailure = async (args: {
  subscriptionId: string;
  code: string;
  message: string;
  deactivate: boolean;
}) => {
  const now = new Date();
  await prisma.notification_push_subscription.updateMany({
    where: {
      id: args.subscriptionId,
    },
    data: {
      is_active: args.deactivate ? false : undefined,
      last_error_code: truncate(args.code, 64),
      last_error_message: truncate(args.message, 1024),
      last_error_at: now,
    },
  });
};

const markJobDead = async (args: {
  jobId: string;
  attempts: number;
  errorCode: string;
  errorMessage: string;
}) => {
  await prisma.notification_push_delivery_job.updateMany({
    where: { id: args.jobId },
    data: {
      status: "DEAD",
      attempts: args.attempts,
      last_error_code: truncate(args.errorCode, 64),
      last_error_message: truncate(args.errorMessage, 1024),
      last_error_at: new Date(),
    },
  });
};

const enqueueRetryJob = async (args: {
  notificationId: number;
  userId: number;
  subscriptionId: string;
  payload: CanonicalPushPayload;
  errorCode: string;
  errorMessage: string;
}) => {
  const nextAttemptAt = new Date(Date.now() + withJitter(getRetryDelayMs(1)));

  try {
    await prisma.notification_push_delivery_job.create({
      data: {
        notification_id: args.notificationId,
        user_id: args.userId,
        subscription_id: args.subscriptionId,
        payload: args.payload,
        status: "PENDING",
        attempts: 0,
        next_attempt_at: nextAttemptAt,
        last_error_code: truncate(args.errorCode, 64),
        last_error_message: truncate(args.errorMessage, 1024),
        last_error_at: new Date(),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await prisma.notification_push_delivery_job.update({
        where: {
          notification_id_subscription_id: {
            notification_id: args.notificationId,
            subscription_id: args.subscriptionId,
          },
        },
        data: {
          status: "PENDING",
          next_attempt_at: nextAttemptAt,
          last_error_code: truncate(args.errorCode, 64),
          last_error_message: truncate(args.errorMessage, 1024),
          last_error_at: new Date(),
        },
      });
      return;
    }

    throw error;
  }
};

const logPushFailure = (args: {
  stage: "initial" | "retry";
  notificationId: number;
  userId: number;
  endpoint: string;
  statusCode: number | null;
  message: string;
}) => {
  const endpointHash = toEndpointHash(args.endpoint);

  console.error(
    `[WARN] Web push ${args.stage} delivery failed: notification=${args.notificationId} user=${args.userId} endpointHash=${endpointHash} status=${args.statusCode ?? "unknown"} error=${truncate(args.message, MAX_LOG_ERROR_MESSAGE_LENGTH)}`,
  );
};

const asPushPayload = (value: Prisma.JsonValue): CanonicalPushPayload | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const notification = candidate.notification;
  const data = candidate.data;

  if (!isObjectRecord(notification) || !isObjectRecord(data)) {
    return null;
  }

  if (typeof notification.id !== "string") {
    return null;
  }

  return candidate as unknown as CanonicalPushPayload;
};

const sendToSubscription = async (args: {
  subscription: PushSubscriptionRow;
  payload: CanonicalPushPayload;
  topicCandidate: string;
}) => {
  const pushSubscription = toPushSubscription(args.subscription);
  const options = buildWebPushOptions(args.payload, args.topicCandidate);

  await webpush.sendNotification(
    pushSubscription,
    JSON.stringify(args.payload),
    options,
  );
};

const getRetryBatchSize = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_RETRY_BATCH_SIZE;
  }

  return Math.min(parsed, 500);
};

const handleRetryFailure = async (args: {
  jobId: string;
  notificationId: number;
  subscription: PushSubscriptionRow;
  retryAttemptNumber: number;
  error: PushSendError;
}) => {
  const { jobId, notificationId, retryAttemptNumber, error, subscription } = args;

  if (
    error.statusCode !== null &&
    INVALID_SUBSCRIPTION_STATUS_CODES.has(error.statusCode)
  ) {
    await markSubscriptionFailure({
      subscriptionId: subscription.id,
      code: error.code,
      message: error.message,
      deactivate: true,
    });

    await markJobDead({
      jobId,
      attempts: retryAttemptNumber,
      errorCode: error.code,
      errorMessage: error.message,
    });

    return "dead" as const;
  }

  if (error.statusCode !== null && TRANSIENT_STATUS_CODES.has(error.statusCode)) {
    await markSubscriptionFailure({
      subscriptionId: subscription.id,
      code: error.code,
      message: error.message,
      deactivate: false,
    });

    if (retryAttemptNumber >= MAX_TRANSIENT_RETRIES) {
      await markJobDead({
        jobId,
        attempts: retryAttemptNumber,
        errorCode: error.code,
        errorMessage: error.message,
      });
      return "dead" as const;
    }

    const nextAttemptAt = new Date(
      Date.now() + withJitter(getRetryDelayMs(retryAttemptNumber + 1)),
    );

    await prisma.notification_push_delivery_job.updateMany({
      where: {
        id: jobId,
      },
      data: {
        status: "PENDING",
        attempts: retryAttemptNumber,
        next_attempt_at: nextAttemptAt,
        last_error_code: truncate(error.code, 64),
        last_error_message: truncate(error.message, 1024),
        last_error_at: new Date(),
      },
    });

    return "requeued" as const;
  }

  await markSubscriptionFailure({
    subscriptionId: subscription.id,
    code: error.code,
    message: error.message,
    deactivate: false,
  });

  await markJobDead({
    jobId,
    attempts: retryAttemptNumber,
    errorCode: error.code,
    errorMessage: error.message,
  });

  logPushFailure({
    stage: "retry",
    notificationId,
    userId: subscription.user_id,
    endpoint: subscription.endpoint,
    statusCode: error.statusCode,
    message: error.message,
  });

  return "dead" as const;
};

const subscribe = async (userId: number, body: unknown): Promise<{ ok: true }> => {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) {
    throw new InputValidationError("Authenticated user not found");
  }

  const normalized = normalizeSubscribePayload(body);
  const now = new Date();

  const existing = await prisma.notification_push_subscription.findUnique({
    where: {
      endpoint: normalized.endpoint,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    await prisma.notification_push_subscription.create({
      data: {
        user_id: parsedUserId,
        endpoint: normalized.endpoint,
        p256dh: normalized.p256dh,
        auth: normalized.auth,
        expiration_time: normalized.expirationTime,
        is_active: true,
        user_agent: normalized.metadata.userAgent || null,
        platform: normalized.metadata.platform || null,
        language: normalized.metadata.language || null,
        timezone: normalized.metadata.timezone || null,
        last_seen_at: now,
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
      },
    });

    return { ok: true };
  }

  await prisma.notification_push_subscription.update({
    where: {
      id: existing.id,
    },
    data: {
      user_id: parsedUserId,
      p256dh: normalized.p256dh,
      auth: normalized.auth,
      expiration_time: normalized.expirationTime,
      is_active: true,
      user_agent: normalized.metadata.userAgent || null,
      platform: normalized.metadata.platform || null,
      language: normalized.metadata.language || null,
      timezone: normalized.metadata.timezone || null,
      last_seen_at: now,
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
    },
  });

  return { ok: true };
};

const unsubscribe = async (
  userId: number,
  body: unknown,
): Promise<{ ok: true }> => {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) {
    throw new InputValidationError("Authenticated user not found");
  }

  const endpoint = normalizeEndpointFromPayload(body);

  await prisma.notification_push_subscription.updateMany({
    where: {
      user_id: parsedUserId,
      endpoint,
    },
    data: {
      is_active: false,
      last_seen_at: new Date(),
    },
  });

  return { ok: true };
};

const getPublicKeyResponse = (): {
  publicKey: string;
  public_key: string;
  vapidPublicKey: string;
  vapid_public_key: string;
  key: string;
} => {
  const publicKey = getPushPublicKeyFromEnv();
  if (!publicKey) {
    throw new InputValidationError("Web push public key is not configured");
  }

  return {
    publicKey,
    public_key: publicKey,
    vapidPublicKey: publicKey,
    vapid_public_key: publicKey,
    key: publicKey,
  };
};

const deliverNotificationPush = async (
  input: PushDispatchInput,
): Promise<PushDeliverySummary> => {
  if (!ensureVapidConfigured()) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      queuedRetries: 0,
    };
  }

  const recipientUserId = toPositiveInt(input.recipientUserId);
  const notificationId = toPositiveInt(input.id);
  if (!recipientUserId || !notificationId) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      queuedRetries: 0,
    };
  }

  const subscriptions = await prisma.notification_push_subscription.findMany({
    where: {
      user_id: recipientUserId,
      is_active: true,
    },
    select: {
      id: true,
      user_id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      expiration_time: true,
      is_active: true,
    },
  });

  if (!subscriptions.length) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      queuedRetries: 0,
    };
  }

  const payload = buildCanonicalPayload(input);
  const topicCandidate = input.dedupeKey || input.id;

  let sent = 0;
  let failed = 0;
  let queuedRetries = 0;

  for (const subscription of subscriptions) {
    try {
      await sendToSubscription({
        subscription,
        payload,
        topicCandidate,
      });
      sent += 1;
      await clearSubscriptionError(subscription.id);
    } catch (error) {
      failed += 1;
      const normalizedError = normalizePushError(error);

      try {
        if (
          normalizedError.statusCode !== null &&
          INVALID_SUBSCRIPTION_STATUS_CODES.has(normalizedError.statusCode)
        ) {
          await markSubscriptionFailure({
            subscriptionId: subscription.id,
            code: normalizedError.code,
            message: normalizedError.message,
            deactivate: true,
          });
          continue;
        }

        if (
          normalizedError.statusCode !== null &&
          TRANSIENT_STATUS_CODES.has(normalizedError.statusCode)
        ) {
          await markSubscriptionFailure({
            subscriptionId: subscription.id,
            code: normalizedError.code,
            message: normalizedError.message,
            deactivate: false,
          });

          await enqueueRetryJob({
            notificationId,
            userId: recipientUserId,
            subscriptionId: subscription.id,
            payload,
            errorCode: normalizedError.code,
            errorMessage: normalizedError.message,
          });
          queuedRetries += 1;
          continue;
        }

        await markSubscriptionFailure({
          subscriptionId: subscription.id,
          code: normalizedError.code,
          message: normalizedError.message,
          deactivate: false,
        });

        logPushFailure({
          stage: "initial",
          notificationId,
          userId: recipientUserId,
          endpoint: subscription.endpoint,
          statusCode: normalizedError.statusCode,
          message: normalizedError.message,
        });
      } catch (nestedError) {
        logPushFailure({
          stage: "initial",
          notificationId,
          userId: recipientUserId,
          endpoint: subscription.endpoint,
          statusCode: normalizedError.statusCode,
          message: normalizedError.message,
        });
      }
    }
  }

  return {
    attempted: subscriptions.length,
    sent,
    failed,
    queuedRetries,
  };
};

const processPendingPushDeliveryJobs = async (args?: {
  batchSize?: number;
}): Promise<RetryProcessingSummary> => {
  if (!ensureVapidConfigured()) {
    return {
      processed: 0,
      sent: 0,
      requeued: 0,
      dead: 0,
    };
  }

  const batchSize = getRetryBatchSize(args?.batchSize);
  const now = new Date();

  const dueJobs = await prisma.notification_push_delivery_job.findMany({
    where: {
      status: "PENDING",
      next_attempt_at: {
        lte: now,
      },
    },
    orderBy: {
      next_attempt_at: "asc",
    },
    take: batchSize,
  });

  let processed = 0;
  let sent = 0;
  let requeued = 0;
  let dead = 0;

  for (const dueJob of dueJobs) {
    try {
      const claimed = await prisma.notification_push_delivery_job.updateMany({
        where: {
          id: dueJob.id,
          status: "PENDING",
        },
        data: {
          status: "PROCESSING",
        },
      });

      if (!claimed.count) {
        continue;
      }

      const job = await prisma.notification_push_delivery_job.findUnique({
        where: {
          id: dueJob.id,
        },
        include: {
          subscription: {
            select: {
              id: true,
              user_id: true,
              endpoint: true,
              p256dh: true,
              auth: true,
              expiration_time: true,
              is_active: true,
            },
          },
        },
      });

      if (!job) {
        continue;
      }

      processed += 1;

      if (!job.subscription || !job.subscription.is_active) {
        await markJobDead({
          jobId: job.id,
          attempts: job.attempts,
          errorCode: "SUBSCRIPTION_INACTIVE",
          errorMessage: "Subscription is inactive",
        });
        dead += 1;
        continue;
      }

      const payload = asPushPayload(job.payload);
      if (!payload) {
        await markJobDead({
          jobId: job.id,
          attempts: job.attempts,
          errorCode: "INVALID_PAYLOAD",
          errorMessage: "Stored push payload is invalid",
        });
        dead += 1;
        continue;
      }

      const retryAttemptNumber = job.attempts + 1;
      try {
        await sendToSubscription({
          subscription: job.subscription,
          payload,
          topicCandidate:
            typeof payload.notification?.id === "string"
              ? payload.notification.id
              : String(job.notification_id),
        });

        await prisma.notification_push_delivery_job.updateMany({
          where: {
            id: job.id,
          },
          data: {
            status: "SENT",
            attempts: retryAttemptNumber,
            sent_at: new Date(),
            last_error_code: null,
            last_error_message: null,
            last_error_at: null,
          },
        });

        await clearSubscriptionError(job.subscription.id);
        sent += 1;
      } catch (error) {
        const normalizedError = normalizePushError(error);

        const nextStatus = await handleRetryFailure({
          jobId: job.id,
          notificationId: job.notification_id,
          subscription: job.subscription,
          retryAttemptNumber,
          error: normalizedError,
        });

        if (nextStatus === "dead") {
          dead += 1;
        } else {
          requeued += 1;
        }
      }
    } catch (error) {
      const normalizedError = normalizePushError(error);
      await prisma.notification_push_delivery_job.updateMany({
        where: {
          id: dueJob.id,
          status: "PROCESSING",
        },
        data: {
          status: "PENDING",
          next_attempt_at: new Date(Date.now() + withJitter(getRetryDelayMs(1))),
          last_error_code: "PROCESSING_ERROR",
          last_error_message: truncate(normalizedError.message, 1024),
          last_error_at: new Date(),
        },
      });

      console.error(
        `[ERROR] Push retry processing failed for job=${dueJob.id}: ${normalizedError.message}`,
      );
    }
  }

  return {
    processed,
    sent,
    requeued,
    dead,
  };
};

export const notificationPushService = {
  getPublicKeyResponse,
  subscribe,
  unsubscribe,
  deliverNotificationPush,
  processPendingPushDeliveryJobs,
};
