# In-App Notifications Frontend Implementation Guide

## Base Routes
- `GET /notifications`
- `GET /notifications/unread-count`
- `PATCH /notifications/:id/read`
- `PATCH /notifications/:id/unread`
- `PATCH /notifications/read-all`
- `GET /notifications/stream-token` (short-lived token for native SSE)
- `GET /notifications/stream` (SSE)

All routes require `Authorization: Bearer <token>`.

## Standard Response Payload

```json
{
  "id": "123",
  "dedupeKey": "requisition:event:12:recipient:4",
  "type": "requisition.final_approved",
  "title": "Requisition approved",
  "body": "Requisition RQ-0021 was finally approved.",
  "recipientUserId": "4",
  "actorUserId": "19",
  "entityType": "REQUISITION",
  "entityId": "21",
  "actionUrl": "/home/requests/MjE=",
  "priority": "HIGH",
  "isRead": false,
  "readAt": null,
  "createdAt": "2026-03-02T13:25:18.000Z"
}
```

## SSE Auth (Important)

If your frontend uses native `EventSource`, it cannot send `Authorization` headers.

Use this flow:
1. Fetch stream token with your normal bearer token:
   - `GET /notifications/stream-token`
2. Open SSE with query token:
   - `GET /notifications/stream?stream_token=<token>`

If you use an SSE client that supports custom headers, `Authorization: Bearer <jwt>` on `/notifications/stream` still works.

## SSE Events
- `connected`
- `heartbeat`
- `notification`
- `notification_updated`
- `notifications_read_all`
- `unread_count`

Use `/notifications/stream` with `EventSource` and auth token (polyfill if your runtime requires custom headers).

## UI Behavior
- Bell icon unread badge: poll `GET /notifications/unread-count` once on app load, then keep synced from SSE `unread_count`.
- Notification center:
  - Unread tab: `GET /notifications?unreadOnly=true&page=1&limit=20`
  - All tab: `GET /notifications?page=1&limit=20`
  - Mark one read/unread using `PATCH /notifications/:id/read` and `PATCH /notifications/:id/unread`
  - Mark all read using `PATCH /notifications/read-all`
- Deep links: navigate to `actionUrl` when present.
- Toasts: show toast popups only when `priority` is `HIGH` or `CRITICAL`.

## Action URL Mapping Used by Backend
- Requisition: `/home/requests/{base64RequisitionId}`
- Appointment (staff/admin): `/home/appointments`
- Appointment (member): `/member/appointments`
- Visitor/follow-up: `/home/visitors/visitor/{visitorId}`
- Events: `/home/events`
- Orders/payments/delivery: `/member/market/orders`
- System/admin jobs: `/home/dashboard` or `/home/notifications`
