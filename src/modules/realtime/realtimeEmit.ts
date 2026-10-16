import client from "prom-client";
import logger from "../../utils/logger-config";
import { buildEnvelope, type RealtimeEventMap, type RealtimeEventName } from "./realtimeEvents";

/**
 * The only way the rest of the backend sends a realtime event.
 *
 * Fire-and-forget: a missing server (not attached yet, a unit test, a
 * cron-only process) or a failing emit is logged and swallowed, never thrown —
 * realtime is best-effort on top of REST and must not fail a request.
 *
 * Adding the Redis adapter later changes realtimeServer.ts only; callers keep
 * using these helpers.
 */

/** The slice of socket.io's Server this module uses — small enough to fake in tests. */
export type RealtimeIo = {
  to(target: string | string[]): { emit(event: string, body: unknown): boolean };
  in(room: string): { disconnectSockets(close?: boolean): void };
};

let io: RealtimeIo | null = null;

export const setRealtimeServer = (server: RealtimeIo | null) => {
  io = server;
};

export const userRoom = (userId: number) => `user:${userId}`;

// Reuse an already-registered metric instead of throwing "already registered".
const emitsTotal =
  (client.register.getSingleMetric("realtime_emits_total") as
    | client.Counter<"event">
    | undefined) ??
  new client.Counter({
    name: "realtime_emits_total",
    help: "Realtime events emitted, by event name",
    labelNames: ["event"],
  });

const isPositiveInt = (value: number) => Number.isInteger(value) && value > 0;

const send = <N extends RealtimeEventName>(
  target: string | string[],
  event: N,
  body: RealtimeEventMap[N],
) => {
  if (!io) return;
  try {
    io.to(target).emit(event, buildEnvelope(body));
    emitsTotal.inc({ event });
  } catch (error) {
    logger.warn(`[realtime] emit ${event} failed: ${(error as Error)?.message ?? error}`);
  }
};

export const toUser = <N extends RealtimeEventName>(
  userIds: number | number[],
  event: N,
  body: RealtimeEventMap[N],
) => {
  const rooms = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(isPositiveInt)
    .map(userRoom);
  if (!rooms.length) return;
  send(rooms, event, body);
};

export const toRoom = <N extends RealtimeEventName>(
  room: string,
  event: N,
  body: RealtimeEventMap[N],
) => send(room, event, body);

export const toTopic = <N extends RealtimeEventName>(
  topic: string,
  event: N,
  body: RealtimeEventMap[N],
) => send(topic, event, body);

export const disconnectUser = (userId: number) => {
  if (!io || !isPositiveInt(userId)) return;
  try {
    io.in(userRoom(userId)).disconnectSockets(true);
  } catch (error) {
    logger.warn(`[realtime] disconnect user=${userId} failed: ${(error as Error)?.message ?? error}`);
  }
};
