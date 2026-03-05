import { createHash } from "crypto";
import client from "prom-client";

type SmsQueueDropReason =
  | "disabled"
  | "invalid_phone"
  | "empty_message"
  | "queue_full"
  | "deduped";

type QueueNotificationSmsInput = {
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

type SmsQueueJob = {
  notificationType: string;
  recipientUserId: number;
  phoneNumber: string;
  message: string;
  attempt: number;
};

type SmsConfig = {
  enabled: boolean;
  endpoint: string;
  senderId: string;
  authHeader: string;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
  retryBaseDelayMs: number;
  maxQueueSize: number;
  maxMessageLength: number;
  dedupeWindowMs: number;
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
const DEFAULT_HUBTEL_SMS_CONCURRENCY = 4;
const DEFAULT_HUBTEL_SMS_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_HUBTEL_SMS_MAX_QUEUE_SIZE = 2_000;
const DEFAULT_HUBTEL_SMS_MAX_MESSAGE_LENGTH = 612;
const DEFAULT_HUBTEL_SMS_DEDUPE_WINDOW_MS = 20_000;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_LOG_ERROR_MESSAGE_LENGTH = 500;

const smsQueue: SmsQueueJob[] = [];
const dedupeTracker = new Map<string, number>();
let activeWorkers = 0;
let queuePumpScheduled = false;
let lastDedupePruneAt = 0;

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

const toBoundedPositiveInt = (
  value: string | undefined,
  fallback: number,
  max: number,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeEndpoint = (value: string | null): string =>
  (value || DEFAULT_HUBTEL_SMS_ENDPOINT).replace(/\/+$/, "");

const normalizeAuthHeader = (): string | null => {
  const providedToken = trimToNull(process.env.HUBTEL_SMS_AUTH_B64 || process.env.HUBTEL_AUTH);
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
  if (status && ["failed", "error", "rejected", "unsuccessful"].includes(status.toLowerCase())) {
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

const buildDedupeToken = (args: {
  recipientUserId: number;
  notificationType: string;
  dedupeKey?: string | null;
  phoneNumber: string;
  message: string;
}): string => {
  const explicit = trimToNull(args.dedupeKey);
  if (explicit) {
    return `${args.recipientUserId}:${args.notificationType}:${explicit}`;
  }

  return createHash("sha1")
    .update(
      `${args.recipientUserId}|${args.notificationType}|${args.phoneNumber}|${args.message}`,
    )
    .digest("hex");
};

const pruneOldDedupeTokens = (dedupeWindowMs: number) => {
  const now = Date.now();
  if (now - lastDedupePruneAt < Math.max(Math.floor(dedupeWindowMs / 2), 5_000)) {
    return;
  }
  lastDedupePruneAt = now;

  for (const [token, timestamp] of dedupeTracker.entries()) {
    if (now - timestamp > dedupeWindowMs) {
      dedupeTracker.delete(token);
    }
  }
};

let configCache: SmsConfig | null = null;

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
  const concurrency = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_CONCURRENCY,
    DEFAULT_HUBTEL_SMS_CONCURRENCY,
    20,
  );
  const retryBaseDelayMs = toBoundedPositiveInt(
    process.env.HUBTEL_SMS_RETRY_BASE_DELAY_MS,
    DEFAULT_HUBTEL_SMS_RETRY_BASE_DELAY_MS,
    30_000,
  );
  const maxQueueSize = toBoundedPositiveInt(
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
    concurrency,
    retryBaseDelayMs,
    maxQueueSize,
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

const scheduleQueuePump = () => {
  if (queuePumpScheduled) return;

  queuePumpScheduled = true;
  setImmediate(() => {
    queuePumpScheduled = false;
    runQueueWorkers();
  });
};

const enqueueJob = (
  job: SmsQueueJob,
  config: SmsConfig,
  reasonOnDrop: "queue_full" = "queue_full",
): boolean => {
  if (smsQueue.length >= config.maxQueueSize) {
    notificationSmsDroppedCounter.labels(job.notificationType, reasonOnDrop).inc();
    return false;
  }

  smsQueue.push(job);
  notificationSmsQueueDepthGauge.set(smsQueue.length);
  notificationSmsQueuedCounter.labels(job.notificationType).inc();
  scheduleQueuePump();
  return true;
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
  job: SmsQueueJob,
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

      // Try another payload shape for 4xx validation issues only.
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

const scheduleRetry = (job: SmsQueueJob, config: SmsConfig) => {
  const nextAttempt = job.attempt + 1;
  notificationSmsRetryCounter.labels(job.notificationType).inc();
  const delayMs = delayForRetry(nextAttempt, config.retryBaseDelayMs);

  setTimeout(() => {
    const queued = enqueueJob(
      {
        ...job,
        attempt: nextAttempt,
      },
      config,
      "queue_full",
    );

    if (!queued) {
      notificationSmsFailureCounter
        .labels(job.notificationType, "queue_full_retry")
        .inc();
    }
  }, delayMs);
};

const dispatchJob = async (job: SmsQueueJob, config: SmsConfig) => {
  try {
    await sendHubtelSms(job, config);
    notificationSmsSentCounter.labels(job.notificationType).inc();
  } catch (error) {
    const normalized = normalizeErrorForMetrics(error);
    if (normalized.transient && job.attempt < config.maxRetries) {
      scheduleRetry(job, config);
      return;
    }

    notificationSmsFailureCounter.labels(job.notificationType, normalized.code).inc();
    const safeMessage = normalized.message.slice(0, MAX_LOG_ERROR_MESSAGE_LENGTH);
    console.warn(
      `[WARN] SMS delivery failed: type=${job.notificationType} recipient=${job.recipientUserId} status=${normalized.statusCode ?? "unknown"} code=${normalized.code} error=${safeMessage}`,
    );
  }
};

const runQueueWorkers = () => {
  const config = getConfig();

  while (activeWorkers < config.concurrency) {
    const job = smsQueue.shift();
    if (!job) {
      notificationSmsQueueDepthGauge.set(0);
      return;
    }

    notificationSmsQueueDepthGauge.set(smsQueue.length);
    activeWorkers += 1;
    void dispatchJob(job, config).finally(() => {
      activeWorkers -= 1;
      scheduleQueuePump();
    });
  }
};

const queueNotificationSms = (
  input: QueueNotificationSmsInput,
): QueueNotificationSmsResult => {
  const config = getConfig();
  const notificationType = String(input.notificationType || "generic").trim() || "generic";

  if (!config.enabled) {
    notificationSmsDroppedCounter.labels(notificationType, "disabled").inc();
    return {
      queued: false,
      disabled: true,
      reason: "disabled",
    };
  }

  const normalizedMessage = normalizeMessage(input.message, config.maxMessageLength);
  if (!normalizedMessage) {
    notificationSmsDroppedCounter.labels(notificationType, "empty_message").inc();
    return {
      queued: false,
      disabled: false,
      reason: "empty_message",
    };
  }

  const normalizedPhone = normalizePhoneForHubtel(input.phoneNumber, input.countryCode);
  if (!normalizedPhone) {
    notificationSmsDroppedCounter.labels(notificationType, "invalid_phone").inc();
    return {
      queued: false,
      disabled: false,
      reason: "invalid_phone",
    };
  }

  pruneOldDedupeTokens(config.dedupeWindowMs);
  const dedupeToken = buildDedupeToken({
    recipientUserId: input.recipientUserId,
    notificationType,
    dedupeKey: input.dedupeKey,
    phoneNumber: normalizedPhone,
    message: normalizedMessage,
  });

  const existingTimestamp = dedupeTracker.get(dedupeToken);
  if (existingTimestamp && Date.now() - existingTimestamp < config.dedupeWindowMs) {
    notificationSmsDroppedCounter.labels(notificationType, "deduped").inc();
    return {
      queued: false,
      disabled: false,
      reason: "deduped",
    };
  }

  const queued = enqueueJob(
    {
      notificationType,
      recipientUserId: input.recipientUserId,
      phoneNumber: normalizedPhone,
      message: normalizedMessage,
      attempt: 0,
    },
    config,
    "queue_full",
  );

  if (!queued) {
    return {
      queued: false,
      disabled: false,
      reason: "queue_full",
    };
  }

  dedupeTracker.set(dedupeToken, Date.now());
  return {
    queued: true,
    disabled: false,
    reason: null,
  };
};

const isSmsEnabled = (): boolean => getConfig().enabled;

export const notificationSmsService = {
  isSmsEnabled,
  normalizePhoneForHubtel,
  queueNotificationSms,
};
