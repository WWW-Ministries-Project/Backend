# Backend AI Implementation Guide (Tailored to Current Backend)

This document adapts the AI implementation plan to the current backend architecture in this repository (Express + Prisma monolith), while preserving the frontend response structures.

## 1. Architecture Blueprint (Monolith-First)

Current backend is a modular monolith. Implement AI as a new module, not as separate deployable services yet.

Recommended in-repo module structure:

1. `src/modules/ai/aiRoute.ts`
- Registers AI endpoints and middleware.

2. `src/modules/ai/aiController.ts`
- Handles HTTP request/response mapping.

3. `src/modules/ai/aiService.ts`
- Orchestration entrypoint (prompt assembly, provider calls, fallback).

4. `src/modules/ai/aiUsageService.ts`
- Quota checks, reservations, commit/reconcile usage.

5. `src/modules/ai/aiPolicyService.ts`
- Policy checks, redaction hooks, safety validation.

6. `src/modules/ai/aiWorker.ts` (in-process job runner)
- Scheduled insights/report jobs using current cron approach.

7. `src/modules/ai/aiObservability.ts`
- AI-specific metrics/log labels/tracing metadata.

Core dependencies for current phase:
- MySQL (via Prisma) for conversations, usage ledger, quota, audit.
- In-memory counters for short-lived soft reservations.
- Existing logging/metrics stack (`winston`, `prom-client`, New Relic).

Phase 2+ dependencies:
- Redis for distributed reservation/rate limits.
- Queue (BullMQ/SQS/RabbitMQ) for durable AI jobs.
- Vector store for RAG.

---

## 1.1 Deployment Scope (Current)

Current scope remains single-organization.

- Keep schema single-scope (no `organization_id` yet).
- Prepare migration notes for future addition of `organization_id` on AI tables.

---

## 2. Security and Access Control (Aligned to Current Backend)

Enforce before production:

1. Authentication
- Use existing `protect` middleware.
- Missing/expired token returns `401` (current backend convention).

2. Authorization
- Add AI permission key in access-level permissions (recommended key: `AI`).
- Admin-only AI routes should use permission checks equivalent to `Can_Manage`/`Super_Admin`.
- Permission denials should return `401` (to match current backend behavior).

3. Scope isolation
- Enforce role and data-domain boundaries before constructing prompts.
- Prompt context must only include records the authenticated user can access.

4. Secrets
- Store provider credentials in DB encrypted at rest (AES-GCM).
- Use `AI_CREDENTIAL_ENCRYPTION_KEY` as the encryption key source.
- Never return raw credential values in API responses.
- No provider secrets in code or committed files.

5. Data safety
- Redact PII/high-risk fields before provider calls.
- Encrypt persisted raw prompt/response content at rest when stored.

6. Audit trail
- Store actor id, endpoint, prompt hash, model id, usage, cost, and outcome.

---

## 3. API Contract (Tailored Routes, Same Response Shape)

### 3.0 Route Prefix

Primary prefix for this backend:
- `/ai`

Optional compatibility alias (recommended):
- `/api/v1/ai`

Both prefixes should serve the same handlers during migration.

---

### 3.1 Chat endpoint

`POST /ai/chat`  
Compatibility alias: `POST /api/v1/ai/chat`

Request:

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

Response (unchanged):

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

---

### 3.2 Usage summary endpoint

`GET /ai/usage-summary`  
Compatibility alias: `GET /api/v1/ai/usage/summary`

Response (unchanged):

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

---

### 3.3 Usage history endpoint

`GET /ai/usage-history?from=YYYY-MM-DD&to=YYYY-MM-DD&interval=day`  
Compatibility alias: `GET /api/v1/ai/usage/history?...`

Used for admin analytics charts and anomaly monitoring.

---

### 3.4 Optional insights endpoint

`POST /ai/insights/:module`  
Compatibility alias: `POST /api/v1/ai/insights/:module`

Used for deterministic module insights (attendance, requisition risk, visitor follow-up risk, etc.).

---

### 3.5 Provider credential endpoints (admin)

`GET /ai/credentials?provider=openai|gemini`  
`POST /ai/credentials`  
`PUT /ai/credentials/:id`

Used by admin settings UI to create/read/update encrypted provider credentials.

---

### 3.6 Error Code Contract (Aligned to Current Backend)

Without changing response payload shape:

- `400`: invalid request/payload/context.
- `401`: missing token, expired token, or permission denial (current backend convention).
- `404`: conversation/module resource not found.
- `409`: idempotency conflict where applicable.
- `429`: quota exceeded or AI rate limit exceeded.
- `500`: provider/internal/orchestration failure.
- `503`: temporary provider unavailable (circuit open/degraded mode).

Quota exceeded response should include current remaining values and reset timestamp in body.

---

## 4. Usage Tracking Model (Messages/Tokens/Remaining)

Track at three levels:

1. Request-level usage
- Persist per successful assistant completion.

2. Application aggregate usage
- Monthly counters for quota/budget.

3. Model-level usage
- Provider/model attribution for cost reporting.

Required fields:
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `message_count`
- `cost_estimate`
- `remaining_messages`
- `remaining_tokens`

Enforcement flow (phase 1: monolith-safe):

1. Pre-check quota from DB aggregate.
2. Reserve soft budget in memory (process-local).
3. Execute provider call.
4. Commit exact usage to DB ledger + aggregates.
5. Adjust/release reservation.

Phase 2:
- Move reservation and counters to Redis to avoid multi-instance race conditions.

When quota exceeded:
- Return `429` with `remaining` and `reset_at`.

---

## 5. Suggested Prisma Models (Current Naming Style)

Use singular, snake_case model names consistent with current schema style.

1. `ai_conversation`
- `id`, `created_by`, `title`, `status`, `created_at`, `updated_at`.

2. `ai_message`
- `id`, `conversation_id`, `role`, `content`, `provider`, `model`, `created_at`.

3. `ai_usage_ledger`
- `id`, `conversation_id`, `message_id`,
- `prompt_tokens`, `completion_tokens`, `total_tokens`,
- `message_count`, `cost_estimate`, `provider`, `model`, `created_at`.

4. `ai_usage_quota`
- `id`, `period_start`, `period_end`,
- `message_limit`, `token_limit`,
- `message_used`, `token_used`, `updated_at`.

5. `ai_pricing_catalog`
- `id`, `provider`, `model`,
- `input_token_cost`, `output_token_cost`, `effective_from`, `updated_at`.

6. `ai_audit_log`
- `id`, `actor_id`, `action`, `resource`, `metadata`, `created_at`.

7. `ai_idempotency_key`
- `id`, `actor_id`, `endpoint`, `key`, `request_hash`, `response_payload`, `status_code`, `created_at`.
- Unique index on `(actor_id, endpoint, key)`.

8. `ai_provider_credential`
- `id`, `provider`, `encrypted_key`, `encrypted_secret`, `is_active`, `created_by`, `rotated_at`, `created_at`, `updated_at`.

Indexes:
- `created_at` on `ai_message`, `ai_usage_ledger`, `ai_audit_log`.
- `(period_start, period_end)` on `ai_usage_quota`.
- `(provider, model, effective_from)` on `ai_pricing_catalog`.
- `(provider, is_active)` on `ai_provider_credential`.

---

## 6. Reliability, Performance, and Failure Handling

1. Timeouts and retries
- Provider timeout: 20-30s.
- Retry only transient failures (network/5xx/timeout).
- No retry for auth/policy/validation errors.

2. Idempotency
- Support `Idempotency-Key` for `/ai/chat`.
- Replay same response for duplicate key + same request hash.
- Prevent double usage billing.

3. Circuit breaker
- Open breaker on sustained provider failures.
- Return degraded fallback or `503` with safe message.

4. Async heavy jobs
- Use in-process cron/background job pattern for now.
- Move to queue worker in phase 2 when multi-instance load increases.

5. Caching
- Cache usage summary briefly for dashboard.
- Prompt+context response cache only for explicitly allowed, non-sensitive cases.

---

## 7. Observability and Operations

Minimum AI telemetry:

1. Metrics
- request count, latency p50/p95, error rates.
- prompt/completion/total tokens by model.
- cost per request and per day.
- quota exceeded events.

2. Logs (structured)
- request id, actor id, route, model, token usage, status code.
- redact secrets and sensitive fields.

3. Traces
- request entry -> AI service -> provider -> persistence.

4. Alerts
- provider error spikes.
- latency SLO breach.
- budget threshold crossing (80/90/100%).
- unusual usage burst.

---

## 8. Policy and Guardrails

Must enforce:

1. Prompt injection resistance
- Keep system instructions isolated from user text.
- Treat user/context text as untrusted.

2. Output constraints
- Validate structured outputs against schema where required.
- Block/flag unsafe categories.

3. Human-in-the-loop
- High-risk recommendations (finance/discipline/escalations) require manual approval before downstream action.

---

## 9. Rollout Strategy (Monolith-Compatible)

1. Stage 1: Internal
- AI endpoints behind admin-only permission.
- Verify quota math, idempotency, logs, and failure handling.

2. Stage 2: Admin pilot
- Limited production pilot (2-4 weeks).
- Monitor cost, quality, p95 latency, and denial rates.

3. Stage 3: Module expansion
- Add module-specific insights and scheduled jobs.
- Introduce Redis reservation and queue worker if needed.

Exit criteria:
- Stable latency/error budget.
- Accurate token/message metering.
- No unresolved critical security findings.

---

## 10. Backend Acceptance Checklist

- [ ] `src/modules/ai` module added and mounted in `appRouter`.
- [ ] Route prefixes `/ai/*` enabled, with optional `/api/v1/ai/*` alias.
- [ ] Admin credential CRU endpoints (`/ai/credentials`) implemented.
- [ ] Provider keys/secrets persisted encrypted (AES-GCM), not hashed.
- [ ] AI endpoints enforce existing auth middleware and admin/scoped authorization.
- [ ] Error code behavior aligned to backend convention (`401` for auth + permission denials).
- [ ] Response payloads match agreed frontend structure exactly.
- [ ] Quota checks and `usage_snapshot` returned on chat responses.
- [ ] Usage ledger persists exact prompt/completion/total tokens.
- [ ] Idempotency protection implemented for chat requests.
- [ ] AI metrics/logging/alerts configured.
- [ ] PII redaction + audit logging active.
- [ ] Load and failure tests executed.
- [ ] Runbook documented for quota breach/provider outage.

---

## 11. Implementation Mapping (Repo-Specific)

Required wiring in this repository:

1. Register router
- Add `aiRouter` mount in `src/routes/appRouter.ts`:
  - `appRouter.use("/ai", aiRouter)`
  - optional: `appRouter.use("/api/v1/ai", aiRouter)`

2. Swagger
- Add JSDoc blocks in AI route/controller so `/api-docs` includes AI endpoints.

3. Prisma
- Add migration for AI models listed above.

4. Middleware
- Add `aiRateLimiter` middleware (separate from auth limiter).
- Reuse existing request logging and redaction patterns.

5. Cron/worker
- Place scheduled AI insight jobs under `src/cron-jobs` for phase 1.
