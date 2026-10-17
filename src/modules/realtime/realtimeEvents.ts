/**
 * The realtime event catalogue — the contract with the web dashboard and the
 * mobile app. Mirrored for client developers in docs/REALTIME_EVENTS.md; keep
 * the two in step.
 *
 * Bodies are thin signals (ids, tiny values). Clients invalidate their cache
 * and refetch through REST. The notification events are the documented
 * exception: they keep the bodies the SSE stream already sends.
 */

export const REALTIME_EVENT_VERSION = 1 as const;

export type SessionChangeReason = "permissions" | "departments" | "profile";
export type SessionRevokeReason = "deactivated" | "deleted" | "password_reset";

export type RealtimeEventMap = {
  "session.changed": { reasons: SessionChangeReason[] };
  "session.revoked": { reason: SessionRevokeReason };
  notification: Record<string, unknown>;
  notification_updated: Record<string, unknown>;
  notifications_read_all: Record<string, unknown>;
  notifications_cleared: Record<string, unknown>;
  notifications_deleted: Record<string, unknown>;
  unread_count: { unreadCount: number };
  "rides.changed": { eventId: number | null; offerId: number };
  "rides.catalog_changed": { eventId: number };
};

export type RealtimeEventName = keyof RealtimeEventMap;

export type RealtimeEnvelope<B extends object = Record<string, unknown>> = B & {
  v: typeof REALTIME_EVENT_VERSION;
  at: string;
};

export const buildEnvelope = <B extends object>(
  body: B,
  now: Date = new Date(),
): RealtimeEnvelope<B> => ({
  ...body,
  v: REALTIME_EVENT_VERSION,
  at: now.toISOString(),
});
