# Realtime sockets — Backend core

Date: 2026-10-16
Repos: Backend (this spec, ships first), Frontend (web dashboard), wwm-mobile

## Goal

Give the web dashboard and the mobile app one realtime channel, built on socket.io, so that
screens update the moment the data behind them changes instead of on the next focus, poll or
push. It replaces the notification SSE stream (`GET /notifications/stream`) that the web
dashboard uses today.

This spec covers **sub-project 1 of 4** — the backend core. The whole effort is:

| # | Sub-project | Repo | Depends on |
|---|---|---|---|
| 1 | **Backend socket core** (this spec): server, auth, rooms, topics, emit helper, notification events, session events, `protect` checks `is_active` | Backend | — |
| 2 | Web migration: `NotificationRealtimeConnector` moves from EventSource to socket.io-client; then SSE is deleted from the backend | Frontend, Backend | 1 in prod |
| 3 | Mobile realtime client: one connection in `src/shared/realtime/`, foreground-only; session/permission changes and the Inbox badge as first consumers | wwm-mobile | 1 in prod |
| 4 | Feature events: Community, Rides, Appointments booking, Live stream — backend emits + client invalidations | all three | 1, 3 |

Each sub-project gets its own spec, plan and branch.

## Decisions

| Topic | Decision |
|---|---|
| Transport | socket.io everywhere. The SSE stream is removed in sub-project 2, once the web dashboard is on sockets in prod. Until then both run, and notification events are published to both. |
| Scaling | Single instance, socket.io in-memory adapter. All emits go through `realtimeEmit.ts`, so adding `@socket.io/redis-streams-adapter` later touches that file and `realtimeServer.ts` only. |
| Missed events | socket.io connection-state recovery (2-minute window). Beyond that the client refetches everything realtime keeps fresh. The SSE replay buffer is not ported. |
| Payload | Thin signals: event name = type, body = ids. Clients invalidate their query cache and refetch through REST. Exceptions only for tiny, safe values (`unreadCount`, live-stream `status`). |
| Routing | Hybrid. `user:<id>` rooms for personal events, audience rooms (`branch:`, `dept:`, `all`) for rare feed-level events, client topic subscriptions for frequent screen-bound events. |
| Auth | Session JWT in `socket.handshake.auth.token` (first packet, never the URL). The stream-token endpoint is not used. |
| Proxy | Nginx on the host gets a `/socket.io/` location with WebSocket upgrade. |
| Inactive accounts | `protect` starts rejecting inactive users (today it only verifies the JWT signature). |

## Components

New module `src/modules/realtime/`. It has no REST routes — it is infrastructure the other
modules call.

### `realtimeServer.ts`

`attachRealtime(server: http.Server): void`, called in `index.ts` right after
`const server = app.listen(...)` (currently line 88).

```ts
new Server(server, {
  path: "/socket.io",
  cors: { origin: true },            // matches app.use(cors()) — every origin
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 16 * 1024,      // clients only send small subscribe frames
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
});
```

Registers the auth middleware, joins rooms on connect, wires the topic handlers, keeps the
per-user connection cap, updates metrics, and closes `io` on `SIGTERM` before the process exits.
Keeps the `Server` instance in module state for `realtimeEmit.ts`.

### `realtimeAuth.ts`

Handshake middleware (`io.use`).

1. Read `socket.handshake.auth.token`; strip a leading `Bearer `.
2. `JWT.verify` with `JWT_SECRET`.
3. Load `{ id, is_active, is_guest, branch_id }` for the token's `id` (one indexed lookup).
4. Reject inactive users.
5. Store `{ userId, isGuest, branchId }` on `socket.data`.
6. Schedule `socket.disconnect(true)` at the token's `exp`; clear the timer on disconnect.

Rejections use `next(err)` with `err.data = { code }`:

| `code` | When | Client behaviour (sub-projects 2, 3) |
|---|---|---|
| `TOKEN_MISSING` | no token | stop retrying; normal auth flow takes over |
| `TOKEN_INVALID` | bad signature / malformed | stop retrying |
| `TOKEN_EXPIRED` | `exp` passed | stop retrying; normal expiry handling |
| `ACCOUNT_INACTIVE` | `is_active` false or user missing | log out |

`ACCOUNT_INACTIVE` covers the device that was offline when `session.revoked` was sent: it learns
on its next connect. This matters for mobile, whose 401 interceptor deliberately ignores 401s
while the token is still valid.

The database lookup is injected (`createRealtimeAuth({ loadUser })`) so the logic is unit-testable.

### `realtimeRooms.ts`

`roomsFor(user): string[]`:

| User | Rooms |
|---|---|
| Member | `user:<id>`, `branch:<branchId>` (if any), `dept:<id>` for each department, `all` |
| Guest | `user:<id>`, `all` |

Department ids come from the community module's `departmentIdsOf` (a `department_positions` or
`user_departments` row), so room membership and community visibility agree.

`refreshRooms(userId)`: recompute `roomsFor` and, for every socket of that user, leave rooms that
are no longer in the set and join the new ones. Called by the session flow.

### `realtimeEmit.ts` — the only emit path

```ts
toUser(userIds: number | number[], event: RealtimeEvent): void
toRoom(room: string, event: RealtimeEvent): void
toTopic(topic: string, event: RealtimeEvent): void
disconnectUser(userId: number): void
```

- Fire-and-forget. Never throws: a missing `io` (not attached yet, unit tests, a cron-only
  process) or a failed emit is caught and logged through Winston at `warn`.
- Called **after** the database write commits — never inside a `prisma.$transaction` callback.
- Adds the envelope fields (`v`, `at`) so callers pass only the type and ids.
- Increments `realtime_emits_total{event}`.

### `realtimeTopics.ts`

Client-requested subscriptions for frequent, screen-bound events.

- `socket.on("subscribe", { topic }, ack)` → authorize → `socket.join(topic)` → `ack({ ok: true })`.
- `socket.on("unsubscribe", { topic }, ack)` → `socket.leave(topic)` → `ack({ ok: true })`.
- Authorizers are registered by topic prefix:

| Topic | Authorized when | Registered in |
|---|---|---|
| `post:<id>` | `findVisiblePost(viewer, id)` returns a row | sub-project 4 |
| `offer:<id>` | the offer exists and is visible to the user | sub-project 4 |
| `staff-slots:<id>` | any member, guest or not | sub-project 4 |

  This sub-project ships the registry and its limits with no topics registered; sub-project 4
  registers the three above. An unknown prefix gets `{ ok: false, code: "UNKNOWN_TOPIC" }`; a
  failed check gets `{ ok: false, code: "FORBIDDEN" }`.
- Limits: at most 20 topics per socket (`TOO_MANY_TOPICS`), and `subscribe` is rate-limited to
  10 per second per socket (`RATE_LIMITED`).
- Topic subscriptions are not restored by recovery when it fails; clients re-subscribe for the
  screens still open after any non-recovered reconnect.

### `realtimeEvents.ts`

The typed catalogue of every event name and body. It is the contract with the web dashboard and
the mobile app, and it is mirrored in `docs/REALTIME_EVENTS.md` (written in this sub-project,
extended by sub-project 4).

### Connection cap

At most 10 sockets per user. When an 11th connects, the oldest is disconnected.

## Event contract

### Envelope

```ts
// socket event name: "session.changed"
{ v: 1, at: "2026-10-16T09:00:00.000Z", /* ids / tiny values */ }
```

Signals are idempotent: a duplicate or out-of-order delivery only triggers an extra refetch.

### Notification events (this sub-project)

These keep their **current SSE names and data shapes**, so moving the web dashboard is a
transport swap, not a rewrite. Each is published from inside `broadcastToUser`
(`notificationService.ts`) to both SSE and `toUser(userId, …)`. The socket connect handler
sends the initial `unread_count`, as `startSseStream` does for SSE today.

| Event | Body | Source |
|---|---|---|
| `notification` | `toPayload(row)` | `createInAppNotification` |
| `notification_updated` | `{ notificationId, recipientUserId, notification, unreadCount }` | mark read / unread |
| `notifications_read_all` | `{ recipientUserId, updated, unreadCount }` | `markAllNotificationsAsRead` |
| `notifications_cleared` | `{ recipientUserId, deleted, unreadCount, totalCount }` | `clearAllNotifications` |
| `unread_count` | `{ unreadCount }` | `emitUnreadCountToUser`; also sent once on every non-recovered connect |

These are the documented exception to thin signals: the bodies already exist and already go to
the recipient alone. The `v`/`at` envelope fields are added alongside them.

### Session events (this sub-project)

| Event | Body | Sent to |
|---|---|---|
| `session.changed` | `{ reasons: ("permissions" \| "departments" \| "profile")[] }` | `user:<id>` |
| `session.revoked` | `{ reason: "deactivated" \| "deleted" \| "password_reset" }` | `user:<id>`, then all of the user's sockets are disconnected |

### Feature events (sub-project 4, listed for orientation)

`community.*` (post created / updated / deleted / moderated to audience rooms; comment and
reaction changes to `post:<id>`), `rides.*` (request and offer changes to the parties' `user:`
rooms; seat counts to `offer:<id>`), `appointments.*` (booking changes to requester and staff
`user:` rooms; availability to `staff-slots:<id>`), `live.status` (`all`). Exact names and bodies
are defined in sub-project 4's spec.

## Session flow

A new export in `src/middleWare/authorization.ts`:

```ts
invalidateAuthContext(userId: number): void   // drops the user's entry from the 30s snapshot cache
```

One helper in the realtime module wraps the three steps every change point needs:

```ts
sessionChanged(userIds: number[], reasons): void
  // for each id: invalidateAuthContext(id); refreshRooms(id); toUser(id, "session.changed")
sessionRevoked(userId: number, reason): void
  // invalidateAuthContext(id); toUser(id, "session.revoked"); disconnectUser(id)
```

Change points, all called after the write commits:

| Where | Call |
|---|---|
| `userController.updateUser` | `sessionChanged([id], ["profile", "permissions", "departments"])` — reasons narrowed to the fields that actually changed |
| `userController.updateDepartmentPositions`, `userService` department-position write | `sessionChanged([id], ["departments"])` |
| `accessLevelController.updateAccessLevel` | `sessionChanged(<every user with that access_level_id>, ["permissions"])` |
| `accessLevelController.assignAccessLevelToUser` / `bulkAssignAccessLevel` | `sessionChanged(<assigned ids>, ["permissions"])` |
| `accessLevelController.deleteAccessLevel` | `sessionChanged(<users who held it>, ["permissions"])` — ids read before the delete |
| `joinRequestController.approveOne` | `sessionChanged([requesterId], ["departments"])` |
| `departmentController` update / delete | `sessionChanged(<members of that department>, ["departments"])` |
| `positionController` update / delete | `sessionChanged(<holders of that position>, ["departments"])` |
| `updateUserSatus`, `activateAccount`, `bulkUpdateUserStatus` → inactive | `sessionRevoked(id, "deactivated")` |
| same → active | `sessionChanged([id], ["profile"])` (no socket can exist yet; harmless) |
| `deleteUser`, `deleteOwnAccount` | `sessionRevoked(id, "deleted")` |
| `resetPassword`, `updateUserPasswordToDefault` | `sessionRevoked(id, "password_reset")` |

**Not revoked:** a member changing their own password (`changePassword`). Revoking would log out
the device that made the change, and the REST JWT stays valid either way — real "sign out other
devices" needs token versioning, which is out of scope.

## `protect` and inactive accounts

Today `protect` (`authorization.ts`) only verifies the JWT, so a deactivated member keeps REST
access until the 12-hour token expires. Change:

- The auth snapshot query (`getOrFetchAuthContextSnapshot`) also selects `is_active`.
- `protect` loads the snapshot and answers **401 `"Account inactive"`** when `is_active` is false
  or the user no longer exists.
- The check stays behind the existing 30-second cache; `sessionRevoked` clears the entry, so
  deactivation takes effect on the next request rather than within 30 seconds.

This adds one cached lookup to `protect`. The snapshot is already fetched by every permission
guard, so routes with a guard see no extra query.

## Errors and limits

| Situation | Behaviour |
|---|---|
| Emit throws or `io` missing | caught, logged at `warn`, REST request unaffected |
| Handshake rejected | `err.data.code` as in the auth table; no stack traces to the client |
| Topic denied | ack `{ ok: false, code }`, socket stays connected |
| Client sends oversized frame | socket.io drops it (16 KB `maxHttpBufferSize`) |
| Over 10 sockets for one user | oldest disconnected |
| `SIGTERM` | `io.close()` before the process exits, so clients see a clean disconnect |

## Operations

### Nginx

Added to the host's server block for the API domain:

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

`proxy_read_timeout` must stay above `pingInterval + pingTimeout` (45 s).

### Observability

- Prometheus on `/metrics`: gauges `realtime_connections`, `realtime_topics`; counter
  `realtime_emits_total{event}`.
- Winston `info` on connect / disconnect (user id, reason). New Relic does not trace WebSocket
  frames, so these logs are the record.

### Reconnect storms

After a deploy every client reconnects at once. The socket.io client's default backoff already
jitters (`randomizationFactor: 0.5`). Clients (sub-projects 2, 3) also wait a random 0–3 s before
the full refetch that follows a non-recovered reconnect.

## Testing

`npm test` runs pure-unit `node:test` files with no database, like `src/modules/messaging/*.test.ts`.
Database access is injected so the following are testable:

- `realtimeAuth` — each rejection code; guest accepted; inactive rejected; disconnect timer set at `exp` and cleared on disconnect.
- `realtimeRooms` — `roomsFor` for a member, a guest, a multi-department user, a user without a branch; `refreshRooms` leaves stale `dept:` rooms and joins new ones.
- `realtimeTopics` — authorizer chosen by prefix; unknown prefix; denial; 20-topic cap; rate limit.
- `realtimeEmit` — envelope shape; never throws with no `io` or a throwing `io`.
- `sessionChanged` / `sessionRevoked` — call order (invalidate → rooms → emit; revoke disconnects last).
- `protect` — inactive snapshot → 401; `invalidateAuthContext` forces a fresh lookup.

Manual smoke script `scripts/realtime-smoke.ts`: connects with a token, prints every event,
optionally subscribes to a topic. Read-only — it never writes, so it is safe against the shared
`prod_clone` database the local `.env` points at. No schema change and no migration in this
sub-project.

## Rollout

1. Branch `feat/realtime-core` from `main`; PR into `main`.
2. Deploy; add the Nginx block; reload Nginx.
3. Verify with the smoke script against prod: transport upgrades to `websocket` (not stuck on
   polling), `unread_count` arrives on connect, a heartbeat survives 2 minutes idle.
4. SSE keeps running. Nothing changes for the web dashboard or the mobile app yet.
5. Sub-projects 2 and 3 start. SSE (route, stream-token endpoint, replay buffer, SSE half of
   `broadcastToUser`) is deleted as the last step of sub-project 2.

## Done when

- `npm test` and `npm run build` pass.
- The smoke script connects through prod Nginx over WebSocket.
- A test account that is deactivated receives `session.revoked`, is disconnected, and its next REST call answers 401 `"Account inactive"`.
- `docs/REALTIME_EVENTS.md` lists every event this sub-project emits.

## Out of scope

- Redis adapter / multiple instances.
- Token versioning ("sign out other devices").
- Feature events (sub-project 4), client code (sub-projects 2, 3), SSE removal (sub-project 2).
