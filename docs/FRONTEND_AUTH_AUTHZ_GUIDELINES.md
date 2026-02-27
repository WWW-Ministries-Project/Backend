# Frontend Authentication and Authorization Guidelines

## 1. Purpose
Use this guide to align frontend behavior with the current backend auth/authz hardening.  
Primary goal: prevent broken access after token expiry/re-login and ensure production-safe handling of protected APIs.

## 2. Production Standards (Required)
- Use one shared API client wrapper for all HTTP calls.
- Attach `Authorization: Bearer <jwt>` on every protected request.
- Treat server authorization as source of truth; frontend permission checks are UX-only.
- Keep auth state centralized (token, decoded claims, current user profile).
- Invalidate cached protected data on login, logout, and token-expiry events.
- Handle `401`, `403`, `429`, and `5xx` centrally in the API client.

## 3. Token Expiry and Re-Login Flow
1. For protected calls, backend may return `401` with:
`Session Expired` or `Not authorized. Token not found`.
2. On those responses, clear token/session state, clear cached protected queries, and redirect to login.
3. On successful login, store the new token, call `GET /user/current-user`, then refetch protected screens/data.

Important: some permission denials also return `401` (not always `403`).  
Do not auto-logout on every `401`; inspect `message`.

## 4. Authentication Endpoint Contracts (Updated)

### `POST /user/login`
- Request: `{ email, password }`
- Invalid email/password or unknown email now returns `401` with `Invalid Credentials`.
- Success returns:
```json
{ "status": "Login Successfully", "token": "<jwt>" }
```

### `POST /user/change-password`
- Now requires auth header.
- Request body must include:
```json
{ "current_password": "old", "newpassword": "new" }
```
- Do not send token in body anymore.

### `POST /user/forgot-password`
- Always returns generic success message on `200` to prevent account enumeration:
`If an account exists, a reset link has been sent.`
- Frontend should always show generic success UX.

### `POST /user/reset-password?id=<id>&token=<token>`
- Request body: `{ "newpassword": "..." }`
- Invalid/expired links now return `400` with:
`Invalid or expired reset link`.

### Rate-Limited Auth Endpoints
Rate limiting is enabled on:
- `POST /user/login`
- `POST /user/register`
- `POST /user/forgot-password`
- `POST /user/reset-password`
- `POST /user/change-password`

On limit hit:
- status `429`
- `Retry-After` header is set
- message: `Too many authentication attempts. Please try again later.`

Frontend must disable repeat submits and honor `Retry-After`.

## 5. Newly/Strictly Protected Endpoints

### User
- `GET /user/current-user` requires auth.
- `GET /user/get-user-email` requires auth + member-view permission.
- `GET /user/get-user-family` requires auth + member-view permission.
- `POST /user/send-emails-to-user` requires auth + member-manage permission.

### Devices
All `/device/*` routes now require auth + settings permissions:
- `POST /device/create-devices` (`can_manage_settings`)
- `GET /device/get-devices` (`can_view_settings`)
- `GET /device/get-device` (`can_view_settings`)
- `PUT /device/update-device` (`can_manage_settings`)
- `DELETE /device/delete-device` (`can_delete_settings`)

### Events
- `POST /event/register` now requires auth.
- `GET /event/get-registered-event-members` now requires auth + `can_view_events`.
- `GET /event/all-registered-event-member` now requires auth + `can_view_events`.

### Uploads
- `POST /upload` now requires auth.
- Multipart field name remains `file`.

### Requisitions
Now explicitly protected:
- `POST /requisitions/create-requisition`
- `GET /requisitions/list-requisition`
- `GET /requisitions/my-requisitions`
- `GET /requisitions/get-requisition`
- `DELETE /requisitions/delete-requisition`

## 6. Requisition Integration Rules (Important)
- Frontend should not trust or depend on sending `user_id` for create; backend uses authenticated user.
- `GET /requisitions/list-requisition` is scoped: users with requisition manage permission can see all; others only see their own.
- `GET /requisitions/my-requisitions` uses authenticated user identity (query `id` is no longer the source of truth).
- `GET /requisitions/get-requisition?id=...` and `DELETE /requisitions/delete-requisition?id=...` now enforce owner-or-manage authorization.
- Unauthorized cross-user access returns permission error:
`You do not have permission to access this requisition`.

Frontend should render a proper access-denied state instead of generic failure.

## 7. Event Registration Contract Notes
- `POST /event/register` should send `event_id`.
- `user_id` in request body is no longer required for normal flow; backend resolves from authenticated token.
- For `GET /event/all-registered-event-member`, use query params (`event_id`, `user_id`) for standards-compliant GET requests.

## 8. Upload Contract Notes
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`.
- Default max upload size is 5 MB (`MAX_UPLOAD_SIZE_BYTES` can override server-side).
- Invalid file type or missing file returns `400`.

Frontend should pre-validate type/size before upload.

## 9. Error Handling Matrix
- `401` + token/expiry message: force re-auth flow.
- `401` + permission message: show access-denied UI (do not force logout).
- `400`: show validation/actionable form errors.
- `404`: show not-found state.
- `429`: show cooldown using `Retry-After`.
- `5xx`: show retryable generic failure message.

## 10. CORS and Request Size Constraints
- Backend now enforces origin allowlist (`CORS_ORIGINS` and `Frontend_URL` envs).
- If frontend origin is not allowlisted, browser requests will fail due to CORS.
- JSON body size limit is `1mb`.

Coordinate environment config before production release.

## 11. Frontend Release Checklist
- [ ] Update password change form payload to `current_password` + `newpassword`.
- [ ] Add centralized `429` handling with `Retry-After`.
- [ ] Differentiate `401` session-expired vs `401` permission-denied messages.
- [ ] Ensure token is attached to all protected routes listed in this guide.
- [ ] Remove reliance on client-sent `user_id` for requisition creation/event self-registration.
- [ ] Add upload pre-validation for MIME type and max size.
- [ ] Ensure production frontend origin is allowlisted on backend.
- [ ] After login, refetch current user and protected data before rendering privileged screens.
