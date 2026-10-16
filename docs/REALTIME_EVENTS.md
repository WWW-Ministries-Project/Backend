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
| `SERVER_ERROR` | temporary server-side failure; retry — but call `socket.connect()` yourself with a jittered backoff, see below |

socket.io-client v4 does **not** reconnect on its own after the server refuses the
handshake (any `connect_error` carrying `err.data`, so `socket.active` is `false`) or
closes the socket itself (`disconnect` reason `"io server disconnect"`). For
`SERVER_ERROR` and server-initiated disconnects, schedule `socket.connect()` yourself
(e.g. 2 s doubling to 60 s, plus up to 1 s jitter). Plain network failures keep
`socket.active` `true` and retry automatically.

The server disconnects a socket when its JWT expires. After any reconnect where
`socket.recovered` is `false`, refetch everything realtime keeps fresh, after a random
0-3 s delay.

## Envelope

Every event body carries `v: 1` and `at` (ISO time) next to its own fields.

## Events

| Event | Body | Meaning |
|---|---|---|
| `notification` | the notification row (same shape as `GET /notifications`) | new in-app notification |
| `notification_updated` | `{ notificationId, recipientUserId, notification, unreadCount }` | marked read / unread |
| `notifications_read_all` | `{ recipientUserId, updated, unreadCount }` | all marked read |
| `notifications_cleared` | `{ recipientUserId, deleted, unreadCount, totalCount }` | all cleared |
| `notifications_deleted` | `{ recipientUserId, ids, deleted, unreadCount }` (`ids` are strings) | some notifications deleted |
| `unread_count` | `{ unreadCount }` | badge value; also sent once on every non-recovered connect |
| `session.changed` | `{ reasons: ("permissions"\|"departments"\|"profile")[] }` | refetch `GET /user/current-user` — it returns the same permission/profile claims as the login token |
| `session.revoked` | `{ reason: "deactivated"\|"deleted"\|"password_reset" }` | sign out; the server disconnects next |

### During migration

The same notification events are still sent over the SSE stream
(`GET /notifications/stream`) until the web dashboard moves to sockets.

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

`8001` is the production host port (`docker-compose-prod.yml`); use the port the API container is published on in each environment.

`proxy_read_timeout` must stay above ping interval + timeout (45 s).
