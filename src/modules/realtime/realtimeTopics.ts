import type { RealtimeUser } from "./realtimeAuth";

/**
 * Client-requested subscriptions for frequent, screen-bound events (e.g. an
 * event's ride catalog while a ride screen is open: `ride-event:<id>`).
 * Each topic family registers an authorizer by prefix from its feature module
 * at boot (see rides/rideTopics.ts). The audience prefixes are reserved.
 */

export const MAX_TOPICS_PER_SOCKET = 20;
export const SUBSCRIBES_PER_SECOND = 10;

const RESERVED_PREFIXES = new Set(["user", "branch", "dept", "all"]);
const TOPIC_PATTERN = /^([a-z][a-z-]{0,31}):([A-Za-z0-9_-]{1,64})$/;

export type TopicAuthorizer = (user: RealtimeUser, id: string) => Promise<boolean>;

export type TopicAck =
  | { ok: true }
  | { ok: false; code: "BAD_TOPIC" | "UNKNOWN_TOPIC" | "FORBIDDEN" | "TOO_MANY_TOPICS" | "RATE_LIMITED" };

export type TopicSocket = {
  data: { user: RealtimeUser; topics: Set<string>; subscribeTimes: number[] };
  join(room: string): unknown;
  leave(room: string): unknown;
};

export const parseTopic = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = TOPIC_PATTERN.exec(value);
  if (!match) return null;
  return { prefix: match[1], id: match[2], topic: value };
};

const topicOf = (payload: unknown) => parseTopic((payload as { topic?: unknown } | null)?.topic);

export const createTopicRegistry = (options: { now?: () => number } = {}) => {
  const now = options.now ?? (() => Date.now());
  const authorizers = new Map<string, TopicAuthorizer>();

  const register = (prefix: string, authorize: TopicAuthorizer) => {
    if (RESERVED_PREFIXES.has(prefix)) throw new Error(`Topic prefix "${prefix}" is reserved`);
    authorizers.set(prefix, authorize);
  };

  const withinRate = (socket: TopicSocket) => {
    const cutoff = now() - 1000;
    socket.data.subscribeTimes = socket.data.subscribeTimes.filter((time) => time > cutoff);
    if (socket.data.subscribeTimes.length >= SUBSCRIBES_PER_SECOND) return false;
    socket.data.subscribeTimes.push(now());
    return true;
  };

  const subscribe = async (socket: TopicSocket, payload: unknown): Promise<TopicAck> => {
    const parsed = topicOf(payload);
    if (!parsed) return { ok: false, code: "BAD_TOPIC" };
    const authorize = authorizers.get(parsed.prefix);
    if (!authorize) return { ok: false, code: "UNKNOWN_TOPIC" };
    if (socket.data.topics.has(parsed.topic)) return { ok: true };
    if (socket.data.topics.size >= MAX_TOPICS_PER_SOCKET) return { ok: false, code: "TOO_MANY_TOPICS" };
    if (!withinRate(socket)) return { ok: false, code: "RATE_LIMITED" };

    let allowed = false;
    try {
      allowed = await authorize(socket.data.user, parsed.id);
    } catch {
      allowed = false;
    }
    if (!allowed) return { ok: false, code: "FORBIDDEN" };
    // Concurrent subscribes all passed the cap check before awaiting; re-check.
    if (!socket.data.topics.has(parsed.topic) && socket.data.topics.size >= MAX_TOPICS_PER_SOCKET) {
      return { ok: false, code: "TOO_MANY_TOPICS" };
    }

    socket.join(parsed.topic);
    socket.data.topics.add(parsed.topic);
    return { ok: true };
  };

  const unsubscribe = (socket: TopicSocket, payload: unknown): TopicAck => {
    const parsed = topicOf(payload);
    if (!parsed) return { ok: false, code: "BAD_TOPIC" };
    if (socket.data.topics.delete(parsed.topic)) socket.leave(parsed.topic);
    return { ok: true };
  };

  return { register, subscribe, unsubscribe };
};

/** The process-wide registry realtimeServer.ts serves. Feature modules call `topics.register`. */
export const topics = createTopicRegistry();
