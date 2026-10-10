# Admin Messaging — Welcome, Birthday and General messages

Date: 2026-10-10
Repos: Backend (this spec, ships first), Frontend (admin portal), wwm-mobile (inbox check only)

## Goal

Add a **Messaging** page under Communication in the admin portal with three tabs:

- **Welcome messages** — sent automatically when a member or guest signs up in the mobile app, and when a visitor is added (by an admin or through the public visitor form). The visitor message can include App Store / Play Store download links.
- **Birthday messages** — sent automatically to members and guests on their birthday.
- **General messages** — sent by an admin to the whole church, to departments, or to specific people, now or at a scheduled time.

Every message supports placeholders (`{first_name}` etc.). The admin picks the delivery channels — SMS, Email, In-app (inbox + push) — per template and per general message.

## Decisions

| Topic | Decision |
|---|---|
| Channels | Admin picks per template / per message: SMS, Email, In-app. Admin messages ignore members' personal SMS opt-out. |
| Welcome templates | Three: `WELCOME_MEMBER`, `WELCOME_GUEST`, `WELCOME_VISITOR`. Each has its own enabled flag, channels, subject and body. |
| App links | Stored once in Messaging settings; inserted via placeholders. The visitor template has an "Include app download link" toggle. |
| Birthday | One template (`BIRTHDAY`) for members and guests, sent daily at an admin-set time in Africa/Accra. Visitors are excluded (no date of birth). |
| General scope | Send now or schedule; history with per-channel counts; cancel while scheduled; retry failed. |
| Audience | Whole church (active members) with optional "include guests" and "include visitors who consented"; one or more departments; specific people. |
| Permission | New `messaging` permission domain (`view_messaging` / `manage_messaging`), separate from Community. |
| Delivery architecture | New `messaging` module with its own outbox (approach A). Not built on Community posts, and not a plain fan-out through `createInAppNotification`. |

### Why an own outbox

`createInAppNotification` alone would (a) obey members' SMS preference, which defaults to off, so most SMS would silently not send; (b) give no per-message delivery counts; (c) not reach visitors, who live in the separate `visitor` table; (d) offer no scheduling. Community posts are an in-app feed, not SMS/email. An outbox table gives one path for users and visitors, scheduling, history counts and per-row retries.

## Data model (Prisma, MySQL)

New migration `prisma/migrations/<ts>_messaging/migration.sql`, hand-written with a header comment like the existing ones.

```
message_template
  id                 Int  PK
  key                Enum MessageTemplateKey UNIQUE  (WELCOME_MEMBER | WELCOME_GUEST | WELCOME_VISITOR | BIRTHDAY)
  enabled            Boolean  default false
  channels           Json     {"sms":bool,"email":bool,"inApp":bool}
  email_subject      String?
  body               Text
  include_app_link   Boolean  default false   (meaningful for WELCOME_VISITOR only)
  updated_by         Int?  FK user
  updated_at         DateTime @updatedAt

message_settings   (singleton row, id = 1)
  app_store_url          String?
  play_store_url         String?
  birthday_send_time     String  default "07:00"   (HH:mm)
  timezone               String  default "Africa/Accra"
  last_birthday_run_date String?                  (YYYY-MM-DD, local date)

message_dispatch
  id              Int PK
  kind            Enum (WELCOME | BIRTHDAY | GENERAL)
  template_key    MessageTemplateKey?
  dedupe_key      String? UNIQUE        (WELCOME:user:<id>, WELCOME:visitor:<id>, BIRTHDAY:<YYYY-MM-DD>)
  title           String                (internal label shown in history)
  body            Text                  (unrendered, as authored)
  email_subject   String?
  channels        Json
  audience        Json?                 (GENERAL only — see Audience)
  status          Enum (SCHEDULED | QUEUED | SENDING | SENT | CANCELLED | FAILED)
  scheduled_for   DateTime?
  created_by      Int? FK user          (null for automatic sends)
  counts          Json?                 cached {sms:{sent,failed,skipped}, email:{…}, inApp:{…}}
  created_at, updated_at
  index (status, scheduled_for), index (kind, created_at)

message_recipient
  id              Int PK
  dispatch_id     Int FK message_dispatch ON DELETE CASCADE
  channel         Enum (SMS | EMAIL | IN_APP)
  user_id         Int? FK user ON DELETE SET NULL
  visitor_id      Int? FK visitor ON DELETE SET NULL
  recipient_name  String               (snapshot)
  address         String?              (phone or email snapshot; null for IN_APP)
  rendered_body   Text
  rendered_subject String?
  status          Enum (PENDING | SENDING | SENT | FAILED | SKIPPED)
  error           String?              (reason for FAILED / SKIPPED)
  attempts        Int default 0
  next_attempt_at DateTime?
  sent_at         DateTime?
  UNIQUE (dispatch_id, channel, user_id, visitor_id)
  index (status, next_attempt_at)
```

The four template rows are seeded by the migration with sensible default text, `enabled = false`, so nothing sends until an admin turns a template on.

## Placeholder engine

`src/modules/messaging/placeholders.ts`

- `renderTemplate(text, ctx): string` replaces `{token}` from a fixed whitelist. Matching is case-sensitive, and `{{token}}` is not supported, to keep one syntax.
- `findUnknownPlaceholders(text, kind): string[]` is used on save. A template or general message containing an unknown token is rejected with `InputValidationError` that names the token.
- The whitelist is exposed via `GET /messaging/placeholders` so the UI never hard-codes it.

| Placeholder | Value | Available in |
|---|---|---|
| `{first_name}` | first name, fallback "Friend" | all |
| `{last_name}` | last name, fallback "" | all |
| `{full_name}` | first + last, fallback "Friend" | all |
| `{title}` | e.g. "Pastor", fallback "" | all |
| `{church_name}` | constant "Worldwide Word Ministries" | all |
| `{app_store_link}` | settings.app_store_url | all |
| `{play_store_link}` | settings.play_store_url | all |
| `{app_download_link}` | "iPhone: <url>\nAndroid: <url>" (only the configured ones) | all |
| `{age}` | age turning today | BIRTHDAY only |

Rules:
- Values come from `user_info` (users) or `visitor` (visitors). A missing value uses the fallback; nothing renders as a blank followed by a stray comma.
- If `include_app_link` is on and the body does not already contain `{app_download_link}`, the token is appended on a new line.
- After rendering, collapse runs of more than two newlines.
- Text is rendered per recipient when the `message_recipient` rows are created and stored in `rendered_body`, so history shows exactly what each person got.
- SMS: the rendered text is capped at `HUBTEL_SMS_MAX_MESSAGE_LENGTH` (default 612). Longer text is truncated with "…" rather than failing.
- Email: the rendered text is HTML-escaped, newlines become `<br>`, URLs are linkified, then the text is wrapped in the new `mail_templates/messagingTemplate.ts` layout.

## Triggers

### Welcome

`messagingService.enqueueWelcome({ userId } | { visitorId })`. It is fire-and-forget, wrapped in try/catch and logs on error; it must never fail the sign-up or the visitor creation.

- **Mobile self-register.** In `selfRegister` (`src/modules/user/selfServiceController.ts`), after `prisma.user.create`, enqueue `WELCOME_GUEST` if `is_guest`, else `WELCOME_MEMBER`.
- **Legacy welcome email.** `selfRegister` currently sends a hard-coded "Welcome to Worldwide Word Ministries" email. Skip it only when the chosen template is enabled with the email channel on. Otherwise keep it, so nobody gets two welcome emails and nobody gets none.
- **Visitor added.** In `VisitorService.createVisitor` (`src/modules/visitorManagement/visitorService.ts`), after `prisma.visitor.create`, enqueue `WELCOME_VISITOR` only if `consentToContact` is true. This covers both the admin form and the public `register-visitor` page.
- A disabled template means nothing is enqueued.
- The dedupe key `WELCOME:user:<id>` or `WELCOME:visitor:<id>` makes a repeated call a no-op (catch P2002).
- Visitors have no account, so IN_APP rows for visitors are created as `SKIPPED` ("no app account").

### Birthday

`src/cron-jobs/messagingBirthdayCron.ts` runs every 15 minutes, overridable by env, with an `isRunning` guard and `notifyAdminsJobFailed` on error. It is registered in `index.ts` under `RUN_BACKGROUND_JOBS`.

1. Compute the local date and time in `settings.timezone`.
2. Continue only if the template is enabled, local time ≥ `birthday_send_time`, and `last_birthday_run_date` ≠ the local date. Because of this rule, a restart after 07:00 still sends that day.
3. Select active users (members and guests) whose `user_info.date_of_birth` has today's month and day, compared on UTC date components. On 28 February in a non-leap year, also include 29 February birthdays.
4. Create one dispatch `BIRTHDAY:<YYYY-MM-DD>`, insert its recipients, and set `last_birthday_run_date` in the same transaction.

### General

- **Send now** creates the dispatch as `QUEUED` and resolves the audience into recipients immediately.
- **Schedule** creates the dispatch as `SCHEDULED` with `scheduled_for`, which must be in the future and at most 90 days ahead. The audience is resolved when the dispatch becomes due, so people who join before the send are included.
- **Cancel** is allowed only while `SCHEDULED`.

#### Audience

```json
{ "scope": "CHURCH" | "DEPARTMENTS" | "PEOPLE",
  "departmentIds": [1,2],
  "userIds": [10,11],
  "includeGuests": false,
  "includeVisitors": false }
```

- `CHURCH`: active, non-guest users, plus guests if `includeGuests`, plus visitors with `consentToContact` if `includeVisitors`.
- `DEPARTMENTS`: active users in any of the departments, via `user_departments` / `department_positions`. Reuse `departmentMemberIds` from `communityQueries.ts`, moving it to a shared spot if importing it would create a cycle.
- `PEOPLE`: the listed active users.
- Recipients are de-duplicated by user id or visitor id.
- Branch scoping follows the existing `*_scoped` permission helpers: an admin limited to a branch can only reach that branch.

## Delivery worker

`src/cron-jobs/messagingDispatchCron.ts` runs every minute with an `isRunning` guard.

1. **Promote:** move `SCHEDULED` dispatches with `scheduled_for ≤ now` to `QUEUED`, resolving the audience and inserting recipients.
2. **Claim:** select up to 200 `PENDING` recipients with `next_attempt_at` null or due. Flip them to `SENDING` with an `updateMany … where status = PENDING`, and only process the rows this run actually flipped, so two instances never double-send.
3. **Send** by channel:
   - **SMS.** New `sendHubtelSms({ phone, countryCode, message })` extracted from `notificationSmsService.ts` (the raw HTTP call plus `normalizePhoneForHubtel`). The existing `queueNotificationSms` is refactored to call it, with no behaviour change. If `isSmsEnabled()` is false, the row is `SKIPPED` ("SMS disabled"). A missing or invalid phone gives `SKIPPED` ("no phone").
   - **Email.** `sendEmail(html, to, subject)` with the `messagingTemplate.ts` layout. A missing email gives `SKIPPED` ("no email").
   - **In-app.** `createInAppNotification({ type: "messaging.message", title, body, recipientUserId, sendEmail: false, sendSms: false })`, which writes the inbox row and sends web and Expo push. Add `messaging.message` to `notificationPreferenceCatalog.ts`, default on.
4. **Outcome:**
   - Success sets `SENT` and `sent_at`.
   - Failure increments `attempts`. Below 3 attempts, the row goes back to `PENDING` with backoff (1, 5, then 15 minutes). On the third failure it becomes `FAILED` with the error.
5. **Finish:**
   - When a dispatch has no `PENDING` or `SENDING` rows, set it to `SENT` and recompute `counts`.
   - A dispatch with zero recipients is `SENT` with zero counts.
   - `FAILED` is reserved for dispatch-level errors such as audience resolution throwing.
   - Recipients left in `SENDING` for more than 10 minutes (crash mid-batch) are reset to `PENDING`.

## API

Module `src/modules/messaging/` (`messagingRoute.ts`, `messagingController.ts`, `messagingService.ts`, `placeholders.ts`, `audience.ts`, `delivery.ts`), mounted at `/messaging` in `src/routes/appRouter.ts`.

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /messaging/templates` | view | the four templates |
| `PUT /messaging/templates/:key` | manage | update enabled, channels, subject, body, include_app_link; validates placeholders; enabled requires ≥1 channel and a subject if email is on |
| `GET /messaging/settings` | view | store links, birthday time, timezone |
| `PUT /messaging/settings` | manage | URLs must be https; time must be HH:mm |
| `GET /messaging/placeholders?kind=` | view | whitelist with descriptions |
| `POST /messaging/preview` | view | `{ body, subject?, kind, userId? }` → rendered text and SMS length/segments (sample person if no userId) |
| `POST /messaging/audience/count` | manage | `{ audience, channels }` → `{ people, sms, email, inApp }` reachable counts |
| `GET /messaging/birthdays/upcoming?days=7` | view | name and date list |
| `POST /messaging/dispatches` | manage | general message: `{ title, body, emailSubject?, channels, audience, scheduledFor? }` |
| `GET /messaging/dispatches?kind=&page=` | view | history, newest first |
| `GET /messaging/dispatches/:id` | view | dispatch and paged recipients, filterable by channel and status |
| `POST /messaging/dispatches/:id/cancel` | manage | only `SCHEDULED` |
| `POST /messaging/dispatches/:id/retry-failed` | manage | `FAILED` rows → `PENDING`, attempts reset |
| `GET /messaging/stats?days=30` | view | sent/failed per template key (welcome and birthday card footers) |

Validation errors use `InputValidationError`, missing rows use `AppError` 404, matching the repo convention.

### Permission domain

Add `messaging` to `PERMISSION_KEY_ALIASES` and to the allowed list in `accessLevelController.ts`. Add guards `can_view_messaging` / `can_manage_messaging` to `Permissions` in `src/middleWare/authorization.ts`. Super admins pass automatically. Existing access levels get no messaging rights until assigned.

## Admin UI (Frontend)

- **Route:** child of `communication` in `src/routes/appRoutes.tsx` with `{ path: "messaging", name: "Messaging", element: <MessagingManager/>, permissionNeeded: "view_messaging", sideTab: true }`. Also add it to `COMMUNICATION_PAGES` in `CommunicationIndexRedirect.tsx`.
- **Permissions:** in `src/utils/accessControl.ts`, add the `messaging` domain to the canonical domains, aliases, `ACCESS_LEVEL_DOMAINS` (group "Engagement") and the permission-key map. No `DOMAIN_FALLBACKS` entry.
- **Code location:** `src/pages/HomePage/pages/ChurchCommunication/Messaging/`. API calls are added to the `api.fetch/post/put` classes, and types go in `src/utils/api/messaging/interfaces.ts`.
- **Page:** `MessagingManager.tsx` = `PageOutline` + `HeaderControls` + `TabSelection` with `welcome | birthday | general` synced to `?tab=`.
  - A settings button opens `MessagingSettingsModal` (store URLs, birthday send time).
  - Users without manage rights (`canManageCurrentRoute`) see everything read-only.

### Shared components

- `MessageComposer`: a textarea with a placeholder chip bar. Clicking a chip inserts the token at the cursor. Below the box: a live "N chars · M SMS" counter (160 / 153 per segment, up to 612) and inline errors for unknown tokens, checked against the whitelist fetched from the API.
- `ChannelPicker`: SMS / Email / In-app checkboxes. The email subject field shows only when Email is checked.
- `MessagePreview`: calls `POST /messaging/preview` and shows an SMS bubble and an email card.

### Tabs

- **Welcome:** three cards (Member sign-up, Guest sign-up, Visitor added). Each has an enabled toggle, composer, channels, Save and Preview, and the footer "Last 30 days: X sent · Y failed".
  - The Visitor card adds an "Include app download link" toggle. If no store URL is set, it shows a warning linking to settings.
- **Birthday:** one card, plus "Sends daily at HH:mm (Africa/Accra) · change in settings" and an "Upcoming birthdays (next 7 days)" list.
- **General:** a form with title, composer, channels, audience and timing, and a history list underneath.
  - **Audience:** a segmented control (Whole church / Departments / Specific people). Departments use `MultiSelect` over `fetchDepartments`; people use `MultiSelect` over `membersOptions`. "Include guests" and "Include visitors who consented" checkboxes appear for Whole church.
  - **Reach line:** a live line from `audience/count`.
  - **Timing:** Send now / Schedule (date-time).
  - **Confirm:** a modal shows "Send to N people · a SMS · b email · c in-app?".
  - **History:** title, audience summary, status chip, per-channel sent/failed/skipped, creator, created/scheduled time.
    - A row opens a drawer listing recipients, filterable by channel and status, with error reasons.
    - The drawer has Cancel (while scheduled) and Retry failed.
- Unsaved template edits prompt before switching tab.
- Toasts use `showNotification`; API errors use the existing handler.

## Mobile app (wwm-mobile)

Messages arrive as inbox notifications of type `messaging.message`. Check that `features/inbox` renders unknown types generically and that tapping one with no `actionUrl` is harmless. Add a mapping only if needed. No other mobile change.

## Out of scope (v1)

- Rich text / HTML authoring (email body is plain text with auto-linked URLs).
- Images and attachments.
- Templates or channels per branch.
- Replies and two-way SMS.
- Delivery receipts from Hubtel (SENT means Hubtel accepted the message).
- Recurring general messages.
- Birthday messages to visitors (no DOB stored).
- Saved drafts and A/B variants of general messages.

## Testing

- **Backend:** there is no test runner in `package.json`. Add focused unit checks as a `ts-node` script under `scripts/` (or add a minimal runner if the team agrees) covering:
  - `renderTemplate` fallbacks and unknown tokens
  - the Feb-29 birthday rule and once-per-day gating
  - audience de-duplication and consent filtering
  - dedupe keys (a repeated welcome is a no-op)
  - worker claim/retry transitions
- `tsc --noEmit` must pass.
- **Frontend:** `tsc` and lint.
- **Manual end-to-end** with `HUBTEL_SMS_ENABLED=false`:
  1. Enable `WELCOME_GUEST` and self-register a guest in the app; expect an inbox item, an email, and the SMS row `SKIPPED`.
  2. Add a consenting visitor; expect an email with the app links.
  3. Set the birthday time to now plus 5 minutes and give a test user today's DOB.
  4. Send a scheduled general message to one department and cancel another.

## Delivery

- Backend `feat/messaging` from `main`. It ships first: migration, module, crons, hooks.
- Frontend `feat/messaging` from `development`.
- wwm-mobile only if the inbox needs a mapping.
- Note: Backend and Frontend live in iCloud-synced folders with evicted `node_modules` and broken duplicate git refs; clean the refs before fetching and run `tsc` from a working install.
