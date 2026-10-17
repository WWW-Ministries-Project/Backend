# Realtime Sockets — Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a socket.io server to the Express API with handshake auth, rooms, topic subscriptions and a single emit path; publish notification and session events over it; and make `protect` reject inactive accounts.

**Architecture:** A new `src/modules/realtime/` module. Pure, dependency-injected units (`realtimeEvents`, `realtimeEmit`, `realtimeAuth`, `realtimeRooms`, `realtimeTopics`, `sessionNotifier`) carry the logic and the unit tests; two wiring files (`realtimeServer`, `realtimeSession`) bind them to socket.io, Prisma and the auth cache. Controllers call `sessionChanged` / `sessionRevoked` after their writes commit; `notificationService.broadcastToUser` publishes to SSE and socket.io side by side.

**Tech Stack:** Node 22, Express 4, TypeScript (`module: NodeNext`), socket.io 4.8.1, socket.io-client 4.8.1 (dev, smoke script), Prisma (MySQL), prom-client, winston, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-16-realtime-sockets-core-design.md`

---

## Ground rules for the implementer

- Work in the `feat/realtime-core` branch. Base: `main`.
- `npm test` runs every `src/**/*.test.ts` with `node:test` — pure unit tests, **no database**. Database calls are injected as functions so tests pass fakes.
- **Never run `prisma migrate` or any write against the database the local `.env` points at** — it is a shared `prod_clone`. This plan has no schema change and no migration.
- Import Prisma only as `import { prisma } from "../../Models/context";`. Keep the quirky paths (`middleWare/`, `Models/`).
- Every emit happens **after** the database write commits, never inside a `prisma.$transaction` callback.
- Use `void` for fire-and-forget calls: `void sessionChanged(...)`. Both helpers swallow their own errors.
- Commit after every task. End each commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File map

| File | Responsibility |
|---|---|
| Create `src/modules/realtime/realtimeEvents.ts` | Event names, body types, `buildEnvelope` |
| Create `src/modules/realtime/realtimeEmit.ts` | The only emit path: `toUser`, `toRoom`, `toTopic`, `disconnectUser`; holds the `io` reference |
| Create `src/modules/realtime/realtimeAuth.ts` | Handshake token parsing, JWT verification, inactive check, expiry disconnect |
| Create `src/modules/realtime/realtimeRooms.ts` | `roomsFor`, `syncRooms`, `socketsToDrop` (connection cap) |
| Create `src/modules/realtime/realtimeTopics.ts` | Topic registry, `subscribe` / `unsubscribe` handling, limits |
| Create `src/modules/realtime/sessionNotifier.ts` | `createSessionNotifier`, `sessionReasonsForUserUpdate` (pure) |
| Create `src/modules/realtime/realtimeServer.ts` | `attachRealtime`, connection lifecycle, metrics, `refreshRooms`, shutdown |
| Create `src/modules/realtime/realtimeSession.ts` | Default `sessionChanged` / `sessionRevoked` wired to real deps; audience lookups |
| Create tests beside each pure file: `*.test.ts` | |
| Modify `src/middleWare/authorization.ts` | `is_active` in snapshot, `isSessionActive`, `invalidateAuthContext`, async `protect` |
| Modify `index.ts` | Call `attachRealtime(server)` |
| Modify `src/modules/notifications/notificationService.ts` | Publish `broadcastToUser` events to socket.io too |
| Modify `src/modules/user/userController.ts` | Session calls in 7 handlers |
| Modify `src/modules/accessLevels/accessLevelController.ts` | Session calls in 5 handlers |
| Modify `src/modules/departmentJoinRequests/joinRequestController.ts` | Session call in `approveOne` |
| Modify `src/modules/departments/departmentController.ts` | Session calls in update / delete |
| Create `docs/REALTIME_EVENTS.md` | Client-facing event contract + Nginx block |
| Create `scripts/realtime-smoke.ts` | Read-only manual smoke client |

---

### Task 1: Dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
npm install socket.io@4.8.1
npm install --save-dev socket.io-client@4.8.1
```

- [ ] **Step 2: Verify the existing suite still passes**

Run: `npm test`
Expected: all existing tests pass (messaging etc.), exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(realtime): add socket.io and socket.io-client"
```

---

### Task 2: Event catalogue and envelope

**Files:**
- Create: `src/modules/realtime/realtimeEvents.ts`
- Test: `src/modules/realtime/realtimeEvents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildEnvelope, REALTIME_EVENT_VERSION } from "./realtimeEvents";

test("buildEnvelope adds v and at to the body", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");
  assert.deepEqual(buildEnvelope({ reasons: ["profile"] }, now), {
    reasons: ["profile"],
    v: REALTIME_EVENT_VERSION,
    at: "2026-10-16T09:00:00.000Z",
  });
});

test("buildEnvelope: body cannot override v or at", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");
  const envelope = buildEnvelope({ v: 99, at: "x", unreadCount: 2 }, now);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.at, "2026-10-16T09:00:00.000Z");
  assert.equal(envelope.unreadCount, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeEvents.test.ts`
Expected: FAIL — `Cannot find module './realtimeEvents'`.

- [ ] **Step 3: Implement**

```ts
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
  unread_count: { unreadCount: number };
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeEvents.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeEvents.ts src/modules/realtime/realtimeEvents.test.ts
git commit -m "feat(realtime): event catalogue and envelope"
```

---

### Task 3: The emit path

**Files:**
- Create: `src/modules/realtime/realtimeEmit.ts`
- Test: `src/modules/realtime/realtimeEmit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  disconnectUser,
  setRealtimeServer,
  toRoom,
  toTopic,
  toUser,
  userRoom,
  type RealtimeIo,
} from "./realtimeEmit";

type Sent = { target: string | string[]; event: string; body: any };

const fakeIo = () => {
  const sent: Sent[] = [];
  const disconnected: string[] = [];
  const io: RealtimeIo = {
    to: (target) => ({
      emit: (event, body) => {
        sent.push({ target, event, body });
        return true;
      },
    }),
    in: (room) => ({
      disconnectSockets: () => {
        disconnected.push(room);
      },
    }),
  };
  return { io, sent, disconnected };
};

test("userRoom", () => {
  assert.equal(userRoom(7), "user:7");
});

test("no io attached: every helper is a silent no-op", () => {
  setRealtimeServer(null);
  assert.doesNotThrow(() => toUser(1, "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => toRoom("all", "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => toTopic("post:1", "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => disconnectUser(1));
});

test("toUser targets user rooms, drops invalid ids, wraps the body", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toUser([3, 0, -1, 3.5, 4], "session.changed", { reasons: ["profile"] });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].target, ["user:3", "user:4"]);
  assert.equal(sent[0].event, "session.changed");
  assert.deepEqual(sent[0].body.reasons, ["profile"]);
  assert.equal(sent[0].body.v, 1);
  assert.equal(typeof sent[0].body.at, "string");
  setRealtimeServer(null);
});

test("toUser with no valid ids emits nothing", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toUser([], "unread_count", { unreadCount: 0 });
  toUser(0, "unread_count", { unreadCount: 0 });
  assert.equal(sent.length, 0);
  setRealtimeServer(null);
});

test("toRoom and toTopic pass the room through", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toRoom("all", "unread_count", { unreadCount: 1 });
  toTopic("post:9", "unread_count", { unreadCount: 1 });
  assert.deepEqual(sent.map((s) => s.target), ["all", "post:9"]);
  setRealtimeServer(null);
});

test("a throwing io never escapes", () => {
  setRealtimeServer({
    to: () => {
      throw new Error("boom");
    },
    in: () => {
      throw new Error("boom");
    },
  });
  assert.doesNotThrow(() => toUser(1, "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => disconnectUser(1));
  setRealtimeServer(null);
});

test("disconnectUser targets the user room", () => {
  const { io, disconnected } = fakeIo();
  setRealtimeServer(io);
  disconnectUser(5);
  assert.deepEqual(disconnected, ["user:5"]);
  setRealtimeServer(null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeEmit.test.ts`
Expected: FAIL — `Cannot find module './realtimeEmit'`.

- [ ] **Step 3: Implement**

```ts
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

const emitsTotal = new client.Counter({
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeEmit.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeEmit.ts src/modules/realtime/realtimeEmit.test.ts
git commit -m "feat(realtime): single fire-and-forget emit path"
```

---

### Task 4: Handshake auth

**Files:**
- Create: `src/modules/realtime/realtimeAuth.ts`
- Test: `src/modules/realtime/realtimeAuth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import JWT from "jsonwebtoken";
import {
  authenticateHandshake,
  readHandshakeToken,
  RealtimeAuthError,
  scheduleExpiryDisconnect,
  type LoadRealtimeUser,
} from "./realtimeAuth";

const SECRET = "test-secret";

const activeMember: LoadRealtimeUser = async (id) => ({
  id,
  is_active: true,
  is_guest: false,
  branch_id: 2,
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof RealtimeAuthError);
    return (error as RealtimeAuthError).data.code;
  }
};

test("readHandshakeToken: strips Bearer, rejects non-strings and blanks", () => {
  assert.equal(readHandshakeToken({ token: "Bearer abc" }), "abc");
  assert.equal(readHandshakeToken({ token: "  abc  " }), "abc");
  assert.equal(readHandshakeToken({ token: "" }), null);
  assert.equal(readHandshakeToken({ token: 5 }), null);
  assert.equal(readHandshakeToken(undefined), null);
});

test("missing token", async () => {
  assert.equal(await codeOf(authenticateHandshake(null, { secret: SECRET, loadUser: activeMember })), "TOKEN_MISSING");
});

test("bad signature", async () => {
  const token = JWT.sign({ id: 1 }, "other-secret");
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("expired token", async () => {
  const token = JWT.sign({ id: 1, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_EXPIRED");
});

test("purpose-scoped tokens (e.g. the SSE stream token) are refused", async () => {
  const token = JWT.sign({ id: 1, purpose: "notifications_stream" }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("token without a usable id", async () => {
  const token = JWT.sign({ id: "abc" }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("inactive or missing user", async () => {
  const token = JWT.sign({ id: 1 }, SECRET);
  const inactive: LoadRealtimeUser = async (id) => ({ id, is_active: false, is_guest: false, branch_id: null });
  const missing: LoadRealtimeUser = async () => null;
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: inactive })), "ACCOUNT_INACTIVE");
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: missing })), "ACCOUNT_INACTIVE");
});

test("active member: user and expiry returned; null is_active counts as active", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = JWT.sign({ id: 9, exp }, SECRET);
  const nullActive: LoadRealtimeUser = async (id) => ({ id, is_active: null, is_guest: null, branch_id: null });
  const result = await authenticateHandshake(token, { secret: SECRET, loadUser: nullActive });
  assert.deepEqual(result.user, { userId: 9, isGuest: false, branchId: null });
  assert.equal(result.expiresAtMs, exp * 1000);
});

test("guest accepted and flagged", async () => {
  const token = JWT.sign({ id: 4 }, SECRET);
  const guest: LoadRealtimeUser = async (id) => ({ id, is_active: true, is_guest: true, branch_id: 1 });
  const result = await authenticateHandshake(token, { secret: SECRET, loadUser: guest });
  assert.equal(result.user.isGuest, true);
  assert.equal(result.expiresAtMs, null);
});

test("scheduleExpiryDisconnect: fires at expiry, cleared on disconnect", () => {
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const clock = {
    now: () => 1_000,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t: any) => {
      t.cleared = true;
    },
  };
  let disconnected = false;
  let onDisconnect: () => void = () => undefined;
  const socket = {
    disconnect: () => {
      disconnected = true;
    },
    once: (_event: "disconnect", fn: () => void) => {
      onDisconnect = fn;
    },
  };

  scheduleExpiryDisconnect(socket, 6_000, clock);
  assert.equal(timers[0].ms, 5_000);
  timers[0].fn();
  assert.equal(disconnected, true);

  scheduleExpiryDisconnect(socket, 9_000, clock);
  onDisconnect();
  assert.equal(timers[1].cleared, true);
});

test("scheduleExpiryDisconnect: no expiry, no timer", () => {
  let created = 0;
  scheduleExpiryDisconnect(
    { disconnect: () => undefined, once: () => undefined },
    null,
    { now: () => 0, setTimer: () => (created += 1), clearTimer: () => undefined },
  );
  assert.equal(created, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeAuth.test.ts`
Expected: FAIL — `Cannot find module './realtimeAuth'`.

- [ ] **Step 3: Implement**

```ts
import JWT from "jsonwebtoken";

/**
 * Socket handshake auth. The session JWT travels in `socket.handshake.auth.token`
 * — the first packet, never the URL, so it stays out of proxy logs.
 *
 * Rejections carry `err.data.code`; clients act on the code:
 * TOKEN_MISSING / TOKEN_INVALID / TOKEN_EXPIRED stop retrying, ACCOUNT_INACTIVE
 * logs out (it is how an offline device learns of a revocation it missed).
 */

export type RealtimeAuthErrorCode =
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "ACCOUNT_INACTIVE";

export class RealtimeAuthError extends Error {
  data: { code: RealtimeAuthErrorCode };

  constructor(code: RealtimeAuthErrorCode) {
    super(code);
    this.name = "RealtimeAuthError";
    this.data = { code };
  }
}

export type RealtimeUser = {
  userId: number;
  isGuest: boolean;
  branchId: number | null;
};

export type LoadRealtimeUser = (userId: number) => Promise<{
  id: number;
  is_active: boolean | null;
  is_guest: boolean | null;
  branch_id: number | null;
} | null>;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const readHandshakeToken = (auth: unknown): string | null => {
  const raw = (auth as { token?: unknown } | undefined)?.token;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const token = trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice(7).trim() : trimmed;
  return token || null;
};

export const authenticateHandshake = async (
  token: string | null,
  deps: { secret: string; loadUser: LoadRealtimeUser },
): Promise<{ user: RealtimeUser; expiresAtMs: number | null }> => {
  if (!token) throw new RealtimeAuthError("TOKEN_MISSING");

  let payload: JWT.JwtPayload;
  try {
    const decoded = JWT.verify(token, deps.secret);
    if (!decoded || typeof decoded === "string") throw new RealtimeAuthError("TOKEN_INVALID");
    payload = decoded;
  } catch (error) {
    if (error instanceof RealtimeAuthError) throw error;
    if ((error as Error)?.name === "TokenExpiredError") throw new RealtimeAuthError("TOKEN_EXPIRED");
    throw new RealtimeAuthError("TOKEN_INVALID");
  }

  // Purpose-scoped tokens (the SSE stream token, …) are not session tokens.
  if (payload.purpose !== undefined) throw new RealtimeAuthError("TOKEN_INVALID");

  const userId = toPositiveInt(payload.id);
  if (!userId) throw new RealtimeAuthError("TOKEN_INVALID");

  const row = await deps.loadUser(userId);
  if (!row || row.is_active === false) throw new RealtimeAuthError("ACCOUNT_INACTIVE");

  return {
    user: { userId, isGuest: row.is_guest === true, branchId: row.branch_id ?? null },
    expiresAtMs: typeof payload.exp === "number" ? payload.exp * 1000 : null,
  };
};

type Clock = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: any) => void;
};

const MAX_TIMER_MS = 2 ** 31 - 1;

const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  },
  clearTimer: (timer) => clearTimeout(timer),
};

/** Drops the socket when its token expires, so an expired session cannot linger. */
export const scheduleExpiryDisconnect = (
  socket: { disconnect(close: boolean): unknown; once(event: "disconnect", fn: () => void): unknown },
  expiresAtMs: number | null,
  clock: Clock = systemClock,
) => {
  if (expiresAtMs === null) return;
  const delay = Math.min(MAX_TIMER_MS, Math.max(0, expiresAtMs - clock.now()));
  const timer = clock.setTimer(() => socket.disconnect(true), delay);
  socket.once("disconnect", () => clock.clearTimer(timer));
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeAuth.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeAuth.ts src/modules/realtime/realtimeAuth.test.ts
git commit -m "feat(realtime): handshake auth with coded rejections"
```

---

### Task 5: Rooms and the connection cap

**Files:**
- Create: `src/modules/realtime/realtimeRooms.ts`
- Test: `src/modules/realtime/realtimeRooms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ROOM, roomsFor, socketsToDrop, syncRooms } from "./realtimeRooms";

test("member rooms: user, branch, each department, all", () => {
  assert.deepEqual(roomsFor({ userId: 3, isGuest: false, branchId: 2 }, [7, 8]), [
    "user:3",
    "branch:2",
    "dept:7",
    "dept:8",
    ALL_ROOM,
  ]);
});

test("member without a branch", () => {
  assert.deepEqual(roomsFor({ userId: 3, isGuest: false, branchId: null }, []), ["user:3", ALL_ROOM]);
});

test("guest: user and all only, departments ignored", () => {
  assert.deepEqual(roomsFor({ userId: 4, isGuest: true, branchId: 2 }, [7]), ["user:4", ALL_ROOM]);
});

test("duplicate department ids collapse", () => {
  assert.deepEqual(roomsFor({ userId: 1, isGuest: false, branchId: null }, [7, 7]), ["user:1", "dept:7", ALL_ROOM]);
});

test("syncRooms leaves stale managed rooms, joins new ones, keeps topics and the socket's own room", () => {
  const rooms = new Set(["sock-1", "user:3", "dept:7", "branch:1", "post:5", ALL_ROOM]);
  const joined: string[] = [];
  const left: string[] = [];
  const socket = {
    id: "sock-1",
    rooms,
    join: (room: string) => {
      joined.push(room);
    },
    leave: (room: string) => {
      left.push(room);
    },
  };
  syncRooms(socket, ["user:3", "branch:2", "dept:8", ALL_ROOM]);
  assert.deepEqual(left.sort(), ["branch:1", "dept:7"]);
  assert.deepEqual(joined.sort(), ["branch:2", "dept:8"]);
});

test("socketsToDrop keeps the newest `cap`", () => {
  const sockets = [
    { id: "a", issued: 1 },
    { id: "b", issued: 3 },
    { id: "c", issued: 2 },
  ];
  assert.deepEqual(socketsToDrop(sockets, 2), ["a"]);
  assert.deepEqual(socketsToDrop(sockets, 3), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeRooms.test.ts`
Expected: FAIL — `Cannot find module './realtimeRooms'`.

- [ ] **Step 3: Implement**

```ts
import type { RealtimeUser } from "./realtimeAuth";
import { userRoom } from "./realtimeEmit";

/**
 * Audience rooms. `user:` carries personal events, `branch:` / `dept:` carry
 * feed-level events, `all` carries broadcasts (live stream). Guests only get
 * `user:` and `all`. Topic rooms (`post:`, `offer:`, …) are managed by
 * realtimeTopics.ts and never touched here.
 */

export const ALL_ROOM = "all";

export const branchRoom = (branchId: number) => `branch:${branchId}`;
export const departmentRoom = (departmentId: number) => `dept:${departmentId}`;

export const MAX_SOCKETS_PER_USER = 10;

const MANAGED_PREFIXES = ["user:", "branch:", "dept:"];

const isManagedRoom = (room: string) =>
  room === ALL_ROOM || MANAGED_PREFIXES.some((prefix) => room.startsWith(prefix));

export const roomsFor = (user: RealtimeUser, departmentIds: number[]): string[] => {
  if (user.isGuest) return [userRoom(user.userId), ALL_ROOM];
  return [
    userRoom(user.userId),
    ...(user.branchId ? [branchRoom(user.branchId)] : []),
    ...[...new Set(departmentIds)].map(departmentRoom),
    ALL_ROOM,
  ];
};

export type RoomSocket = {
  id: string;
  rooms: Set<string>;
  join(room: string): unknown;
  leave(room: string): unknown;
};

/** Brings a socket's managed rooms in line with `desired`; topic rooms are left alone. */
export const syncRooms = (socket: RoomSocket, desired: string[]) => {
  const wanted = new Set(desired);
  for (const room of [...socket.rooms]) {
    if (room === socket.id) continue;
    if (isManagedRoom(room) && !wanted.has(room)) socket.leave(room);
  }
  for (const room of wanted) {
    if (!socket.rooms.has(room)) socket.join(room);
  }
};

/** Ids of the oldest sockets beyond `cap`, oldest first. */
export const socketsToDrop = (sockets: { id: string; issued: number }[], cap: number): string[] => {
  if (sockets.length <= cap) return [];
  return [...sockets]
    .sort((a, b) => a.issued - b.issued)
    .slice(0, sockets.length - cap)
    .map((socket) => socket.id);
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeRooms.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeRooms.ts src/modules/realtime/realtimeRooms.test.ts
git commit -m "feat(realtime): audience rooms and connection cap helpers"
```

---

### Task 6: Topic subscriptions

**Files:**
- Create: `src/modules/realtime/realtimeTopics.ts`
- Test: `src/modules/realtime/realtimeTopics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTopicRegistry,
  MAX_TOPICS_PER_SOCKET,
  parseTopic,
  type TopicSocket,
} from "./realtimeTopics";

const member = { userId: 1, isGuest: false, branchId: null };

const fakeSocket = (): TopicSocket & { joined: string[]; left: string[] } => {
  const joined: string[] = [];
  const left: string[] = [];
  return {
    joined,
    left,
    data: { user: member, topics: new Set<string>(), subscribeTimes: [] },
    join: (room: string) => {
      joined.push(room);
    },
    leave: (room: string) => {
      left.push(room);
    },
  };
};

test("parseTopic", () => {
  assert.deepEqual(parseTopic("post:12"), { prefix: "post", id: "12", topic: "post:12" });
  assert.deepEqual(parseTopic("staff-slots:3"), { prefix: "staff-slots", id: "3", topic: "staff-slots:3" });
  assert.equal(parseTopic("post:"), null);
  assert.equal(parseTopic("post"), null);
  assert.equal(parseTopic("post:1:2"), null);
  assert.equal(parseTopic(42), null);
  assert.equal(parseTopic("post:" + "x".repeat(65)), null);
});

test("reserved prefixes cannot be registered", () => {
  const registry = createTopicRegistry();
  for (const prefix of ["user", "branch", "dept", "all"]) {
    assert.throws(() => registry.register(prefix, async () => true));
  }
});

test("subscribe: unknown prefix, bad topic", async () => {
  const registry = createTopicRegistry();
  const socket = fakeSocket();
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: false, code: "UNKNOWN_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "nope" }), { ok: false, code: "BAD_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, null), { ok: false, code: "BAD_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "user:1" }), { ok: false, code: "UNKNOWN_TOPIC" });
});

test("subscribe: authorizer decides; allowed topics are joined once", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async (_user, id) => id === "1");
  const socket = fakeSocket();
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:2" }), { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(socket.joined, ["post:1"]);
  assert.equal(socket.data.topics.size, 1);
});

test("subscribe: an authorizer that throws is FORBIDDEN, not a crash", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async () => {
    throw new Error("db down");
  });
  assert.deepEqual(await registry.subscribe(fakeSocket(), { topic: "post:1" }), { ok: false, code: "FORBIDDEN" });
});

test("subscribe: topic cap", async () => {
  const registry = createTopicRegistry({ now: (() => { let t = 0; return () => (t += 1000); })() });
  registry.register("post", async () => true);
  const socket = fakeSocket();
  for (let i = 1; i <= MAX_TOPICS_PER_SOCKET; i += 1) {
    assert.deepEqual(await registry.subscribe(socket, { topic: `post:${i}` }), { ok: true });
  }
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:999" }), { ok: false, code: "TOO_MANY_TOPICS" });
});

test("subscribe: rate limit of 10 per second", async () => {
  const registry = createTopicRegistry({ now: () => 5_000 });
  registry.register("post", async () => true);
  const socket = fakeSocket();
  for (let i = 1; i <= 10; i += 1) {
    await registry.subscribe(socket, { topic: `post:${i}` });
  }
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:11" }), { ok: false, code: "RATE_LIMITED" });
});

test("unsubscribe leaves and forgets the topic; unknown topics are fine", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async () => true);
  const socket = fakeSocket();
  await registry.subscribe(socket, { topic: "post:1" });
  assert.deepEqual(registry.unsubscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(socket.left, ["post:1"]);
  assert.equal(socket.data.topics.size, 0);
  assert.deepEqual(registry.unsubscribe(socket, { topic: "post:2" }), { ok: true });
  assert.deepEqual(registry.unsubscribe(socket, { topic: "bad" }), { ok: false, code: "BAD_TOPIC" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeTopics.test.ts`
Expected: FAIL — `Cannot find module './realtimeTopics'`.

- [ ] **Step 3: Implement**

```ts
import type { RealtimeUser } from "./realtimeAuth";

/**
 * Client-requested subscriptions for frequent, screen-bound events (comments
 * on an open post, seats on an open ride offer, a staff member's free slots).
 * Each topic family registers an authorizer by prefix; feature modules
 * register theirs (sub-project 4). The audience prefixes are reserved.
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/realtimeTopics.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeTopics.ts src/modules/realtime/realtimeTopics.test.ts
git commit -m "feat(realtime): topic subscriptions with authorizers and limits"
```

---

### Task 7: Session notifier (pure)

**Files:**
- Create: `src/modules/realtime/sessionNotifier.ts`
- Test: `src/modules/realtime/sessionNotifier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createSessionNotifier, sessionReasonsForUserUpdate } from "./sessionNotifier";

const recorder = () => {
  const calls: string[] = [];
  const notifier = createSessionNotifier({
    invalidateAuthContext: (id) => {
      calls.push(`invalidate:${id}`);
    },
    refreshRooms: async (id) => {
      calls.push(`rooms:${id}`);
    },
    toUser: (id, event, body) => {
      calls.push(`emit:${id}:${event}:${JSON.stringify(body)}`);
    },
    disconnectUser: (id) => {
      calls.push(`disconnect:${id}`);
    },
  });
  return { calls, notifier };
};

test("sessionChanged: invalidate → rooms → emit, per user, deduped", async () => {
  const { calls, notifier } = recorder();
  await notifier.sessionChanged([2, 2, 3], ["permissions"]);
  assert.deepEqual(calls, [
    "invalidate:2",
    "rooms:2",
    'emit:2:session.changed:{"reasons":["permissions"]}',
    "invalidate:3",
    "rooms:3",
    'emit:3:session.changed:{"reasons":["permissions"]}',
  ]);
});

test("sessionChanged: no ids or no reasons does nothing", async () => {
  const { calls, notifier } = recorder();
  await notifier.sessionChanged([], ["profile"]);
  await notifier.sessionChanged([1], []);
  assert.deepEqual(calls, []);
});

test("sessionChanged: a failing refreshRooms still emits and never throws", async () => {
  const calls: string[] = [];
  const notifier = createSessionNotifier({
    invalidateAuthContext: () => undefined,
    refreshRooms: async () => {
      throw new Error("db down");
    },
    toUser: (id, event) => {
      calls.push(`${id}:${event}`);
    },
    disconnectUser: () => undefined,
  });
  await assert.doesNotReject(notifier.sessionChanged([1], ["departments"]));
  assert.deepEqual(calls, ["1:session.changed"]);
});

test("sessionRevoked: invalidate → emit → disconnect", () => {
  const { calls, notifier } = recorder();
  notifier.sessionRevoked(5, "deactivated");
  assert.deepEqual(calls, [
    "invalidate:5",
    'emit:5:session.revoked:{"reason":"deactivated"}',
    "disconnect:5",
  ]);
});

test("sessionReasonsForUserUpdate", () => {
  const before = { is_user: true, access_level_id: 1, department_id: 4, branch_id: 1 };
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before }, false), ["profile"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, access_level_id: 2 }, false), ["profile", "permissions"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, is_user: false }, false), ["profile", "permissions"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, department_id: 5 }, false), ["profile", "departments"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, branch_id: 2 }, false), ["profile", "departments"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before }, true), ["profile", "departments"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/sessionNotifier.test.ts`
Expected: FAIL — `Cannot find module './sessionNotifier'`.

- [ ] **Step 3: Implement**

```ts
import type { RealtimeEventMap, SessionChangeReason, SessionRevokeReason } from "./realtimeEvents";

/**
 * What every session change point does, in order:
 * changed — drop the cached auth snapshot, re-join audience rooms, tell the user;
 * revoked — drop the snapshot, tell the user, then disconnect every socket.
 * Never throws: callers fire and forget after their write commits.
 */

export type SessionNotifierDeps = {
  invalidateAuthContext: (userId: number) => void;
  refreshRooms: (userId: number) => Promise<void>;
  toUser: <N extends keyof RealtimeEventMap>(userId: number, event: N, body: RealtimeEventMap[N]) => void;
  disconnectUser: (userId: number) => void;
};

export const createSessionNotifier = (deps: SessionNotifierDeps) => {
  const sessionChanged = async (userIds: number[], reasons: SessionChangeReason[]) => {
    if (!reasons.length) return;
    for (const userId of [...new Set(userIds)]) {
      try {
        deps.invalidateAuthContext(userId);
      } catch {
        // cache miss is harmless
      }
      try {
        await deps.refreshRooms(userId);
      } catch {
        // rooms catch up on the next connect; the event still goes out
      }
      deps.toUser(userId, "session.changed", { reasons });
    }
  };

  const sessionRevoked = (userId: number, reason: SessionRevokeReason) => {
    try {
      deps.invalidateAuthContext(userId);
    } catch {
      // cache miss is harmless
    }
    deps.toUser(userId, "session.revoked", { reason });
    deps.disconnectUser(userId);
  };

  return { sessionChanged, sessionRevoked };
};

type UserSessionFields = {
  is_user: boolean | null;
  access_level_id: number | null;
  department_id: number | null;
  branch_id: number | null;
};

/** Narrows `updateUser`'s reasons to what actually changed. Profile always changes. */
export const sessionReasonsForUserUpdate = (
  before: UserSessionFields,
  after: UserSessionFields,
  departmentPositionsReplaced: boolean,
): SessionChangeReason[] => {
  const reasons: SessionChangeReason[] = ["profile"];
  if (Boolean(before.is_user) !== Boolean(after.is_user) || (before.access_level_id ?? null) !== (after.access_level_id ?? null)) {
    reasons.push("permissions");
  }
  if (
    departmentPositionsReplaced ||
    (before.department_id ?? null) !== (after.department_id ?? null) ||
    (before.branch_id ?? null) !== (after.branch_id ?? null)
  ) {
    reasons.push("departments");
  }
  return reasons;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --require ts-node/register/transpile-only src/modules/realtime/sessionNotifier.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/sessionNotifier.ts src/modules/realtime/sessionNotifier.test.ts
git commit -m "feat(realtime): session notifier and update-reason narrowing"
```

---

### Task 8: `protect` rejects inactive accounts; cache invalidator

**Files:**
- Modify: `src/middleWare/authorization.ts` (snapshot SQL ~line 399, snapshot user object ~line 440, new exports above `export class Permissions` ~line 539, `protect` ~line 632)
- Test: `src/middleWare/sessionActive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { isSessionActive } from "./authorization";

test("isSessionActive", () => {
  assert.equal(isSessionActive(null), false);
  assert.equal(isSessionActive({ currentUser: { is_active: false } }), false);
  assert.equal(isSessionActive({ currentUser: { is_active: true } }), true);
  assert.equal(isSessionActive({ currentUser: {} }), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --require ts-node/register/transpile-only src/middleWare/sessionActive.test.ts`
Expected: FAIL — `isSessionActive is not a function` (or a TS export error).

- [ ] **Step 3: Select `is_active` in the snapshot query**

In `fetchAuthContextSnapshotFromDb`, add `is_active` to the row type and the SQL:

```ts
    Array<{
      id: number;
      is_user: boolean | number | null;
      is_active: boolean | number | null;
      access_level_id: number | null;
```

```sql
    SELECT
      u.id,
      u.is_user,
      u.is_active,
      u.access_level_id,
```

and to `snapshotUser` (a null column means active — the column defaults to true):

```ts
  const snapshotUser = {
    id: firstRow.id,
    is_user: Boolean(firstRow.is_user),
    is_active: firstRow.is_active === null ? true : Boolean(firstRow.is_active),
    access_level_id: firstRow.access_level_id,
```

- [ ] **Step 4: Add the two exports**

Directly above `export class Permissions {`:

```ts
/** False when the user is gone or deactivated. A missing flag counts as active. */
export const isSessionActive = (
  snapshot: { currentUser?: { is_active?: boolean | null } | null } | null,
): boolean => Boolean(snapshot) && snapshot?.currentUser?.is_active !== false;

/**
 * Drops a user's cached auth snapshot so the next request reloads permissions,
 * departments and active status. Called by the realtime session notifier
 * right after those change.
 */
export const invalidateAuthContext = (userId: number) => {
  authContextCache.delete(userId);
  inflightAuthContextFetches.delete(userId);
};
```

- [ ] **Step 5: Make `protect` check the snapshot**

Replace the whole `protect` property with:

```ts
  protect = async (req: any, res: Response, next: NextFunction) => {
    const token = this.extractToken(req);
    if (!token)
      return res
        .status(401)
        .json({ message: "Not authorized. Token not found", data: null });

    let decoded: any;
    try {
      decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired", data: "Session Expired" });
    }

    // A deactivated account keeps a valid JWT for up to 12h; refuse it here.
    // Cached for 30s and cleared early by the realtime session notifier.
    const userId = toPositiveInt(decoded?.id);
    if (userId) {
      const snapshot = await getOrFetchAuthContextSnapshot(userId);
      if (!isSessionActive(snapshot)) {
        return res
          .status(401)
          .json({ message: "Account inactive", data: null });
      }
    }

    req.user = decoded;
    next();
  };
```

`toPositiveInt` already exists in this file (used by `getAuthenticatedUserId`). Async middleware rejections reach `globalErrorHandler` through `express-async-errors`, imported first in `index.ts`.

- [ ] **Step 6: Run the test and the type check**

Run: `node --test --require ts-node/register/transpile-only src/middleWare/sessionActive.test.ts`
Expected: PASS, 1 test.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/middleWare/authorization.ts src/middleWare/sessionActive.test.ts
git commit -m "feat(auth): protect rejects inactive accounts; export invalidateAuthContext"
```

---

### Task 9: Socket server wiring

**Files:**
- Create: `src/modules/realtime/realtimeServer.ts`
- Create: `src/modules/realtime/realtimeSession.ts`
- Modify: `index.ts` (import + after `const server = app.listen(...)` block, ~line 88)

No unit test — this is wiring over units already tested. It is verified by the type check here and by the smoke script in Task 14.

- [ ] **Step 1: Create `realtimeServer.ts`**

```ts
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
import { topics } from "./realtimeTopics";

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

const connectionsGauge = new client.Gauge({
  name: "realtime_connections",
  help: "Open realtime sockets",
});

const topicsGauge = new client.Gauge({
  name: "realtime_topics",
  help: "Topic subscriptions across open realtime sockets",
});

let io: Server<any, any, any, SocketData> | null = null;

const loadRealtimeUser: LoadRealtimeUser = (userId) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, is_active: true, is_guest: true, branch_id: true },
  });

const departmentsFor = (user: RealtimeUser) =>
  user.isGuest ? Promise.resolve([]) : departmentIdsOf(user.userId);

const describe = (error: unknown) => (error as Error)?.message ?? String(error);

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
  connectionsGauge.inc();
  topicsGauge.inc(socket.data.topics.size);
  logger.info(`[realtime] connect user=${user.userId} socket=${socket.id} recovered=${socket.recovered}`);

  socket.on("subscribe", async (payload: unknown, ack?: (result: unknown) => void) => {
    const before = socket.data.topics.size;
    const result = await topics.subscribe(socket, payload);
    topicsGauge.inc(socket.data.topics.size - before);
    if (typeof ack === "function") ack(result);
  });

  socket.on("unsubscribe", (payload: unknown, ack?: (result: unknown) => void) => {
    const before = socket.data.topics.size;
    const result = topics.unsubscribe(socket, payload);
    topicsGauge.dec(before - socket.data.topics.size);
    if (typeof ack === "function") ack(result);
  });

  socket.on("disconnect", (reason) => {
    connectionsGauge.dec();
    topicsGauge.dec(socket.data.topics.size);
    logger.info(`[realtime] disconnect user=${user.userId} socket=${socket.id} reason=${reason}`);
  });

  // A recovered socket already has its rooms back and missed packets replayed.
  if (socket.recovered) return;

  void (async () => {
    try {
      syncRooms(socket, roomsFor(user, await departmentsFor(user)));
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
      if (!(error instanceof RealtimeAuthError)) {
        logger.warn(`[realtime] handshake failed: ${describe(error)}`);
      }
      next(error instanceof RealtimeAuthError ? error : new RealtimeAuthError("TOKEN_INVALID"));
    }
  });

  io.on("connection", onConnection);
  setRealtimeServer(io as unknown as RealtimeIo);

  process.once("SIGTERM", () => {
    io?.close();
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
```

- [ ] **Step 2: Create `realtimeSession.ts`**

```ts
import { prisma } from "../../Models/context";
import { invalidateAuthContext } from "../../middleWare/authorization";
import { departmentMemberIds } from "../community/communityQueries";
import { disconnectUser, toUser } from "./realtimeEmit";
import { refreshRooms } from "./realtimeServer";
import { createSessionNotifier } from "./sessionNotifier";

/**
 * Session events, wired to the real cache, rooms and sockets. Controllers call
 * these after their write commits, with `void`:
 *   void sessionChanged([userId], ["permissions"]);
 *   sessionRevoked(userId, "deactivated");
 */
export const { sessionChanged, sessionRevoked } = createSessionNotifier({
  invalidateAuthContext,
  refreshRooms,
  toUser,
  disconnectUser,
});

/** Users currently holding an access level. Read BEFORE a delete or an unassign. */
export const usersWithAccessLevel = async (accessLevelId: number): Promise<number[]> => {
  const rows = await prisma.user.findMany({
    where: { access_level_id: accessLevelId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
};

/** Active members of a department (positions or memberships). Read BEFORE a delete. */
export const membersOfDepartment = async (departmentId: number): Promise<number[]> =>
  (await departmentMemberIds([departmentId])).get(departmentId) ?? [];
```

- [ ] **Step 3: Attach in `index.ts`**

Add the import beside the other `./src/...` imports:

```ts
import { attachRealtime } from "./src/modules/realtime/realtimeServer";
```

and directly after the `server.on("error", ...)` block at the end of the file:

```ts
attachRealtime(server);
```

- [ ] **Step 4: Type check and full suite**

Run: `npx tsc --noEmit`
Expected: exit 0. If `socket.handshake.issued` or the `Server` generics complain, check the installed version is exactly 4.8.1 (`npm ls socket.io`).

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/realtime/realtimeServer.ts src/modules/realtime/realtimeSession.ts index.ts
git commit -m "feat(realtime): attach socket.io server with auth, rooms, topics, metrics"
```

---

### Task 10: Notification events over sockets

**Files:**
- Modify: `src/modules/notifications/notificationService.ts` (imports ~line 1–20; `broadcastToUser` ~line 488)

- [ ] **Step 1: Import the emit helper**

Add after the existing `./notificationSmsService` import:

```ts
import { toUser as emitToUserSocket } from "../realtime/realtimeEmit";
```

- [ ] **Step 2: Publish from `broadcastToUser`**

Inside `broadcastToUser`, right after `const envelope = createSseEnvelope(event, data);` and the replay-buffer `if`, add:

```ts
  // Same event, same body, over socket.io. Runs alongside SSE until the web
  // dashboard moves to sockets (realtime sub-project 2), then SSE goes.
  if (data && typeof data === "object") {
    emitToUserSocket(userId, event as "notification", data as Record<string, unknown>);
  }
```

Every current caller passes an object body (`notification`, `notification_updated`, `notifications_read_all`, `notifications_cleared`, `unread_count`), so nothing is skipped. The SSE `heartbeat` / `connected` envelopes are written directly to the client, not through `broadcastToUser`, so they do not reach sockets.

- [ ] **Step 3: Type check and suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notifications/notificationService.ts
git commit -m "feat(notifications): publish notification events over socket.io too"
```

---

### Task 11: Session events — user module

**Files:**
- Modify: `src/modules/user/userController.ts`

- [ ] **Step 1: Imports**

Add with the other module imports at the top:

```ts
import { sessionChanged, sessionRevoked } from "../realtime/realtimeSession";
import { sessionReasonsForUserUpdate } from "../realtime/sessionNotifier";
```

- [ ] **Step 2: `updateUser` (~line 409)**

Directly before `const { password, ...rest } = updatedUser;` add:

```ts
    void sessionChanged(
      [updatedUser.id],
      sessionReasonsForUserUpdate(userExists, updatedUser, Boolean(dep_posts)),
    );
```

(`userExists` is the pre-update row; `updatedUser` the post-update row; both have `is_user`, `access_level_id`, `department_id`, `branch_id`. `dep_posts` is set only when department positions were replaced.)

- [ ] **Step 3: `updateUserSatus` (~line 1118)**

Directly before `const { password, ...rest } = response;` add:

```ts
    if (response.is_active === false) {
      sessionRevoked(response.id, "deactivated");
    } else {
      void sessionChanged([response.id], ["profile"]);
    }
```

- [ ] **Step 4: `deleteUser` (~line 1174)**

After the `await prisma.user.delete({...});` call add:

```ts
    sessionRevoked(Number(id), "deleted");
```

- [ ] **Step 5: `deleteOwnAccount` (~line 1205)**

After the `await prisma.$transaction(async (tx) => { ... });` block closes add:

```ts
    sessionRevoked(authenticatedUserId, "deleted");
```

- [ ] **Step 6: `resetPassword` (~line 1561)**

After the `await prisma.user.update({ ... password: await hashPassword(newpassword) ... });` call add:

```ts
    // A forgot-password reset signs the member out everywhere else.
    sessionRevoked(parsedUserId, "password_reset");
```

- [ ] **Step 7: `activateAccount` (~line 1613)**

After `const response = await prisma.user.update({...});` add:

```ts
    if (response.is_active === false) {
      sessionRevoked(response.id, "deactivated");
    } else {
      void sessionChanged([response.id], ["profile"]);
    }
```

- [ ] **Step 8: `bulkUpdateUserStatus` (~line 2988)**

Replace:

```ts
    const result = await userService.bulkUpdateUserStatus(user_ids, is_active);
    return res.status(200).json({ data: result });
```

with:

```ts
    const result = await userService.bulkUpdateUserStatus(user_ids, is_active);
    const changedIds = result.results
      .filter((row) => row.success && !row.noop)
      .map((row) => Number(row.user_id));
    if (is_active === false) {
      changedIds.forEach((userId) => sessionRevoked(userId, "deactivated"));
    } else {
      void sessionChanged(changedIds, ["profile"]);
    }
    return res.status(200).json({ data: result });
```

(`BulkUserStatusResponse.results` in `src/modules/user/userService.ts:70` holds one `{ user_id, success, noop? }` row per requested id; `noop` marks users already in the requested state.)

- [ ] **Step 9: Type check and suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm test` → all pass.

- [ ] **Step 10: Commit**

```bash
git add src/modules/user/userController.ts
git commit -m "feat(user): emit session events on profile, status, delete and reset"
```

---

### Task 12: Session events — access levels

**Files:**
- Modify: `src/modules/accessLevels/accessLevelController.ts`

- [ ] **Step 1: Import**

```ts
import { sessionChanged, usersWithAccessLevel } from "../realtime/realtimeSession";
```

- [ ] **Step 2: `createAccessLevel` (~line 403)**

Inside the `if (Array.isArray(assigned_users) && assigned_users.length > 0) {` block, after its `await prisma.user.updateMany({...});`, add:

```ts
      void sessionChanged(assigned_users.map((id: any) => Number(id)), ["permissions"]);
```

- [ ] **Step 3: `updateAccessLevel` (~line 501)**

Directly before `const enrichedResponse = await enrichAccessLevelWithExclusions(response);` add:

```ts
    // Permissions changed for every holder, not only newly assigned users.
    void sessionChanged(await usersWithAccessLevel(response.id), ["permissions"]);
```

- [ ] **Step 4: `assignAccessLevelToUser` (~line 681)**

Directly before `return res.status(200).json({ message: "Operation successful" });` add:

```ts
    void sessionChanged([userId], ["permissions"]);
```

- [ ] **Step 5: `bulkAssignAccessLevel` (~line 826)**

Directly after the `const [assigned, unassigned] = await prisma.$transaction([...]);` statement add:

```ts
    void sessionChanged([...assignIds, ...unassignIds], ["permissions"]);
```

- [ ] **Step 6: `deleteAccessLevel` (~line 923)**

Replace the start of the `try` block:

```ts
  try {
    const unAssign = await prisma.user.updateMany({
```

with:

```ts
  try {
    const holders = await usersWithAccessLevel(Number(id));
    const unAssign = await prisma.user.updateMany({
```

and directly before `listAllAccessLevel(req, res);` add:

```ts
    void sessionChanged(holders, ["permissions"]);
```

- [ ] **Step 7: Type check and suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm test` → all pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/accessLevels/accessLevelController.ts
git commit -m "feat(access-levels): emit session.changed to affected users"
```

---

### Task 13: Session events — departments and join requests

**Files:**
- Modify: `src/modules/departmentJoinRequests/joinRequestController.ts` (`approveOne` ~line 433)
- Modify: `src/modules/departments/departmentController.ts` (`updateDepartment` ~line 314, `deleteDepartment` ~line 360)

- [ ] **Step 1: `approveOne`**

Import:

```ts
import { sessionChanged } from "../realtime/realtimeSession";
```

After the `await prisma.department_join_request.update({...});` call add:

```ts
  void sessionChanged([request.user_id], ["departments"]);
```

- [ ] **Step 2: `updateDepartment`**

Import:

```ts
import { membersOfDepartment, sessionChanged } from "../realtime/realtimeSession";
```

Add `department_head: true` to the `existingDepartment` select:

```ts
      select: {
        id: true,
        branch_id: true,
        department_head: true,
      },
```

Directly before the `res.status(200).json({ message: "Department Updated Succesfully", ... })` call add:

```ts
    // Members see the new name/branch; old and new heads gain or lose scoped access.
    const affected = await membersOfDepartment(departmentId);
    const heads = [existingDepartment?.department_head, response.department_head_info?.id]
      .filter((headId): headId is number => typeof headId === "number");
    void sessionChanged([...affected, ...heads], ["departments", "permissions"]);
```

- [ ] **Step 3: `deleteDepartment`**

Before `await prisma.department.delete({...});` add:

```ts
    const affected = await membersOfDepartment(departmentId);
```

After that delete call add:

```ts
    void sessionChanged(affected, ["departments"]);
```

- [ ] **Step 4: Type check and suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/departmentJoinRequests/joinRequestController.ts src/modules/departments/departmentController.ts
git commit -m "feat(departments): emit session.changed on approval, update and delete"
```

---

### Task 14: Client contract doc and smoke script

**Files:**
- Create: `docs/REALTIME_EVENTS.md`
- Create: `scripts/realtime-smoke.ts`

- [ ] **Step 1: Write `docs/REALTIME_EVENTS.md`**

````markdown
# Realtime events (socket.io)

Server: same host as the REST API, path `/socket.io`. Client: `socket.io-client@4`.

```ts
import { io } from "socket.io-client";
const socket = io(API_URL, {
  path: "/socket.io",
  transports: ["websocket"],
  auth: { token: sessionJwt },        // never put the token in the URL
});
```

## Connecting

| Rejection `err.data.code` | Do |
|---|---|
| `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED` | stop reconnecting; let the normal auth flow run |
| `ACCOUNT_INACTIVE` | sign the user out |

The server disconnects a socket when its JWT expires. After any reconnect where
`socket.recovered` is `false`, refetch everything realtime keeps fresh, after a random
0–3 s delay.

## Envelope

Every event body carries `v: 1` and `at` (ISO time) next to its own fields.

## Events

| Event | Body | Meaning |
|---|---|---|
| `notification` | the notification row (same shape as `GET /notifications`) | new in-app notification |
| `notification_updated` | `{ notificationId, recipientUserId, notification, unreadCount }` | marked read / unread |
| `notifications_read_all` | `{ recipientUserId, updated, unreadCount }` | all marked read |
| `notifications_cleared` | `{ recipientUserId, deleted, unreadCount, totalCount }` | all cleared |
| `unread_count` | `{ unreadCount }` | badge value; also sent once on every non-recovered connect |
| `session.changed` | `{ reasons: ("permissions"\|"departments"\|"profile")[] }` | refetch the profile / permissions |
| `session.revoked` | `{ reason: "deactivated"\|"deleted"\|"password_reset" }` | sign out; the server disconnects next |

## Topics

`socket.emit("subscribe", { topic }, ack)` / `socket.emit("unsubscribe", { topic }, ack)`.
Ack: `{ ok: true }` or `{ ok: false, code }` with `BAD_TOPIC`, `UNKNOWN_TOPIC`,
`FORBIDDEN`, `TOO_MANY_TOPICS` (20 per socket), `RATE_LIMITED` (10 per second).
No topics are registered yet; feature topics arrive with realtime sub-project 4.
Re-subscribe after any non-recovered reconnect.

## Nginx

```nginx
location /socket.io/ {
  proxy_pass http://127.0.0.1:8001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 75s;
  proxy_send_timeout 75s;
}
```

`proxy_read_timeout` must stay above ping interval + timeout (45 s).
````

- [ ] **Step 2: Write `scripts/realtime-smoke.ts`**

```ts
/**
 * Read-only realtime smoke test. Connects, prints every event, optionally
 * subscribes to one topic. Never writes anything.
 *
 *   REALTIME_URL=https://api.example.org REALTIME_TOKEN=<jwt> \
 *     npx ts-node --transpile-only scripts/realtime-smoke.ts [topic]
 */
import { io } from "socket.io-client";

const url = process.env.REALTIME_URL;
const token = process.env.REALTIME_TOKEN;
const topic = process.argv[2];

if (!url || !token) {
  console.error("Set REALTIME_URL and REALTIME_TOKEN.");
  process.exit(1);
}

const socket = io(url, { path: "/socket.io", transports: ["websocket"], auth: { token } });

socket.on("connect", () => {
  console.log(`connected id=${socket.id} transport=${socket.io.engine.transport.name} recovered=${socket.recovered}`);
  if (topic) socket.emit("subscribe", { topic }, (ack: unknown) => console.log("subscribe ack", ack));
});
socket.on("connect_error", (error: any) => console.log("connect_error", error.message, error.data));
socket.on("disconnect", (reason) => console.log("disconnect", reason));
socket.onAny((event, body) => console.log(new Date().toISOString(), event, JSON.stringify(body)));
```

- [ ] **Step 3: Build**

`tsconfig.json` has no `include`, so `tsc` compiles `scripts/` too (into `dist/scripts/`, harmless; `socket.io-client` is installed as a dev dependency).

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/REALTIME_EVENTS.md scripts/realtime-smoke.ts
git commit -m "docs(realtime): client event contract, nginx block, smoke script"
```

---

### Task 15: Spec sync and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-realtime-sockets-core-design.md`

- [ ] **Step 1: Bring the spec in line with what was built**

In the "Session flow" change-point table:

- Remove the `positionController update / delete` row. A position rename does not change access or rooms.
- Remove `updateUserPasswordToDefault` from the `password_reset` row. It is disabled in production (`canRunSensitiveUserOps`) and resets every account at once.
- Remove `userService department-position write` from the department-positions row. `savedDepartments` only runs at registration, before any socket can exist; `updateDepartmentPositions` is reached only through `updateUser`, which already emits.
- Change the `departmentController update / delete` row to: update → members plus old and new head, `["departments", "permissions"]`; delete → members read before the delete, `["departments"]`.

In the "Components → realtimeAuth" list, add: "Tokens carrying a `purpose` claim (e.g. the SSE stream token) are refused with `TOKEN_INVALID`."

- [ ] **Step 2: Full gate**

Run: `npm test`
Expected: every test passes, including the 7 new files (`realtimeEvents`, `realtimeEmit`, `realtimeAuth`, `realtimeRooms`, `realtimeTopics`, `sessionNotifier`, `sessionActive`).

Run: `npm run build`
Expected: exit 0, `dist/` produced, `copy:libs` ran.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-16-realtime-sockets-core-design.md
git commit -m "docs(realtime): sync spec with the implemented change points"
```

---

## After the plan (not code tasks — done by a person with server access)

1. Push `feat/realtime-core`, open the PR into `main`.
2. After deploy, add the Nginx block from `docs/REALTIME_EVENTS.md`, `sudo nginx -t`, reload.
3. Run the smoke script against prod with a test account's token: `transport=websocket`, `unread_count` arrives, the socket survives 2 minutes idle.
4. Deactivate the test account from the dashboard: the smoke client prints `session.revoked` then `disconnect`, and a REST call with the same token answers 401 `Account inactive`.
