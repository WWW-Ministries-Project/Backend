import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import client from "prom-client";
import { prisma } from "../../Models/context";

type SmsQueueDropReason =
  | "disabled"
  | "invalid_phone"
  | "empty_message"
  | "queue_full"
  | "deduped";

type QueueNotificationSmsInput = {
  notificationId?: number | null;
  notificationType: string;
  recipientUserId: number;
  phoneNumber: string | null | undefined;
  countryCode?: string | null;
  message: string;
  dedupeKey?: string | null;
};

type QueueNotificationSmsResult = {
  queued: boolean;
  disabled: boolean;
  reason: SmsQueueDropReason | null;
};

type SmsJobPayload = {
  notificationType: string;
  recipientUserId: number;
  phoneNumber: string;
  message: string;
};

type SmsConfig = {
  enabled: boolean;
  endpoint: string;
  senderId: string;
  authHeader: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  maxPendingJobs: number;
  maxMessageLength: number;
  dedupeWindowMs: number;
};

type SmsRetryProcessingSummary = {
  processed: number;
  sent: number;
  requeued: number;
  dead: number;
};

class HubtelSmsRequestError extends Error {
  code: string;
  statusCode: number | null;
  transient: boolean;

  constructor(
    message: string,
    code: string,
    statusCode: number | null,
    transient: boolean,
  ) {
    super(message);
    this.name = "HubtelSmsRequestError";
    this.code = code;
    this.statusCode = statusCode;
    this.transient = transient;
  }
}

const DEFAULT_HUBTEL_SMS_ENDPOINT = "https://smsc.hubtel.com/v1/messages/send";
const DEFAULT_HUBTEL_SMS_TIMEOUT_MS = 5_000;
const DEFAULT_HUBTEL_SMS_MAX_RETRIES = 3;
const DEFAULT_HUBTEL_SMS_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_HUBTEL_SMS_MAX_QUEUE_SIZE = 2_000;
const DEFAULT_HUBTEL_SMS_MAX_MESSAGE_LENGTH = 612;
const DEFAULT_HUBTEL_SMS_DEDUPE_WINDOW_MS = 20_000;
const DEFAULT_RETRY_BATCH_SIZE = 50;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_LOG_ERROR_MESSAGE_LENGTH = 500;

let configCache: SmsConfig | null = null;
let backgroundProcessingScheduled = false;

const getOrCreateCounter = (
  name: string,
  help: string,
  labelNames: string[],
): client.Counter<string> => {
  const existing = client.register.getSingleMetric(
    name,
  ) as client.Counter<string> | undefined;
  if (existing) return existing;

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
  if (existing) return existing;

  return new client.Gauge({
    name,
    help,
  });
};

const notificationSmsQueuedCounter = getOrCreateCounter(
  "in_app_notifications_sms_queued_total",
  "Count of notification SMS jobs queued",
  ["type"],
);

const notificationSmsSentCounter = getOrCreateCounter(
  "in_app_notifications_sms_sent_total",
  "Count of notification SMS messages sent successfully",
  ["type"],
);

const notificationSmsRetryCounter = getOrCreateCounter(
  "in_app_notifications_sms_retries_total",
  "Count of notification SMS retries scheduled",
  ["type"],
);

const notificationSmsFailureCounter = getOrCreateCounter(
  "in_app_notifications_sms_failures_total",
  "Count of notification SMS delivery failures",
  ["type", "reason"],
);

const notificationSmsDroppedCounter = getOrCreateCounter(
  "in_app_notifications_sms_dropped_total",
  "Count of notification SMS jobs dropped before dispatch",
  ["type", "reason"],
);

const notificationSmsQueueDepthGauge = getOrCreateGauge(
  "in_app_notifications_sms_queue_depth",
  "Current queued notification SMS jobs awaiting delivery",
);

const trimToNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const toBoundedPositiveInt = (
  value: string | undefined,
  fallback: number,
  max: number,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const normalizeEndpoint = (value: string | null): string =>
  (value || DEFAULT_HUBTEL_SMS_ENDPOINT).replace(/\/+$/, "");

const normalizeAuthHeader = (): string | null => {
  const providedToken = trimToNull(
    process.env.HUBTEL_SMS_AUTH_B64 || process.env.HUBTEL_AUTH,
  );
  if (providedToken) {
    const token = providedToken.replace(/^Basic\s+/i, "").trim();
    return token ? `Basic ${token}` : null;
  }

  const apiId = trimToNull(process.env.HUBTEL_API_ID);
  const authKey = trimToNull(process.env.HUBTEL_AUTH_KEY);
  if (!apiId || !authKey) return null;

  const token = Buffer.from(`${apiId}:${authKey}`).toString("base64");
  return `Basic ${token}`;
};

const sanitizeCountryCode = (countryCode: string | null | undefined): string => {
  if (!countryCode) return "";
  return countryCode.replace(/\D/g, "");
};

const normalizePhoneForHubtel = (
  phoneNumber: string | null | undefined,
  countryCode?: string | null,
): string | null => {
  const rawPhone = trimToNull(phoneNumber);
  if (!rawPhone) return null;

  const countryDigits = sanitizeCountryCode(countryCode);
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;

  let digits = cleaned;
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/\D/g, "");
  if (!digits) return null;

  if (countryDigits) {
    if (digits.startsWith("0")) {
      digits = `${countryDigits}${digits.slice(1)}`;
    } else if (!digits.startsWith(countryDigits) && digits.length <= 10) {
      digits = `${countryDigits}${digits}`;
    }
  }

  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
};

const normalizeMessage = (message: string, maxLength: number): string => {
  const trimmed = String(message || "").trim();
  if (!trimmed) return "";
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getFirstStringValue = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const hasExplicitFailure = (payload: unknown): boolean => {
  const record = toRecord(payload);
  if (!record) return false;

  if (record.success === false) return true;

  const responseCode = getFirstStringValue(record, ["responseCode", "ResponseCode"]);
  if (
    responseCode &&
    !["0", "0000", "200", "success", "SUCCESS"].includes(responseCode)
  ) {
    return true;
  }

  const status = getFirstStringValue(record, ["status", "Status"]);
  if (
    status &&
    ["failed", "error", "rejected", "unsuccessful"].includes(status.toLowerCase())
  ) {
    return true;
  }

  if (typeof record.error === "string" && record.error.trim()) {
    return true;
  }

  return false;
};

const getFailureMessage = (payload: unknown): string | null => {
  const record = toRecord(payload);
  if (!record) return null;

  const directMessage = getFirstStringValue(record, [
    "message",
    "Message",
    "error",
    "Error",
    "description",
  ]);
  if (directMessage) return directMessage;

  const errors = record.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0];
    if (typeof firstError === "string" && firstError.trim()) {
      return firstError.trim();
    }
    const firstErrorRecord = toRecord(firstError);
    if (firstErrorRecord) {
      const nestedMessage = getFirstStringValue(firstErrorRecord, [
        "message",
        "Message",
        "error",
        "Error",
      ]);
      if (nestedMessage) return nestedMessage;
    }
  }

  return null;
};

const delayForRetry = (attempt: number, baseDelayMs: number): number => {
  const jitter = Math.floor(Math.random() * 50);
  return Math.min(baseDelayMs * 2 ** Math.max(attempt - 1, 0) + jitter, 5_000);
};

const getRetryBatchSize = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_RETRY_BATCH_SIZE;
  }

  return Math.min(parsed, 500);
};

const buildIdempotencyKey = (args: {
  notificationId?: number | null;
  recipientUserId: number;
  notificationType: string;
  dedupeKey?: string | null;
  phoneNumber: string;
  message: string;
  dedupeWindowMs: number;
}): string => {
  const notificationId = toPositiveInt(args.notificationId);
  if (notificationId) {
    return `notification:${notificationId}`;
  }

  const explicit = trimToNull(args.dedupeKey);
  if (explicit) {
    return `dedupe:${args.recipientUserId}:${args.notificationType}:${explicit}`;
  }

  const windowBucket = Math.floor(Date.now() / Math.max(args.dedupeWindowMs, 1_000));
  return createHash("sha1")
    .update(
      `${args.recipientUserId}|${args.notificationType}|${args.phoneNumber}|${args.message}|${windowBucket}`,
    )
    .digest("hex");
};

const normalizeErrorForMetrics = (
  error: unknown,
): { code: string; transient: boolean; message: string; statusCode: number | null } => {
  if (error instanceof HubtelSmsRequestError) {
    return {
      code: error.code || "hubtel_error",
      transient: error.transient,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  const record = toRecord(error);
  const code = getFirstStringValue(record || {}, ["code"]) || "unknown_error";
  const message =
    getFirstStringValue(record || {}, ["message"]) || "Hubtel SMS delivery failed";
  return {
    code,
    transient: true,
    message,
    statusCode: null,
  };
};

const resolveConfig = (): SmsConfig => {
  const enabledByEnv = parseBooleanEnv(process.env.HUBTEL_SMS_ENABLED, true);
  const endpoint = normalizeEndpoint(
    trimToNull(process.env.HUBTEL_SMS_URL || process.env.HUBTEL_SMS_ENDPOINT),
  );
  const senderId =
    trimToNull(process.env.HUBTEL_SMS_SENDER_ID || process.env.HUBTEL_SENDER_ID) || "";
  const authHeader = normalizeAuthHeader() || "";
  const timeoutMs = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_TIMEOUT_MS,
    DEFAULT_HUBTEL_SMS_TIMEOUT_MS,
    60_000,
  );
  const maxRetries = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_MAX_RETRIES,
    DEFAULT_HUBTEL_SMS_MAX_RETRIES,
    10,
  );
  const retryBaseDelayMs = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_RETRY_BASE_DELAY_MS,
    DEFAULT_HUBTEL_SMS_RETRY_BASE_DELAY_MS,
    30_000,
  );
  const maxPendingJobs = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_MAX_QUEUE_SIZE,
    DEFAULT_HUBTEL_SMS_MAX_QUEUE_SIZE,
    50_000,
  );
  const maxMessageLength = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_MAX_MESSAGE_LENGTH,
    DEFAULT_HUBTEL_SMS_MAX_MESSAGE_LENGTH,
    2_000,
  );
  const dedupeWindowMs = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_DEDUPE_WINDOW_MS,
    DEFAULT_HUBTEL_SMS_DEDUPE_WINDOW_MS,
    600_000,
  );

  const enabled = enabledByEnv && Boolean(endpoint && senderId && authHeader);

  return {
    enabled,
    endpoint,
    senderId,
    authHeader,
    timeoutMs,
    maxRetries,
    retryBaseDelayMs,
    maxPendingJobs,
    maxMessageLength,
    dedupeWindowMs,
  };
};

const getConfig = (): SmsConfig => {
  if (!configCache) {
    configCache = resolveConfig();
  }

  return configCache;
};

const refreshSmsQueueDepthGauge = async () => {
  try {
    const pendingCount = await prisma.notification_sms_delivery_job.count({
      where: {
        status: "PENDING",
      },
    });
    notificationSmsQueueDepthGauge.set(pendingCount);
  } catch (error) {
    // Metric updates should never interrupt request flow.
  }
};

const updateNotificationSmsState = async (args: {
  notificationId?: number | null;
  status: "PENDING" | "PROCESSING" | "SENT" | "DEAD";
  queuedAt?: Date | null;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) => {
  const notificationId = toPositiveInt(args.notificationId);
  if (!notificationId) {
    return;
  }

  await prisma.in_app_notification.updateMany({
    where: {
      id: notificationId,
    },
    data: {
      sms_delivery_status: args.status,
      sms_queued_at: args.queuedAt === undefined ? undefined : args.queuedAt,
      sms_last_attempt_at:
        args.lastAttemptAt === undefined ? undefined : args.lastAttemptAt,
      sms_sent_at: args.sentAt === undefined ? undefined : args.sentAt,
      sms_last_error_code:
        args.errorCode === undefined
          ? undefined
          : args.errorCode
            ? truncate(args.errorCode, 64)
            : null,
      sms_last_error_message:
        args.errorMessage === undefined
          ? undefined
          : args.errorMessage
            ? truncate(args.errorMessage, 1024)
            : null,
    },
  });
};

const postJson = async (
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }

    return {
      response,
      payload,
      raw,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new HubtelSmsRequestError(
        "Hubtel SMS request timed out",
        "timeout",
        null,
        true,
      );
    }
    throw new HubtelSmsRequestError(
      error instanceof Error ? error.message : "Hubtel SMS request failed",
      "network_error",
      null,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
};

const sendHubtelSms = async (
  job: SmsJobPayload,
  config: SmsConfig,
): Promise<void> => {
  const headers = {
    Authorization: config.authHeader,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const payloadCandidates: Record<string, unknown>[] = [
    {
      From: config.senderId,
      To: [job.phoneNumber],
      Content: job.message,
    },
    {
      from: config.senderId,
      to: [job.phoneNumber],
      content: job.message,
    },
    {
      From: config.senderId,
      To: job.phoneNumber,
      Content: job.message,
    },
    {
      from: config.senderId,
      to: job.phoneNumber,
      content: job.message,
    },
  ];

  let lastError: HubtelSmsRequestError | null = null;

  for (const payload of payloadCandidates) {
    const { response, payload: bodyPayload, raw } = await postJson(
      config.endpoint,
      headers,
      payload,
      config.timeoutMs,
    );

    if (!response.ok) {
      const reason =
        getFailureMessage(bodyPayload) || raw.slice(0, MAX_LOG_ERROR_MESSAGE_LENGTH);
      const shouldRetry = TRANSIENT_STATUS_CODES.has(response.status);
      lastError = new HubtelSmsRequestError(
        reason || `Hubtel SMS HTTP ${response.status}`,
        `http_${response.status}`,
        response.status,
        shouldRetry,
      );

      if (response.status >= 400 && response.status < 500) {
        continue;
      }

      throw lastError;
    }

    if (hasExplicitFailure(bodyPayload)) {
      const reason =
        getFailureMessage(bodyPayload) || "Hubtel SMS response indicates failure";
      lastError = new HubtelSmsRequestError(reason, "response_failure", 200, false);
      continue;
    }

    return;
  }

  throw (
    lastError ||
    new HubtelSmsRequestError(
      "Hubtel SMS request rejected all payload variants",
      "payload_variant_rejected",
      null,
      false,
    )
  );
};

const findExistingJobForDedupedRequest = async (args: {
  notificationId?: number | null;
  idempotencyKey: string;
}) => {
  const notificationId = toPositiveInt(args.notificationId);
  if (notificationId) {
    return prisma.notification_sms_delivery_job.findUnique({
      where: {
        notification_id: notificationId,
      },
      select: {
        id: true,
      },
    });
  }

  return prisma.notification_sms_delivery_job.findUnique({
    where: {
      idempotency_key: args.idempotencyKey,
    },
    select: {
      id: true,
    },
  });
};

const markNotificationDeadOnDrop = async (args: {
  notificationId?: number | null;
  code: SmsQueueDropReason;
  message: string;
}) => {
  await updateNotificationSmsState({
    notificationId: args.notificationId,
    status: "DEAD",
    errorCode: args.code.toUpperCase(),
    errorMessage: args.message,
  });
};

const queueNotificationSms = async (
  input: QueueNotificationSmsInput,
): Promise<QueueNotificationSmsResult> => {
  const config = getConfig();
  const notificationType = String(input.notificationType || "generic").trim() || "generic";

  if (!config.enabled) {
    notificationSmsDroppedCounter.labels(notificationType, "disabled").inc();
    await markNotificationDeadOnDrop({
      notificationId: input.notificationId,
      code: "disabled",
      message: "SMS delivery is not configured for this environment",
    });
    return {
      queued: false,
      disabled: true,
      reason: "disabled",
    };
  }

  const normalizedMessage = normalizeMessage(input.message, config.maxMessageLength);
  if (!normalizedMessage) {
    notificationSmsDroppedCounter.labels(notificationType, "empty_message").inc();
    await markNotificationDeadOnDrop({
      notificationId: input.notificationId,
      code: "empty_message",
      message: "SMS message is empty after normalization",
    });
    return {
      queued: false,
      disabled: false,
      reason: "empty_message",
    };
  }

  const normalizedPhone = normalizePhoneForHubtel(input.phoneNumber, input.countryCode);
  if (!normalizedPhone) {
    notificationSmsDroppedCounter.labels(notificationType, "invalid_phone").inc();
    await markNotificationDeadOnDrop({
      notificationId: input.notificationId,
      code: "invalid_phone",
      message: "Recipient phone number is invalid for SMS delivery",
    });
    return {
      queued: false,
      disabled: false,
      reason: "invalid_phone",
    };
  }

  const queuedCount = await prisma.notification_sms_delivery_job.count({
    where: {
      status: {
        in: ["PENDING", "PROCESSING"],
      },
    },
  });
  if (queuedCount >= config.maxPendingJobs) {
    notificationSmsDroppedCounter.labels(notificationType, "queue_full").inc();
    await markNotificationDeadOnDrop({
      notificationId: input.notificationId,
      code: "queue_full",
      message: "SMS delivery queue is at capacity",
    });
    return {
      queued: false,
      disabled: false,
      reason: "queue_full",
    };
  }

  const notificationId = toPositiveInt(input.notificationId);
  const idempotencyKey = buildIdempotencyKey({
    notificationId,
    recipientUserId: input.recipientUserId,
    notificationType,
    dedupeKey: input.dedupeKey,
    phoneNumber: normalizedPhone,
    message: normalizedMessage,
    dedupeWindowMs: config.dedupeWindowMs,
  });
  const dedupeKey = trimToNull(input.dedupeKey);
  const now = new Date();

  try {
    await prisma.notification_sms_delivery_job.create({
      data: {
        notification_id: notificationId,
        user_id: input.recipientUserId,
        notification_type: notificationType,
        dedupe_key: dedupeKey,
        idempotency_key: idempotencyKey,
        phone_number: normalizedPhone,
        message: normalizedMessage,
        status: "PENDING",
        next_attempt_at: now,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findExistingJobForDedupedRequest({
        notificationId,
        idempotencyKey,
      });
      if (existing) {
        notificationSmsDroppedCounter.labels(notificationType, "deduped").inc();
        return {
          queued: false,
          disabled: false,
          reason: "deduped",
        };
      }
    }

    throw error;
  }

  notificationSmsQueuedCounter.labels(notificationType).inc();
  await updateNotificationSmsState({
    notificationId,
    status: "PENDING",
    queuedAt: now,
    errorCode: null,
    errorMessage: null,
  });
  await refreshSmsQueueDepthGauge();
  triggerPendingSmsDeliveryJobProcessing();

  return {
    queued: true,
    disabled: false,
    reason: null,
  };
};

const processPendingSmsDeliveryJobs = async (args?: {
  batchSize?: number;
}): Promise<SmsRetryProcessingSummary> => {
  const config = getConfig();
  if (!config.enabled) {
    return {
      processed: 0,
      sent: 0,
      requeued: 0,
      dead: 0,
    };
  }

  const batchSize = getRetryBatchSize(
    args?.batchSize ?? process.env.HUBTEL_SMS_RETRY_BATCH_SIZE,
  );
  const now = new Date();
  const dueJobs = await prisma.notification_sms_delivery_job.findMany({
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
      const claimed = await prisma.notification_sms_delivery_job.updateMany({
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

      processed += 1;
      const attemptStartedAt = new Date();
      await updateNotificationSmsState({
        notificationId: dueJob.notification_id,
        status: "PROCESSING",
        lastAttemptAt: attemptStartedAt,
      });

      const retryAttemptNumber = dueJob.attempts + 1;

      try {
        await sendHubtelSms(
          {
            notificationType: dueJob.notification_type,
            recipientUserId: dueJob.user_id,
            phoneNumber: dueJob.phone_number,
            message: dueJob.message,
          },
          config,
        );

        await prisma.notification_sms_delivery_job.updateMany({
          where: {
            id: dueJob.id,
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

        notificationSmsSentCounter.labels(dueJob.notification_type).inc();
        await updateNotificationSmsState({
          notificationId: dueJob.notification_id,
          status: "SENT",
          lastAttemptAt: attemptStartedAt,
          sentAt: new Date(),
          errorCode: null,
          errorMessage: null,
        });
        sent += 1;
      } catch (error) {
        const normalized = normalizeErrorForMetrics(error);
        const retryAt = new Date();

        if (normalized.transient && retryAttemptNumber < config.maxRetries) {
          notificationSmsRetryCounter.labels(dueJob.notification_type).inc();
          await prisma.notification_sms_delivery_job.updateMany({
            where: {
              id: dueJob.id,
            },
            data: {
              status: "PENDING",
              attempts: retryAttemptNumber,
              next_attempt_at: new Date(
                Date.now() + delayForRetry(retryAttemptNumber, config.retryBaseDelayMs),
              ),
              last_error_code: truncate(normalized.code, 64),
              last_error_message: truncate(normalized.message, 1024),
              last_error_at: retryAt,
            },
          });

          await updateNotificationSmsState({
            notificationId: dueJob.notification_id,
            status: "PENDING",
            lastAttemptAt: attemptStartedAt,
            errorCode: normalized.code,
            errorMessage: normalized.message,
          });
          requeued += 1;
          continue;
        }

        notificationSmsFailureCounter
          .labels(dueJob.notification_type, normalized.code)
          .inc();
        await prisma.notification_sms_delivery_job.updateMany({
          where: {
            id: dueJob.id,
          },
          data: {
            status: "DEAD",
            attempts: retryAttemptNumber,
            last_error_code: truncate(normalized.code, 64),
            last_error_message: truncate(normalized.message, 1024),
            last_error_at: retryAt,
          },
        });

        await updateNotificationSmsState({
          notificationId: dueJob.notification_id,
          status: "DEAD",
          lastAttemptAt: attemptStartedAt,
          errorCode: normalized.code,
          errorMessage: normalized.message,
        });

        const safeMessage = truncate(normalized.message, MAX_LOG_ERROR_MESSAGE_LENGTH);
        console.warn(
          `[WARN] SMS delivery failed: type=${dueJob.notification_type} recipient=${dueJob.user_id} status=${normalized.statusCode ?? "unknown"} code=${normalized.code} error=${safeMessage}`,
        );
        dead += 1;
      }
    } catch (error) {
      const normalized = normalizeErrorForMetrics(error);
      await prisma.notification_sms_delivery_job.updateMany({
        where: {
          id: dueJob.id,
          status: "PROCESSING",
        },
        data: {
          status: "PENDING",
          next_attempt_at: new Date(
            Date.now() + delayForRetry(1, config.retryBaseDelayMs),
          ),
          last_error_code: "PROCESSING_ERROR",
          last_error_message: truncate(normalized.message, 1024),
          last_error_at: new Date(),
        },
      });

      await updateNotificationSmsState({
        notificationId: dueJob.notification_id,
        status: "PENDING",
        errorCode: "PROCESSING_ERROR",
        errorMessage: normalized.message,
      });

      console.error(
        `[ERROR] SMS retry processing failed for job=${dueJob.id}: ${normalized.message}`,
      );
    }
  }

  await refreshSmsQueueDepthGauge();
  return {
    processed,
    sent,
    requeued,
    dead,
  };
};

const triggerPendingSmsDeliveryJobProcessing = () => {
  if (backgroundProcessingScheduled) {
    return;
  }

  backgroundProcessingScheduled = true;
  setImmediate(() => {
    backgroundProcessingScheduled = false;
    void processPendingSmsDeliveryJobs().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ERROR] Background SMS delivery processing failed: ${truncate(message, MAX_LOG_ERROR_MESSAGE_LENGTH)}`,
      );
    });
  });
};

const isSmsEnabled = (): boolean => getConfig().enabled;

export const notificationSmsService = {
  isSmsEnabled,
  normalizePhoneForHubtel,
  queueNotificationSms,
  processPendingSmsDeliveryJobs,
  triggerPendingSmsDeliveryJobProcessing,
};
