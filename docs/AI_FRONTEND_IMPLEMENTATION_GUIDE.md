# Frontend AI Integration Guide

This guide documents how the frontend should integrate with the backend AI module implemented in this repository.

## 1. Base Routes

Primary backend routes:
- `GET /ai/credentials?provider=openai|gemini` (admin settings)
- `POST /ai/credentials` (admin settings)
- `PUT /ai/credentials/{id}` (admin settings)
- `POST /ai/chat`
- `GET /ai/usage-summary`
- `GET /ai/usage-history?from=YYYY-MM-DD&to=YYYY-MM-DD&interval=day`
- `POST /ai/insights/{module}`

Compatibility aliases are also available:
- `/api/v1/ai/credentials`
- `/api/v1/ai/credentials/{id}`
- `/api/v1/ai/chat`
- `/api/v1/ai/usage/summary` (mapped by backend to `/ai/usage-summary`)
- `/api/v1/ai/usage/history` (mapped by backend to `/ai/usage-history`)
- `/api/v1/ai/insights/{module}`

Use one route family consistently in frontend config.

## 2. Auth and Access

- All AI endpoints require `Authorization: Bearer <jwt>`.
- AI routes are permission-protected using backend access-level permissions.
- Current backend convention is:
  - `401` for missing/expired token.
  - `401` can also be returned for permission denials.

Do not auto-logout on every `401`; inspect the response message first.

## 3. Provider Credentials (Admin Settings)

Provider credentials are no longer read directly from `.env`.
The backend stores provider credentials encrypted at rest (AES-GCM) and uses active records for runtime calls.

### 3.1 List credentials
`GET /ai/credentials?provider=openai`

Response:

```json
{
  "data": [
    {
      "id": "uuid",
      "provider": "openai",
      "is_active": true,
      "has_secret": false,
      "created_by": 12,
      "rotated_at": "2026-02-28T08:30:00.000Z",
      "created_at": "2026-02-28T08:30:00.000Z",
      "updated_at": "2026-02-28T08:30:00.000Z"
    }
  ]
}
```

### 3.2 Create credential
`POST /ai/credentials`

Request:

```json
{
  "provider": "openai",
  "api_key": "provider-api-key",
  "api_secret": null,
  "is_active": true
}
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "provider": "openai",
    "is_active": true,
    "has_secret": false,
    "created_by": 12,
    "rotated_at": "2026-02-28T08:30:00.000Z",
    "created_at": "2026-02-28T08:30:00.000Z",
    "updated_at": "2026-02-28T08:30:00.000Z"
  }
}
```

### 3.3 Update credential
`PUT /ai/credentials/{id}`

Request (any subset of fields):

```json
{
  "api_key": "new-provider-api-key",
  "api_secret": null,
  "is_active": true
}
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "provider": "openai",
    "is_active": true,
    "has_secret": false,
    "created_by": 12,
    "rotated_at": "2026-02-28T08:45:00.000Z",
    "created_at": "2026-02-28T08:30:00.000Z",
    "updated_at": "2026-02-28T08:45:00.000Z"
  }
}
```

Only metadata is returned; raw keys/secrets are never returned.

## 4. Chat Endpoint

### Request
`POST /ai/chat`

```json
{
  "message": "Summarize visitor follow-up risk for this week",
  "conversation_id": "optional-uuid",
  "context": {
    "module": "visitors",
    "scope": "admin",
    "reference_id": "optional"
  }
}
```

### Response
Response shape is unchanged:

```json
{
  "data": {
    "conversation_id": "uuid",
    "message_id": "uuid",
    "reply": "Here are the highest-risk visitors...",
    "created_at": "2026-02-28T08:30:00.000Z",
    "usage": {
      "prompt_tokens": 640,
      "completion_tokens": 372,
      "total_tokens": 1012
    },
    "usage_snapshot": {
      "message_limit": 5000,
      "message_used": 1234,
      "message_remaining": 3766,
      "token_limit": 5000000,
      "token_used": 1865000,
      "token_remaining": 3135000
    }
  }
}
```

## 5. Idempotency Support (Recommended)

To avoid duplicate completions and duplicate quota usage on retries, send:
- Header: `Idempotency-Key: <unique-client-key>`

Behavior:
- Same key + same payload: backend replays prior response.
- Same key + different payload: backend returns `409`.

Recommended frontend approach:
- Generate one UUID per user send action.
- Reuse that key only for retry of the same exact payload.

## 6. Usage Summary Endpoint

### Request
`GET /ai/usage-summary`

### Response

```json
{
  "data": {
    "period_start": "2026-02-01T00:00:00.000Z",
    "period_end": "2026-02-28T23:59:59.999Z",
    "message_window": "monthly",
    "token_window": "monthly",
    "message_limit": 5000,
    "message_used": 1234,
    "message_remaining": 3766,
    "token_limit": 5000000,
    "token_used": 1865000,
    "token_remaining": 3135000,
    "updated_at": "2026-02-28T08:30:00.000Z"
  }
}
```

## 7. Usage History Endpoint

### Request
`GET /ai/usage-history?from=2026-02-01&to=2026-02-28&interval=day`

### Response

```json
{
  "data": {
    "from": "2026-02-01",
    "to": "2026-02-28",
    "interval": "day",
    "points": [
      {
        "date": "2026-02-28",
        "prompt_tokens": 640,
        "completion_tokens": 372,
        "total_tokens": 1012,
        "message_count": 1,
        "cost_estimate": 0
      }
    ]
  }
}
```

## 8. Insights Endpoint

### Request
`POST /ai/insights/{module}`

Example:

```json
{
  "message": "Focus on conversion and overdue follow-ups.",
  "context": {
    "module": "visitors",
    "scope": "admin"
  }
}
```

### Response

```json
{
  "data": {
    "module": "visitors",
    "conversation_id": "uuid",
    "message_id": "uuid",
    "reply": "Insight summary...",
    "created_at": "2026-02-28T08:30:00.000Z",
    "usage": {
      "prompt_tokens": 640,
      "completion_tokens": 372,
      "total_tokens": 1012
    },
    "usage_snapshot": {
      "message_limit": 5000,
      "message_used": 1234,
      "message_remaining": 3766,
      "token_limit": 5000000,
      "token_used": 1865000,
      "token_remaining": 3135000
    }
  }
}
```

## 9. Error Handling Matrix

- `400`: invalid payload/query/module.
- `401`: missing/expired token or permission denial.
- `404`: conversation not found.
- `409`: idempotency key conflict (same key, different payload).
- `429`: quota exceeded (includes usage snapshot and reset time).
- `503`: provider unavailable/degraded or upstream provider throttling.
- `500`: unexpected server error.

### Quota exceeded example

```json
{
  "message": "AI usage quota exceeded",
  "data": {
    "usage_snapshot": {
      "message_limit": 5000,
      "message_used": 5000,
      "message_remaining": 0,
      "token_limit": 5000000,
      "token_used": 4999500,
      "token_remaining": 500
    },
    "reset_at": "2026-03-01T00:00:00.000Z"
  }
}
```

## 10. Provider Routing Behavior

Provider strategy is backend-managed:
- OpenAI is primary.
- If OpenAI tokens/quota are exhausted, backend automatically falls back to Gemini.

No frontend branching is required for provider selection.

## 11. Frontend Checklist

- [ ] Add admin settings screen/API methods for credential list/create/update.
- [ ] Never display full provider keys after submit.
- [ ] Add AI API methods to shared HTTP client with auth header.
- [ ] Add `Idempotency-Key` header for chat retries.
- [ ] Handle `401` by message (session-expired vs permission denied).
- [ ] Handle `409` by regenerating idempotency key only for new payload.
- [ ] Handle `429` by surfacing usage snapshot and reset time.
- [ ] Poll/refresh `/ai/usage-summary` after successful AI responses.
