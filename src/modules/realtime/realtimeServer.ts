import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import client from "prom-client";
import { prisma } from "../../Models/context";
import logger from "../../utils/logger-config";
import { departmentIdsOf } from "../community/communityQueries";
import { notificationService } from "../notifications/notificationService";
import { buildEnvelope } from "./realtimeEvents";
import { setRealtimeServer, userRoom, type RealtimeIo } from "./realtimeEmit";
import {
  authenticateHandshake,
  readHandshakeToken,
  RealtimeAuthError,
  scheduleExpiryDisconnect,
  type LoadRealtimeUser,
  type RealtimeUser,
} from "./realtimeAuth";
import { MAX_SOCKETS_PER_USER, roomsFor, socketsToDrop, syncRooms } from "./realtimeRooms";
import { parseTopic, topics } from "./realtimeTopics";

/**
 * socket.io on the Express HTTP server. One process, in-memory adapter; the
 * Redis adapter would be configured here when the API runs on more than one
 * instance. Everything else talks to sockets through realtimeEmit.ts.
 */

type SocketData = {
  user: RealtimeUser;
  topics: Set<string>;
  subscribeTimes: number[];
};

type RealtimeSocket = Socket<any, any, any, SocketData>;

let io: Server<any, any, any, SocketData> | null = null;

// Both gauges are computed at scrape time from the live sockets, so concurrent
// subscribes and recoveries cannot drift them.
// An already-registered metric is reused instead of throwing "already registered".
if (!client.register.getSingleMetric("realtime_connections")) {
  new client.Gauge({
    name: "realtime_connections",
    help: "Open realtime sockets",
    collect() {
      this.set(io ? io.of("/").sockets.size : 0);
    },
  });
}

if (!client.register.getSingleMetric("realtime_topics")) {
  new client.Gauge({
    name: "realtime_topics",
    help: "Topic subscriptions across open realtime sockets",
    collect() {
      let total = 0;
      io?.of("/").sockets.forEach((socket) => {
        total += socket.data.topics?.size ?? 0;
      });
      this.set(total);
    },
  });
}

const loadRealtimeUser: LoadRealtimeUser = (userId) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, is_active: true, is_guest: true, branch_id: true },
  });

const departmentsFor = (user: RealtimeUser) =>
  user.isGuest ? Promise.resolve([]) : departmentIdsOf(user.userId);

const describe = (error: unknown) => (error as Error)?.message ?? String(error);

/** A server-side failure the client should retry, unlike the RealtimeAuthError codes. */
const serverError = () => Object.assign(new Error("SERVER_ERROR"), { data: { code: "SERVER_ERROR" } });

const enforceConnectionCap = async (userId: number) => {
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  const drop = new Set(
    socketsToDrop(
      sockets.map((socket) => ({ id: socket.id, issued: socket.handshake.issued })),
      MAX_SOCKETS_PER_USER,
    ),
  );
  for (const socket of sockets) {
    if (drop.has(socket.id)) socket.disconnect(true);
  }
};

const onConnection = (socket: RealtimeSocket) => {
  const user = socket.data.user;
  socket.data.topics ??= new Set<string>();
  socket.data.subscribeTimes = [];
  logger.info(`[realtime] connect user=${user.userId} socket=${socket.id} recovered=${socket.recovered}`);
  socket.join(userRoom(user.userId));

  // The topics held at disconnect — the same ones whose rooms socket.io saved
  // for connection-state recovery.
  let topicsAtDisconnect: Set<string> | null = null;

  socket.on("subscribe", async (payload: unknown, ack?: (result: unknown) => void) => {
    let result: unknown = { ok: false, code: "FORBIDDEN" };
    try {
      result = await topics.subscribe(socket, payload);
      if (!socket.connected) {
        // Disconnected mid-authorize: the join was a no-op, so forget a topic added
        // after the disconnect — a recovered socket gets this same Set back and must
        // match its restored rooms. One a concurrent subscribe added while still
        // connected has its room saved, so it stays.
        const parsed = parseTopic((payload as { topic?: unknown } | null)?.topic);
        if (parsed && !topicsAtDisconnect?.has(parsed.topic)) socket.data.topics.delete(parsed.topic);
        return;
      }
    } catch (error) {
      logger.warn(`[realtime] subscribe failed user=${user.userId}: ${describe(error)}`);
    }
    if (typeof ack === "function") ack(result);
  });

  socket.on("unsubscribe", (payload: unknown, ack?: (result: unknown) => void) => {
    const result = topics.unsubscribe(socket, payload);
    if (typeof ack === "function") ack(result);
  });

  socket.on("disconnect", (reason) => {
    topicsAtDisconnect = new Set(socket.data.topics);
    logger.info(`[realtime] disconnect user=${user.userId} socket=${socket.id} reason=${reason}`);
  });

  void (async () => {
    try {
      syncRooms(socket, roomsFor(user, await departmentsFor(user)));
      // A recovered socket already got its missed packets replayed.
      if (socket.recovered) return;
      await enforceConnectionCap(user.userId);
      const unreadCount = await notificationService.getUnreadCount(user.userId);
      socket.emit("unread_count", buildEnvelope({ unreadCount }));
    } catch (error) {
      logger.warn(`[realtime] connect setup failed user=${user.userId}: ${describe(error)}`);
    }
  })();
};

export const attachRealtime = (server: HttpServer) => {
  io = new Server<any, any, any, SocketData>(server, {
    path: "/socket.io",
    cors: { origin: true },
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 16 * 1024,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false,
    },
  });

  io.use(async (socket, next) => {
    try {
      const { user, expiresAtMs } = await authenticateHandshake(
        readHandshakeToken(socket.handshake.auth),
        { secret: String(process.env.JWT_SECRET ?? ""), loadUser: loadRealtimeUser },
      );
      socket.data.user = user;
      scheduleExpiryDisconnect(socket, expiresAtMs);
      next();
    } catch (error) {
      if (error instanceof RealtimeAuthError) return next(error);
      logger.warn(`[realtime] handshake failed: ${describe(error)}`);
      next(serverError());
    }
  });

  io.on("connection", onConnection);
  setRealtimeServer(io as unknown as RealtimeIo);

  process.once("SIGTERM", () => {
    // A SIGTERM listener replaces Node's default exit, so exit explicitly.
    setTimeout(() => process.exit(0), 10_000).unref();
    void io?.close(() => process.exit(0));
  });

  logger.info("[realtime] socket.io attached on /socket.io");
  return io;
};

/**
 * Re-computes a user's audience rooms on every socket they have open — after a
 * department, branch or guest-status change. A user who is now inactive is
 * disconnected instead.
 */
export const refreshRooms = async (userId: number) => {
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  if (!sockets.length) return;

  const row = await loadRealtimeUser(userId);
  if (!row || row.is_active === false) {
    io.in(userRoom(userId)).disconnectSockets(true);
    return;
  }

  const user: RealtimeUser = {
    userId,
    isGuest: row.is_guest === true,
    branchId: row.branch_id ?? null,
  };
  const rooms = roomsFor(user, await departmentsFor(user));
  for (const socket of sockets) {
    socket.data.user = user;
    syncRooms(
      { id: socket.id, rooms: socket.rooms, join: (room) => socket.join(room), leave: (room) => socket.leave(room) },
      rooms,
    );
  }
};
