import { prisma } from "../../Models/context";

// expo-server-sdk ships as ESM-only. This service is compiled to CommonJS
// (module: NodeNext), so the module must be pulled in via a value-position
// dynamic import() which is preserved at runtime. Static type references to
// the package (import type / typeof import) trip TS1479 under this config, so
// the surface used here is described with local structural types instead. The
// resolved module is cached after the first load.
type ExpoPushMessageLike = {
  to: string;
  sound: "default";
  title: string;
  body: string;
  priority: "high" | "normal";
  data: Record<string, unknown>;
};

type ExpoPushTicketLike = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string } | null;
};

type ExpoClientLike = {
  chunkPushNotifications(messages: ExpoPushMessageLike[]): ExpoPushMessageLike[][];
  sendPushNotificationsAsync(
    messages: ExpoPushMessageLike[],
  ): Promise<ExpoPushTicketLike[]>;
};

type ExpoStatic = {
  new (options?: { accessToken?: string }): ExpoClientLike;
  isExpoPushToken(token: unknown): boolean;
};

type ExpoModuleLike = { Expo: ExpoStatic };

let expoModulePromise: Promise<ExpoModuleLike> | null = null;

const loadExpo = (): Promise<ExpoModuleLike> => {
  if (!expoModulePromise) {
    expoModulePromise = import("expo-server-sdk") as unknown as Promise<ExpoModuleLike>;
  }

  return expoModulePromise;
};

export type ExpoPushPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ExpoPushDispatchInput = {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  priority: ExpoPushPriority;
};

type DeviceTokenRow = {
  id: string;
  token: string;
};

const MAX_ERROR_MESSAGE_LENGTH = 1024;

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

const normalizePlatform = (value: unknown): string => {
  const trimmed = trimToNull(value);
  if (!trimmed) return "unknown";

  return truncate(trimmed.toLowerCase(), 32);
};

const registerDeviceToken = async (
  userId: number,
  input: { token: string; platform?: string; deviceId?: string },
): Promise<{ ok: true }> => {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) {
    return { ok: true };
  }

  const token = trimToNull(input?.token);
  if (!token) {
    return { ok: true };
  }

  const { Expo } = await loadExpo();
  if (!Expo.isExpoPushToken(token)) {
    return { ok: true };
  }

  const platform = normalizePlatform(input?.platform);
  const deviceId = input?.deviceId
    ? truncate(String(input.deviceId).trim(), 191) || null
    : null;
  const now = new Date();

  await prisma.notification_device_token.upsert({
    where: {
      token,
    },
    create: {
      user_id: parsedUserId,
      token,
      platform,
      device_id: deviceId,
      is_active: true,
      last_seen_at: now,
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
    },
    update: {
      user_id: parsedUserId,
      platform,
      device_id: deviceId,
      is_active: true,
      last_seen_at: now,
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
    },
  });

  return { ok: true };
};

const unregisterDeviceToken = async (
  userId: number,
  token: string,
): Promise<{ ok: true }> => {
  const parsedUserId = toPositiveInt(userId);
  const normalizedToken = trimToNull(token);

  if (!parsedUserId || !normalizedToken) {
    return { ok: true };
  }

  await prisma.notification_device_token.updateMany({
    where: {
      user_id: parsedUserId,
      token: normalizedToken,
    },
    data: {
      is_active: false,
      last_seen_at: new Date(),
    },
  });

  return { ok: true };
};

const listActiveTokensForUser = async (
  userId: number,
): Promise<DeviceTokenRow[]> => {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) {
    return [];
  }

  return prisma.notification_device_token.findMany({
    where: {
      user_id: parsedUserId,
      is_active: true,
    },
    select: {
      id: true,
      token: true,
    },
  });
};

const deactivateDeviceToken = async (args: {
  tokenId: string;
  code: string;
  message: string;
}): Promise<void> => {
  try {
    await prisma.notification_device_token.updateMany({
      where: {
        id: args.tokenId,
      },
      data: {
        is_active: false,
        last_error_code: truncate(args.code, 64),
        last_error_message: truncate(args.message, 1024),
        last_error_at: new Date(),
      },
    });
  } catch (error) {
    // Never throw from a failure-handling path.
  }
};

const deliverExpoPush = async (
  notification: ExpoPushDispatchInput,
  userId: number,
): Promise<{ sent: number; failed: number }> => {
  let sent = 0;
  let failed = 0;

  try {
    const tokens = await listActiveTokensForUser(userId);
    if (!tokens.length) {
      return { sent, failed };
    }

    const { Expo } = await loadExpo();

    const priority: "high" | "normal" =
      notification.priority === "HIGH" || notification.priority === "CRITICAL"
        ? "high"
        : "normal";

    const tokenById = new Map<string, DeviceTokenRow>();
    const messages: ExpoPushMessageLike[] = [];

    for (const tokenRow of tokens) {
      if (!Expo.isExpoPushToken(tokenRow.token)) {
        await deactivateDeviceToken({
          tokenId: tokenRow.id,
          code: "InvalidToken",
          message: "Stored token is not a valid Expo push token",
        });
        continue;
      }

      tokenById.set(tokenRow.token, tokenRow);
      messages.push({
        to: tokenRow.token,
        sound: "default",
        title: notification.title,
        body: notification.body,
        priority,
        data: {
          notificationId: notification.id,
          type: notification.type,
          entityType: notification.entityType,
          entityId: notification.entityId,
          actionUrl: notification.actionUrl,
          priority: notification.priority,
        },
      });
    }

    if (!messages.length) {
      return { sent, failed };
    }

    const expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    });
    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      let tickets: ExpoPushTicketLike[] = [];
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        failed += chunk.length;
        console.error(
          `[WARN] Expo push chunk send failed: user=${userId} notification=${notification.id} error=${truncate(
            error instanceof Error ? error.message : String(error),
            MAX_ERROR_MESSAGE_LENGTH,
          )}`,
        );
        continue;
      }

      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index];
        const message = chunk[index];
        const to = message?.to;

        if (ticket.status === "ok") {
          sent += 1;
          continue;
        }

        failed += 1;
        const errorCode = trimToNull(ticket.details?.error) || "ExpoPushError";
        const errorMessage = trimToNull(ticket.message) || "Expo push failed";

        const tokenRow = to ? tokenById.get(to) : undefined;
        if (tokenRow && ticket.details?.error === "DeviceNotRegistered") {
          await deactivateDeviceToken({
            tokenId: tokenRow.id,
            code: errorCode,
            message: errorMessage,
          });
        }
      }
    }
  } catch (error) {
    console.error(
      `[ERROR] Expo push delivery failed: user=${userId} notification=${notification?.id} error=${truncate(
        error instanceof Error ? error.message : String(error),
        MAX_ERROR_MESSAGE_LENGTH,
      )}`,
    );
  }

  return { sent, failed };
};

export const notificationDeviceService = {
  registerDeviceToken,
  unregisterDeviceToken,
  listActiveTokensForUser,
  deliverExpoPush,
};
