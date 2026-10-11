# Admin Messaging — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for admin-configured Welcome, Birthday and General messages: templates with placeholders, delivery over SMS / Email / In-app, scheduling, history and a new `Messaging` permission.

**Architecture:** A new `src/modules/messaging/` module owns four tables (`message_template`, `message_settings`, `message_dispatch`, `message_recipient`).
- Every send becomes a dispatch plus one recipient row per person per channel, rendered at enqueue time.
- A one-minute cron worker claims pending rows and sends them through thin channel adapters that reuse the existing Hubtel sender, `sendEmail` and `createInAppNotification`.
- Pure logic (placeholders, birthday rules, audience parsing, backoff) lives in I/O-free files covered by `node:test`.

**Tech Stack:** Express 4, Prisma 6 (MySQL), node-cron 4, nodemailer, Hubtel SMS, `node:test` with `ts-node/register/transpile-only`.

**Spec:** `docs/superpowers/specs/2026-10-10-admin-messaging-design.md`

---

## Conventions an implementer must know

- **Branch and baseline.** Branch `feat/messaging` (already created from `main`). Run `npx tsc --noEmit` before every commit. It's slow (≈1–2 min) but must exit 0. Ignore any untracked `* 2.ts` files; they are iCloud duplicates, never stage them.
- **Errors.** Throw `InputValidationError` / `NotFoundError` from `src/utils/custom-error-handlers.ts`. `express-async-errors` + `globalErrorHandler` turn them into responses. Responses are `{ message, data }`.
- **Prisma.** Always import `prisma` from `src/Models/context.ts`.
- **Tests.** No runner exists yet; Task 1 adds `npm test`. Test files are `*.test.ts` beside the code and run with `node --test`.
- **No FKs on history tables.** Recipient and dispatch rows keep snapshots (name, address, rendered text) and plain id columns, so history survives a deleted user or visitor. This is a deliberate change from the spec.
- **Unique keys with nullable columns.** MySQL treats NULLs as distinct in UNIQUE indexes. That's why recipients use a non-null `recipient_key` (`u:<userId>` / `v:<visitorId>`) instead of `(user_id, visitor_id)`.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | 4 models + 5 enums |
| `prisma/migrations/20261010120000_messaging/migration.sql` (create) | tables, seeded templates and settings row, Messaging permission for full admins |
| `src/modules/messaging/placeholders.ts` | whitelist, `renderTemplate`, `findUnknownPlaceholders`, `appDownloadLink`, `smsSegments`, `renderEmailHtml` |
| `src/modules/messaging/birthday.ts` | `localParts`, `isBirthdayOn`, `ageOn`, `isBirthdayRunDue` |
| `src/modules/messaging/audience.ts` | `parseAudience` (pure) + `resolveAudience` (Prisma) |
| `src/modules/messaging/types.ts` | shared types: `Channels`, `Person`, `Audience`, keys |
| `src/modules/messaging/recipients.ts` | `buildRecipientRows` (pure), `insertRecipients` |
| `src/modules/messaging/channels.ts` | `sendSmsChannel`, `sendEmailChannel`, `sendInAppChannel` |
| `src/modules/messaging/worker.ts` | `promoteDueDispatches`, `processPendingRecipients`, `refreshDispatch`, `nextAttemptDelayMs`, `triggerDispatchProcessing` |
| `src/modules/messaging/messagingService.ts` | templates/settings CRUD, `enqueueWelcome`, `runBirthdays`, general dispatch CRUD, preview, counts, stats, upcoming birthdays |
| `src/modules/messaging/messagingController.ts` / `messagingRoute.ts` | HTTP layer |
| `src/cron-jobs/messagingDispatchCron.ts` / `messagingBirthdayCron.ts` | schedulers |
| `src/modules/notifications/notificationSmsService.ts` (modify) | export `sendSmsDirect` |
| `src/modules/notifications/notificationPreferenceCatalog.ts` (modify) | `messaging.message` type |
| `src/middleWare/authorization.ts` (modify) | `Messaging` alias + guards |
| `src/modules/accessLevels/accessLevelController.ts` (modify) | accept `Messaging` key |
| `src/routes/appRouter.ts`, `index.ts` (modify) | mount router, register crons |
| `src/modules/user/selfServiceController.ts`, `src/modules/visitorManagement/visitorService.ts` (modify) | welcome hooks |

---

### Task 1: Test runner

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the script**

In `package.json` `"scripts"`, add after `"copy:libs"`:

```json
    "copy:libs": "cpx \"src/libs/**/*\" dist/src/libs",
    "test": "node --test --require ts-node/register/transpile-only \"src/**/*.test.ts\""
```

- [ ] **Step 2: Verify it runs with zero tests**

Run: `npm test`
Expected: exits 0 and prints `# tests 0`. Node 22 expands the glob itself.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(test): add node:test runner for pure unit tests"
```

---

### Task 2: Prisma schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (append at end of file)
- Create: `prisma/migrations/20261010120000_messaging/migration.sql`

- [ ] **Step 1: Save the pre-change schema for diffing**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema.before.prisma
```

- [ ] **Step 2: Append the models to `prisma/schema.prisma`**

```prisma
enum message_template_key {
  WELCOME_MEMBER
  WELCOME_GUEST
  WELCOME_VISITOR
  BIRTHDAY
}

enum message_dispatch_kind {
  WELCOME
  BIRTHDAY
  GENERAL
}

enum message_dispatch_status {
  SCHEDULED
  QUEUED
  SENT
  CANCELLED
  FAILED
}

enum message_channel {
  SMS
  EMAIL
  IN_APP
}

enum message_recipient_status {
  PENDING
  SENDING
  SENT
  FAILED
  SKIPPED
}

/// Admin-editable automatic message. One row per key, seeded by migration.
model message_template {
  id               Int                  @id @default(autoincrement())
  key              message_template_key @unique
  enabled          Boolean              @default(false)
  /// {"sms":bool,"email":bool,"inApp":bool}
  channels         Json
  email_subject    String?
  body             String               @db.Text
  include_app_link Boolean              @default(false)
  updated_by       Int?
  updated_at       DateTime             @updatedAt
}

/// Singleton (id = 1).
model message_settings {
  id                     Int      @id @default(autoincrement())
  app_store_url          String?
  play_store_url         String?
  birthday_send_time     String   @default("07:00")
  timezone               String   @default("Africa/Accra")
  last_birthday_run_date String?
  updated_by             Int?
  updated_at             DateTime @updatedAt
}

model message_dispatch {
  id            Int                     @id @default(autoincrement())
  kind          message_dispatch_kind
  template_key  message_template_key?
  dedupe_key    String?                 @unique
  title         String
  body          String                  @db.Text
  email_subject String?
  channels      Json
  audience      Json?
  status        message_dispatch_status
  scheduled_for DateTime?
  error         String?                 @db.Text
  created_by    Int?
  counts        Json?
  created_at    DateTime                @default(now())
  updated_at    DateTime                @updatedAt
  recipients    message_recipient[]

  @@index([status, scheduled_for])
  @@index([kind, created_at])
}

model message_recipient {
  id               Int                      @id @default(autoincrement())
  dispatch_id      Int
  channel          message_channel
  /// "u:<userId>" or "v:<visitorId>" — non-null so the unique key works in MySQL.
  recipient_key    String
  user_id          Int?
  visitor_id       Int?
  recipient_name   String
  address          String?
  rendered_subject String?
  rendered_body    String                   @db.Text
  status           message_recipient_status
  error            String?                  @db.Text
  attempts         Int                      @default(0)
  next_attempt_at  DateTime?
  claimed_at       DateTime?
  sent_at          DateTime?
  created_at       DateTime                 @default(now())
  dispatch         message_dispatch         @relation(fields: [dispatch_id], references: [id], onDelete: Cascade)

  @@unique([dispatch_id, channel, recipient_key])
  @@index([status, next_attempt_at])
  @@index([user_id])
}
```

- [ ] **Step 3: Validate the schema and generate the table SQL offline**

```bash
npx prisma validate
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema.before.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/messaging_tables.sql
cat /tmp/messaging_tables.sql
```

Expected: `validate` prints "The schema at prisma/schema.prisma is valid". The diff contains only `CREATE TABLE` for the four `message_*` tables plus one `ALTER TABLE message_recipient ADD CONSTRAINT …fkey`. If it contains anything else, the working tree had other schema drift; stop and investigate.

- [ ] **Step 4: Write the migration file**

Create `prisma/migrations/20261010120000_messaging/migration.sql`. It has three parts:

1. This header:

```sql
/*
  Admin Messaging: Welcome, Birthday and General messages.

  - message_template: four admin-editable automatic templates, seeded disabled
    so nothing sends until an admin turns one on.
  - message_settings: singleton with app store links and birthday send time.
  - message_dispatch / message_recipient: the outbox. Recipient rows snapshot
    name, address and rendered text and carry no FK to user/visitor, so
    history survives deletions.
  - Access levels that hold Super_Admin on Access_rights get Super_Admin on
    the new Messaging domain; every other level starts without it.
*/
```

2. The exact contents of `/tmp/messaging_tables.sql`, pasted verbatim.

3. These seed statements:

```sql
-- Seed templates (disabled)
INSERT INTO `message_template` (`key`, `enabled`, `channels`, `email_subject`, `body`, `include_app_link`, `updated_at`) VALUES
('WELCOME_MEMBER', false, '{"sms":true,"email":false,"inApp":true}', 'Welcome to {church_name}',
 'Hi {first_name}, welcome to {church_name}! We are glad you have joined our church family. Open the app any time for sermons, events and giving.', false, CURRENT_TIMESTAMP(3)),
('WELCOME_GUEST', false, '{"sms":true,"email":false,"inApp":true}', 'Welcome to {church_name}',
 'Hi {first_name}, thank you for joining {church_name} as a guest. We would love to see you again. Check the app for service times and events.', false, CURRENT_TIMESTAMP(3)),
('WELCOME_VISITOR', false, '{"sms":true,"email":true,"inApp":false}', 'Thank you for visiting {church_name}',
 'Hi {first_name}, thank you for worshipping with us at {church_name}. We would love to stay in touch.', true, CURRENT_TIMESTAMP(3)),
('BIRTHDAY', false, '{"sms":true,"email":false,"inApp":true}', 'Happy birthday, {first_name}!',
 'Happy birthday, {first_name}! Everyone at {church_name} is celebrating you today. May this new year be full of God''s blessings.', false, CURRENT_TIMESTAMP(3));

-- Settings singleton
INSERT INTO `message_settings` (`id`, `birthday_send_time`, `timezone`, `updated_at`)
VALUES (1, '07:00', 'Africa/Accra', CURRENT_TIMESTAMP(3));

-- Messaging permission for full admins only
UPDATE `access_level`
SET `permissions` = JSON_SET(`permissions`, '$.Messaging', 'Super_Admin')
WHERE CASE
    WHEN `permissions` IS NOT NULL AND JSON_VALID(`permissions`) THEN
        JSON_TYPE(`permissions`) = 'OBJECT'
        AND JSON_UNQUOTE(JSON_EXTRACT(`permissions`, '$.Access_rights')) = 'Super_Admin'
        AND NOT JSON_CONTAINS_PATH(`permissions`, 'one', '$.Messaging')
    ELSE false
END;
```

- [ ] **Step 5: Regenerate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". `prisma.message_template`, `prisma.message_dispatch` etc. now type-check.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261010120000_messaging/migration.sql
git commit -m "feat(messaging): add template, settings and outbox tables"
```

---

### Task 3: Shared types

**Files:**
- Create: `src/modules/messaging/types.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Types shared across the messaging module. No runtime code beyond constants.
 */

export const TEMPLATE_KEYS = [
  "WELCOME_MEMBER",
  "WELCOME_GUEST",
  "WELCOME_VISITOR",
  "BIRTHDAY",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type Channels = { sms: boolean; email: boolean; inApp: boolean };

/** Which placeholders a message may use. */
export type PlaceholderKind = "WELCOME" | "BIRTHDAY" | "GENERAL";

export const placeholderKindOf = (key: TemplateKey): PlaceholderKind =>
  key === "BIRTHDAY" ? "BIRTHDAY" : "WELCOME";

/** Someone a message can be rendered for and delivered to. */
export type Person = {
  userId: number | null;
  visitorId: number | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
  dateOfBirth: Date | null;
};

export type Audience = {
  scope: "CHURCH" | "DEPARTMENTS" | "PEOPLE";
  departmentIds: number[];
  userIds: number[];
  includeGuests: boolean;
  includeVisitors: boolean;
};

export const toChannels = (value: unknown): Channels => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    sms: record.sms === true,
    email: record.email === true,
    inApp: record.inApp === true,
  };
};

export const hasAnyChannel = (channels: Channels): boolean =>
  channels.sms || channels.email || channels.inApp;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/messaging/types.ts
git commit -m "feat(messaging): shared types"
```

---

### Task 4: Placeholder engine (TDD)

**Files:**
- Create: `src/modules/messaging/placeholders.ts`
- Test: `src/modules/messaging/placeholders.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  findUnknownPlaceholders,
  appDownloadLink,
  smsSegments,
  renderEmailHtml,
  withAppLink,
} from "./placeholders";

const ctx = {
  firstName: "Ama",
  lastName: "Mensah",
  title: "Deaconess",
  age: 34,
  appStoreUrl: "https://apps.apple.com/app/id1",
  playStoreUrl: "https://play.google.com/store/apps/details?id=x",
};

test("replaces known tokens", () => {
  assert.equal(
    renderTemplate("Hi {first_name} {last_name}, {church_name}", ctx),
    "Hi Ama Mensah, Worldwide Word Ministries",
  );
});

test("missing first name falls back to Friend and tidies spacing", () => {
  assert.equal(
    renderTemplate("Hi {title} {first_name} {last_name}, welcome", {
      ...ctx,
      firstName: null,
      lastName: null,
      title: null,
    }),
    "Hi Friend, welcome",
  );
});

test("full_name falls back to Friend", () => {
  assert.equal(renderTemplate("{full_name}", { ...ctx, firstName: "", lastName: "" }), "Friend");
});

test("age renders only when known", () => {
  assert.equal(renderTemplate("Turning {age}!", ctx), "Turning 34!");
  assert.equal(renderTemplate("Turning {age}!", { ...ctx, age: null }), "Turning!");
});

test("unknown tokens are left as-is by render", () => {
  assert.equal(renderTemplate("Hi {nickname}", ctx), "Hi {nickname}");
});

test("findUnknownPlaceholders reports typos and kind-restricted tokens", () => {
  assert.deepEqual(findUnknownPlaceholders("Hi {frist_name} {first_name}", "GENERAL"), ["{frist_name}"]);
  assert.deepEqual(findUnknownPlaceholders("Turning {age}", "GENERAL"), ["{age}"]);
  assert.deepEqual(findUnknownPlaceholders("Turning {age}", "BIRTHDAY"), []);
});

test("appDownloadLink lists only configured stores", () => {
  assert.equal(
    appDownloadLink(ctx),
    "iPhone: https://apps.apple.com/app/id1\nAndroid: https://play.google.com/store/apps/details?id=x",
  );
  assert.equal(appDownloadLink({ ...ctx, appStoreUrl: null }), "Android: https://play.google.com/store/apps/details?id=x");
  assert.equal(appDownloadLink({ ...ctx, appStoreUrl: null, playStoreUrl: null }), "");
});

test("withAppLink appends the token once", () => {
  assert.equal(withAppLink("Hello", true), "Hello\n{app_download_link}");
  assert.equal(withAppLink("Get it: {app_download_link}", true), "Get it: {app_download_link}");
  assert.equal(withAppLink("Hello", false), "Hello");
});

test("collapses blank lines left by empty values", () => {
  assert.equal(
    renderTemplate("Hi\n{app_download_link}\n\n\nBye", { ...ctx, appStoreUrl: null, playStoreUrl: null }),
    "Hi\n\nBye",
  );
});

test("smsSegments: GSM vs unicode", () => {
  assert.deepEqual(smsSegments("a".repeat(160)), { length: 160, segments: 1, unicode: false });
  assert.deepEqual(smsSegments("a".repeat(161)), { length: 161, segments: 2, unicode: false });
  assert.deepEqual(smsSegments("🎉" + "a".repeat(69)), { length: 70, segments: 1, unicode: true });
  assert.deepEqual(smsSegments("🎉" + "a".repeat(70)), { length: 71, segments: 2, unicode: true });
  assert.deepEqual(smsSegments(""), { length: 0, segments: 0, unicode: false });
});

test("renderEmailHtml escapes, linkifies and keeps line breaks", () => {
  const html = renderEmailHtml("A <b>\nhttps://x.org/a?b=1&c=2");
  assert.ok(html.includes("A &lt;b&gt;<br />"));
  assert.ok(html.includes('<a href="https://x.org/a?b=1&amp;c=2">https://x.org/a?b=1&amp;c=2</a>'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `Cannot find module './placeholders'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Placeholder engine for admin messages. Pure: no Prisma, no I/O.
 *
 * Syntax is a single-brace `{token}` from a fixed whitelist. Unknown tokens
 * are rejected at save time (findUnknownPlaceholders) and left untouched by
 * renderTemplate, so a typo is visible rather than silently blank.
 */
import { escapeEmailHtml } from "../../utils/mail_templates/unifiedEmailTemplate";
import { PlaceholderKind } from "./types";

export const CHURCH_NAME = "Worldwide Word Ministries";
const NAME_FALLBACK = "Friend";

export type RenderContext = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  age: number | null;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
};

export type PlaceholderInfo = {
  token: string;
  description: string;
  kinds: PlaceholderKind[];
};

const ALL: PlaceholderKind[] = ["WELCOME", "BIRTHDAY", "GENERAL"];

export const PLACEHOLDERS: PlaceholderInfo[] = [
  { token: "{first_name}", description: "First name (\"Friend\" if unknown)", kinds: ALL },
  { token: "{last_name}", description: "Last name", kinds: ALL },
  { token: "{full_name}", description: "First and last name (\"Friend\" if unknown)", kinds: ALL },
  { token: "{title}", description: "Title, e.g. Pastor", kinds: ALL },
  { token: "{church_name}", description: CHURCH_NAME, kinds: ALL },
  { token: "{app_store_link}", description: "App Store link from Messaging settings", kinds: ALL },
  { token: "{play_store_link}", description: "Play Store link from Messaging settings", kinds: ALL },
  { token: "{app_download_link}", description: "Both store links, one per line", kinds: ALL },
  { token: "{age}", description: "Age they are turning today", kinds: ["BIRTHDAY"] },
];

export const placeholdersFor = (kind: PlaceholderKind): PlaceholderInfo[] =>
  PLACEHOLDERS.filter((p) => p.kinds.includes(kind));

const TOKEN_PATTERN = /\{[a-z_]+\}/g;

const clean = (value: string | null | undefined): string => String(value ?? "").trim();

export const appDownloadLink = (ctx: Pick<RenderContext, "appStoreUrl" | "playStoreUrl">): string =>
  [
    clean(ctx.appStoreUrl) ? `iPhone: ${clean(ctx.appStoreUrl)}` : "",
    clean(ctx.playStoreUrl) ? `Android: ${clean(ctx.playStoreUrl)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

const valueOf = (token: string, ctx: RenderContext): string | null => {
  const first = clean(ctx.firstName);
  const last = clean(ctx.lastName);
  switch (token) {
    case "{first_name}":
      return first || NAME_FALLBACK;
    case "{last_name}":
      return last;
    case "{full_name}":
      return [first, last].filter(Boolean).join(" ") || NAME_FALLBACK;
    case "{title}":
      return clean(ctx.title);
    case "{church_name}":
      return CHURCH_NAME;
    case "{app_store_link}":
      return clean(ctx.appStoreUrl);
    case "{play_store_link}":
      return clean(ctx.playStoreUrl);
    case "{app_download_link}":
      return appDownloadLink(ctx);
    case "{age}":
      return ctx.age === null ? "" : String(ctx.age);
    default:
      return null;
  }
};

export const renderTemplate = (text: string, ctx: RenderContext): string =>
  String(text ?? "")
    .replace(TOKEN_PATTERN, (token) => valueOf(token, ctx) ?? token)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const findUnknownPlaceholders = (text: string, kind: PlaceholderKind): string[] => {
  const allowed = new Set(placeholdersFor(kind).map((p) => p.token));
  const found = String(text ?? "").match(TOKEN_PATTERN) ?? [];
  return Array.from(new Set(found.filter((token) => !allowed.has(token))));
};

/** Appends {app_download_link} when the toggle is on and the body lacks it. */
export const withAppLink = (body: string, includeAppLink: boolean): string =>
  includeAppLink && !body.includes("{app_download_link}")
    ? `${body}\n{app_download_link}`
    : body;

// GSM 03.38 basic set + extension table. Anything else forces UCS-2.
const GSM_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM_SET = new Set(Array.from(GSM_CHARS));

export const smsSegments = (text: string): { length: number; segments: number; unicode: boolean } => {
  const chars = Array.from(text ?? "");
  const length = chars.length;
  if (!length) return { length: 0, segments: 0, unicode: false };
  const unicode = chars.some((c) => !GSM_SET.has(c));
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { length, segments: length <= single ? 1 : Math.ceil(length / multi), unicode };
};

const URL_PATTERN = /https?:\/\/[^\s<]+/g;

/** Plain text → safe HTML fragment for the unified email layout. */
export const renderEmailHtml = (text: string): string =>
  escapeEmailHtml(text)
    .replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\n/g, "<br />");
```

Note on the emoji tests: `Array.from` counts the emoji as one character, and any emoji switches the message to unicode (70 chars single, 67 per segment after that).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all placeholder tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/placeholders.ts src/modules/messaging/placeholders.test.ts
git commit -m "feat(messaging): placeholder engine with SMS segment counter"
```

---

### Task 5: Birthday rules (TDD)

**Files:**
- Create: `src/modules/messaging/birthday.ts`
- Test: `src/modules/messaging/birthday.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, isBirthdayOn, ageOn, isBirthdayRunDue } from "./birthday";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));

test("localParts in Accra (UTC+0) and Lagos (UTC+1)", () => {
  assert.deepEqual(localParts(utc(2026, 10, 10, 23, 30), "Africa/Accra"), { date: "2026-10-10", year: 2026, month: 10, day: 10, minutes: 23 * 60 + 30 });
  assert.deepEqual(localParts(utc(2026, 10, 10, 23, 30), "Africa/Lagos"), { date: "2026-10-11", year: 2026, month: 10, day: 11, minutes: 30 });
});

test("isBirthdayOn matches month/day using UTC fields of DOB", () => {
  assert.equal(isBirthdayOn(utc(1990, 10, 10), { year: 2026, month: 10, day: 10 }), true);
  assert.equal(isBirthdayOn(utc(1990, 10, 11), { year: 2026, month: 10, day: 10 }), false);
});

test("Feb 29 birthdays fall on Feb 28 in non-leap years only", () => {
  const leapling = utc(2000, 2, 29);
  assert.equal(isBirthdayOn(leapling, { year: 2027, month: 2, day: 28 }), true);
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 2, day: 28 }), false);
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 2, day: 29 }), true);
});

test("ageOn", () => {
  assert.equal(ageOn(utc(1990, 10, 10), 2026), 36);
  assert.equal(ageOn(utc(2030, 1, 1), 2026), null);
});

test("isBirthdayRunDue: after send time, once per local day", () => {
  const settings = { birthday_send_time: "07:00", timezone: "Africa/Accra", last_birthday_run_date: null as string | null };
  assert.equal(isBirthdayRunDue(settings, utc(2026, 10, 10, 6, 59)), false);
  assert.equal(isBirthdayRunDue(settings, utc(2026, 10, 10, 7, 0)), true);
  assert.equal(isBirthdayRunDue({ ...settings, last_birthday_run_date: "2026-10-10" }, utc(2026, 10, 10, 9, 0)), false);
  assert.equal(isBirthdayRunDue({ ...settings, last_birthday_run_date: "2026-10-09" }, utc(2026, 10, 10, 15, 0)), true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `Cannot find module './birthday'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Birthday rules. Pure: no Prisma, no I/O.
 *
 * Dates of birth are compared on their UTC month/day — the dashboard stores
 * them as midnight UTC, so local-time getters would shift a day west of UTC.
 */

export type LocalParts = { date: string; year: number; month: number; day: number; minutes: number };

/** Wall-clock fields of `now` in an IANA timezone. */
export const localParts = (now: Date, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, year, month, day, minutes: get("hour") * 60 + get("minute") };
};

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const isBirthdayOn = (
  dateOfBirth: Date,
  today: { year: number; month: number; day: number },
): boolean => {
  const month = dateOfBirth.getUTCMonth() + 1;
  const day = dateOfBirth.getUTCDate();
  if (month === today.month && day === today.day) return true;
  return month === 2 && day === 29 && today.month === 2 && today.day === 28 && !isLeapYear(today.year);
};

export const ageOn = (dateOfBirth: Date, year: number): number | null => {
  const age = year - dateOfBirth.getUTCFullYear();
  return age > 0 && age < 130 ? age : null;
};

const toMinutes = (clock: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 7 * 60;
};

export const isBirthdayRunDue = (
  settings: { birthday_send_time: string; timezone: string; last_birthday_run_date: string | null },
  now: Date,
): boolean => {
  const local = localParts(now, settings.timezone);
  return local.minutes >= toMinutes(settings.birthday_send_time) && settings.last_birthday_run_date !== local.date;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/birthday.ts src/modules/messaging/birthday.test.ts
git commit -m "feat(messaging): birthday matching and daily run gate"
```

---

### Task 6: Recipient row builder (TDD)

Turns people × channels into outbox rows. Pure, so dedupe, skip reasons and rendering are testable.

**Files:**
- Create: `src/modules/messaging/recipients.ts`
- Test: `src/modules/messaging/recipients.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecipientRows } from "./recipients";
import { Person } from "./types";

const person = (over: Partial<Person>): Person => ({
  userId: 1,
  visitorId: null,
  firstName: "Kofi",
  lastName: "Owusu",
  title: null,
  email: "kofi@example.com",
  phone: "0241234567",
  countryCode: "+233",
  dateOfBirth: null,
  ...over,
});

const base = {
  dispatchId: 9,
  body: "Hi {first_name}",
  subject: "Hello {first_name}",
  defaultTitle: "Message",
  channels: { sms: true, email: true, inApp: true },
  settings: { appStoreUrl: null, playStoreUrl: null },
  ageYear: null,
};

test("one row per person per enabled channel, rendered", () => {
  const rows = buildRecipientRows({ ...base, people: [person({})] });
  assert.equal(rows.length, 3);
  const sms = rows.find((r) => r.channel === "SMS")!;
  assert.equal(sms.rendered_body, "Hi Kofi");
  assert.equal(sms.rendered_subject, "Hello Kofi");
  assert.equal(sms.address, "0241234567");
  assert.equal(sms.recipient_key, "u:1");
  assert.equal(sms.status, "PENDING");
});

test("dedupes the same person", () => {
  const rows = buildRecipientRows({ ...base, people: [person({}), person({})] });
  assert.equal(rows.length, 3);
});

test("skips with reasons: no phone, no email, visitor in-app", () => {
  const rows = buildRecipientRows({
    ...base,
    people: [person({ userId: null, visitorId: 5, phone: null, email: null })],
  });
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
  assert.equal(byChannel.SMS.status, "SKIPPED");
  assert.equal(byChannel.SMS.error, "No phone number");
  assert.equal(byChannel.EMAIL.error, "No email address");
  assert.equal(byChannel.IN_APP.error, "Visitors have no app account");
  assert.equal(byChannel.IN_APP.recipient_key, "v:5");
});

test("disabled channels produce no rows; subject falls back to default title", () => {
  const rows = buildRecipientRows({
    ...base,
    subject: null,
    channels: { sms: false, email: false, inApp: true },
    people: [person({})],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rendered_subject, "Message");
});

test("SMS body is capped at 612 chars with an ellipsis", () => {
  const rows = buildRecipientRows({
    ...base,
    body: "x".repeat(700),
    channels: { sms: true, email: false, inApp: false },
    people: [person({})],
  });
  assert.equal(rows[0].rendered_body.length, 612);
  assert.ok(rows[0].rendered_body.endsWith("…"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `Cannot find module './recipients'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Builds and inserts message_recipient rows. buildRecipientRows is pure.
 */
import { prisma } from "../../Models/context";
import { ageOn } from "./birthday";
import { renderTemplate } from "./placeholders";
import { Channels, Person } from "./types";

const SMS_MAX_LENGTH = (() => {
  const parsed = Number(process.env.HUBTEL_SMS_MAX_MESSAGE_LENGTH);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 612;
})();

export type RecipientRow = {
  dispatch_id: number;
  channel: "SMS" | "EMAIL" | "IN_APP";
  recipient_key: string;
  user_id: number | null;
  visitor_id: number | null;
  recipient_name: string;
  address: string | null;
  rendered_subject: string;
  rendered_body: string;
  status: "PENDING" | "SKIPPED";
  error: string | null;
};

const keyOf = (p: Person): string | null =>
  p.userId ? `u:${p.userId}` : p.visitorId ? `v:${p.visitorId}` : null;

const capSms = (text: string): string =>
  text.length > SMS_MAX_LENGTH ? `${text.slice(0, SMS_MAX_LENGTH - 1)}…` : text;

export const buildRecipientRows = (args: {
  dispatchId: number;
  people: Person[];
  body: string;
  subject: string | null;
  defaultTitle: string;
  channels: Channels;
  settings: { appStoreUrl: string | null; playStoreUrl: string | null };
  /** Year to compute {age} for; null outside birthday sends. */
  ageYear: number | null;
}): RecipientRow[] => {
  const rows: RecipientRow[] = [];
  const seen = new Set<string>();

  for (const person of args.people) {
    const key = keyOf(person);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const ctx = {
      firstName: person.firstName,
      lastName: person.lastName,
      title: person.title,
      age: args.ageYear && person.dateOfBirth ? ageOn(person.dateOfBirth, args.ageYear) : null,
      appStoreUrl: args.settings.appStoreUrl,
      playStoreUrl: args.settings.playStoreUrl,
    };
    const body = renderTemplate(args.body, ctx);
    const subject = renderTemplate(args.subject || args.defaultTitle, ctx);
    const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown";
    const common = {
      dispatch_id: args.dispatchId,
      recipient_key: key,
      user_id: person.userId,
      visitor_id: person.visitorId,
      recipient_name: name,
      rendered_subject: subject,
    };
    const row = (
      channel: RecipientRow["channel"],
      address: string | null,
      renderedBody: string,
      skipReason: string | null,
    ): RecipientRow => ({
      ...common,
      channel,
      address,
      rendered_body: renderedBody,
      status: skipReason ? "SKIPPED" : "PENDING",
      error: skipReason,
    });

    if (args.channels.sms) {
      const phone = person.phone?.trim() || null;
      rows.push(row("SMS", phone, capSms(body), phone ? null : "No phone number"));
    }
    if (args.channels.email) {
      const email = person.email?.trim() || null;
      rows.push(row("EMAIL", email, body, email ? null : "No email address"));
    }
    if (args.channels.inApp) {
      rows.push(row("IN_APP", null, body, person.userId ? null : "Visitors have no app account"));
    }
  }
  return rows;
};

/** Inserts in chunks; duplicates (same dispatch/channel/person) are ignored. */
export const insertRecipients = async (rows: RecipientRow[]): Promise<number> => {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const result = await prisma.message_recipient.createMany({
      data: rows.slice(i, i + 1000),
      skipDuplicates: true,
    });
    inserted += result.count;
  }
  return inserted;
};
```

`country_code` for SMS is resolved at send time from the user/visitor row, not from the address. See Task 9.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/recipients.ts src/modules/messaging/recipients.test.ts
git commit -m "feat(messaging): build outbox rows per person and channel"
```

---

### Task 7: Audience parsing (TDD) and resolution

**Files:**
- Create: `src/modules/messaging/audience.ts`
- Test: `src/modules/messaging/audience.test.ts`

- [ ] **Step 1: Write the failing tests (pure parser only)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAudience } from "./audience";

test("church audience with toggles", () => {
  assert.deepEqual(parseAudience({ scope: "CHURCH", includeGuests: true }), {
    scope: "CHURCH", departmentIds: [], userIds: [], includeGuests: true, includeVisitors: false,
  });
});

test("departments require at least one id and dedupe ids", () => {
  assert.deepEqual(parseAudience({ scope: "DEPARTMENTS", departmentIds: [3, "3", 4] }).departmentIds, [3, 4]);
  assert.throws(() => parseAudience({ scope: "DEPARTMENTS", departmentIds: [] }), /department/i);
});

test("people require at least one id; toggles ignored outside CHURCH", () => {
  const a = parseAudience({ scope: "PEOPLE", userIds: [7], includeGuests: true, includeVisitors: true });
  assert.deepEqual(a, { scope: "PEOPLE", departmentIds: [], userIds: [7], includeGuests: false, includeVisitors: false });
  assert.throws(() => parseAudience({ scope: "PEOPLE", userIds: [] }), /person/i);
});

test("rejects unknown scope", () => {
  assert.throws(() => parseAudience({ scope: "EVERYONE" }), /scope/i);
  assert.throws(() => parseAudience(null), /scope/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `Cannot find module './audience'`.

- [ ] **Step 3: Implement**

```ts
/**
 * General-message audiences: validation (pure) and resolution to people.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { departmentMemberIds } from "../community/communityQueries";
import { Audience, Person } from "./types";

const toIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
      )
    : [];

export const parseAudience = (raw: unknown): Audience => {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const scope = record.scope;
  if (scope !== "CHURCH" && scope !== "DEPARTMENTS" && scope !== "PEOPLE") {
    throw new InputValidationError("audience.scope must be CHURCH, DEPARTMENTS or PEOPLE");
  }
  const departmentIds = scope === "DEPARTMENTS" ? toIds(record.departmentIds) : [];
  const userIds = scope === "PEOPLE" ? toIds(record.userIds) : [];
  if (scope === "DEPARTMENTS" && !departmentIds.length) {
    throw new InputValidationError("Choose at least one department");
  }
  if (scope === "PEOPLE" && !userIds.length) {
    throw new InputValidationError("Choose at least one person");
  }
  const isChurch = scope === "CHURCH";
  return {
    scope,
    departmentIds,
    userIds,
    includeGuests: isChurch && record.includeGuests === true,
    includeVisitors: isChurch && record.includeVisitors === true,
  };
};

const activeWhere: Prisma.userWhereInput = { OR: [{ is_active: true }, { is_active: null }] };
const memberWhere: Prisma.userWhereInput = { OR: [{ is_guest: false }, { is_guest: null }] };

const userSelect = {
  id: true,
  email: true,
  user_info: {
    select: {
      first_name: true,
      last_name: true,
      title: true,
      email: true,
      primary_number: true,
      country_code: true,
      date_of_birth: true,
    },
  },
} satisfies Prisma.userSelect;

type UserRow = Prisma.userGetPayload<{ select: typeof userSelect }>;

export const userToPerson = (u: UserRow): Person => ({
  userId: u.id,
  visitorId: null,
  firstName: u.user_info?.first_name ?? null,
  lastName: u.user_info?.last_name ?? null,
  title: u.user_info?.title ?? null,
  email: u.user_info?.email || u.email || null,
  phone: u.user_info?.primary_number ?? null,
  countryCode: u.user_info?.country_code ?? null,
  dateOfBirth: u.user_info?.date_of_birth ?? null,
});

const visitorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  title: true,
  email: true,
  phone: true,
  country_code: true,
} satisfies Prisma.visitorSelect;

type VisitorRow = Prisma.visitorGetPayload<{ select: typeof visitorSelect }>;

export const visitorToPerson = (v: VisitorRow): Person => ({
  userId: null,
  visitorId: v.id,
  firstName: v.firstName || null,
  lastName: v.lastName || null,
  title: v.title ?? null,
  email: v.email ?? null,
  phone: v.phone ?? null,
  countryCode: v.country_code ?? null,
  dateOfBirth: null,
});

export const findUsers = async (where: Prisma.userWhereInput): Promise<Person[]> =>
  (await prisma.user.findMany({ where, select: userSelect })).map(userToPerson);

export const findVisitorPerson = async (visitorId: number): Promise<Person | null> => {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId }, select: visitorSelect });
  return v ? visitorToPerson(v) : null;
};

/** Resolves an audience to people. De-duplication happens in buildRecipientRows. */
export const resolveAudience = async (audience: Audience): Promise<Person[]> => {
  if (audience.scope === "PEOPLE") {
    return findUsers({ AND: [activeWhere, { id: { in: audience.userIds } }] });
  }

  if (audience.scope === "DEPARTMENTS") {
    const byDept = await departmentMemberIds(audience.departmentIds);
    const ids = Array.from(new Set(Array.from(byDept.values()).flat()));
    return ids.length ? findUsers({ id: { in: ids } }) : [];
  }

  const users = await findUsers(
    audience.includeGuests ? activeWhere : { AND: [activeWhere, memberWhere] },
  );
  if (!audience.includeVisitors) return users;

  // Converted visitors (is_member) already appear as users.
  const visitors = await prisma.visitor.findMany({
    where: { consentToContact: true, is_member: false },
    select: visitorSelect,
  });
  return [...users, ...visitors.map(visitorToPerson)];
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. The test only exercises `parseAudience`. Importing the module loads Prisma client code but opens no connection.

If importing `../../Models/context` in a test tries to connect or fails without `DATABASE_URL`, move `parseAudience` and `toIds` into `audience.parse.ts`. Re-export them from `audience.ts` and point the test at `audience.parse.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/audience.ts src/modules/messaging/audience.test.ts
git commit -m "feat(messaging): audience parsing and resolution"
```

---

### Task 8: Direct SMS export

**Files:**
- Modify: `src/modules/notifications/notificationSmsService.ts` (near `isSmsEnabled`, ~line 1076, and the export object)

- [ ] **Step 1: Add `sendSmsDirect` above `const isSmsEnabled`**

```ts
/**
 * Sends one SMS straight to Hubtel without the notification job table, for
 * callers that keep their own outbox (admin Messaging). Throws
 * HubtelSmsRequestError on failure; `transient` says whether to retry.
 */
const sendSmsDirect = async (input: {
  phoneNumber: string;
  countryCode?: string | null;
  message: string;
}): Promise<{ skipped: string | null }> => {
  const config = getConfig();
  if (!config.enabled) {
    return { skipped: config.disabledReason || "SMS disabled" };
  }
  const phone = normalizePhoneForHubtel(input.phoneNumber, input.countryCode);
  if (!phone) {
    return { skipped: "Invalid phone number" };
  }
  const message = normalizeMessage(input.message, config.maxMessageLength);
  if (!message) {
    return { skipped: "Empty message" };
  }
  await sendHubtelSms(
    { notificationType: "messaging.message", recipientUserId: 0, phoneNumber: phone, message },
    config,
  );
  return { skipped: null };
};
```

- [ ] **Step 2: Export it**

```ts
export const notificationSmsService = {
  isSmsEnabled,
  normalizePhoneForHubtel,
  queueNotificationSms,
  processPendingSmsDeliveryJobs,
  triggerPendingSmsDeliveryJobProcessing,
  sendSmsDirect,
};
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/notifications/notificationSmsService.ts
git commit -m "feat(sms): direct send for callers with their own outbox"
```

---

### Task 9: Channel adapters and notification type

**Files:**
- Create: `src/modules/messaging/channels.ts`
- Modify: `src/modules/notifications/notificationPreferenceCatalog.ts` (add an entry to `NOTIFICATION_PREFERENCE_OPTIONS`)

- [ ] **Step 1: Register the in-app type**

Add as the first element of `NOTIFICATION_PREFERENCE_OPTIONS`:

```ts
  {
    type: "messaging.message",
    title: "Messages from the church",
    description: "Welcome, birthday and church-wide messages sent by the church office.",
    category: "Church",
    availableChannels: IN_APP_ONLY_CHANNELS,
  },
```

- [ ] **Step 2: Write the adapters**

```ts
/**
 * One function per channel. Each returns a skip reason, or throws on a
 * failure that the worker should count as an attempt.
 */
import { prisma } from "../../Models/context";
import { notificationService } from "../notifications/notificationService";
import { notificationSmsService } from "../notifications/notificationSmsService";
import { sendEmail } from "../../utils/emailService";
import { buildUnifiedEmailTemplate } from "../../utils/mail_templates/unifiedEmailTemplate";
import { CHURCH_NAME, renderEmailHtml } from "./placeholders";

export type ChannelRow = {
  id: number;
  dispatch_id: number;
  channel: "SMS" | "EMAIL" | "IN_APP";
  user_id: number | null;
  visitor_id: number | null;
  address: string | null;
  rendered_subject: string | null;
  rendered_body: string;
};

export class RetryableError extends Error {}
export class PermanentError extends Error {}

const countryCodeFor = async (row: ChannelRow): Promise<string | null> => {
  if (row.user_id) {
    const info = await prisma.user_info.findUnique({
      where: { user_id: row.user_id },
      select: { country_code: true },
    });
    return info?.country_code ?? null;
  }
  if (row.visitor_id) {
    const v = await prisma.visitor.findUnique({
      where: { id: row.visitor_id },
      select: { country_code: true },
    });
    return v?.country_code ?? null;
  }
  return null;
};

export const sendSmsChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.address) return "No phone number";
  try {
    const { skipped } = await notificationSmsService.sendSmsDirect({
      phoneNumber: row.address,
      countryCode: (await countryCodeFor(row)) ?? "+233",
      message: row.rendered_body,
    });
    return skipped;
  } catch (error: any) {
    const message = error?.message || "SMS failed";
    throw error?.transient === false ? new PermanentError(message) : new RetryableError(message);
  }
};

export const sendEmailChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.address) return "No email address";
  const subject = row.rendered_subject || CHURCH_NAME;
  const html = buildUnifiedEmailTemplate({
    headerTitle: subject,
    headerText: CHURCH_NAME,
    messageHtml: renderEmailHtml(row.rendered_body),
  });
  try {
    await sendEmail(html, row.address, subject, { throwOnError: true });
  } catch (error: any) {
    if (/Missing SMTP configuration/.test(error?.message || "")) {
      return "Email not configured";
    }
    throw new RetryableError(error?.message || "Email failed");
  }
  return null;
};

export const sendInAppChannel = async (row: ChannelRow): Promise<string | null> => {
  if (!row.user_id) return "Visitors have no app account";
  const result = await notificationService.createInAppNotification({
    type: "messaging.message",
    title: row.rendered_subject || CHURCH_NAME,
    body: row.rendered_body,
    recipientUserId: row.user_id,
    entityType: "message_dispatch",
    entityId: row.dispatch_id,
    dedupeKey: `messaging:${row.id}`,
    sendEmail: false,
    sendSms: false,
  });
  return result ? null : "Member is inactive or turned these off";
};

export const sendByChannel = (row: ChannelRow): Promise<string | null> =>
  row.channel === "SMS"
    ? sendSmsChannel(row)
    : row.channel === "EMAIL"
      ? sendEmailChannel(row)
      : sendInAppChannel(row);
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/messaging/channels.ts src/modules/notifications/notificationPreferenceCatalog.ts
git commit -m "feat(messaging): SMS, email and in-app channel adapters"
```

---

### Task 10: Delivery worker (TDD for backoff, then worker)

**Files:**
- Create: `src/modules/messaging/worker.ts`
- Test: `src/modules/messaging/worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAttemptDelayMs, MAX_ATTEMPTS, summarize } from "./worker";

test("backoff 1, 5, 15 minutes; null at max", () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(nextAttemptDelayMs(1), 60_000);
  assert.equal(nextAttemptDelayMs(2), 5 * 60_000);
  assert.equal(nextAttemptDelayMs(3), null);
});

test("summarize groups counts per channel and reports open work", () => {
  const result = summarize([
    { channel: "SMS", status: "SENT", _count: { _all: 3 } },
    { channel: "SMS", status: "SKIPPED", _count: { _all: 1 } },
    { channel: "EMAIL", status: "PENDING", _count: { _all: 2 } },
  ]);
  assert.deepEqual(result.counts.sms, { sent: 3, failed: 0, skipped: 1, pending: 0 });
  assert.deepEqual(result.counts.email, { sent: 0, failed: 0, skipped: 0, pending: 2 });
  assert.equal(result.open, 2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `Cannot find module './worker'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Outbox worker. Called by messagingDispatchCron every minute and nudged
 * right after an enqueue so welcome messages do not wait for the next tick.
 */
import { prisma } from "../../Models/context";
import { ChannelRow, PermanentError, sendByChannel } from "./channels";

export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 200;
const STALE_CLAIM_MS = 10 * 60_000;
const DELAYS_MS = [60_000, 5 * 60_000];

/** Delay before the next try after `attempts` failures; null = give up. */
export const nextAttemptDelayMs = (attempts: number): number | null =>
  attempts >= MAX_ATTEMPTS ? null : DELAYS_MS[attempts - 1] ?? DELAYS_MS[DELAYS_MS.length - 1];

type ChannelCounts = { sent: number; failed: number; skipped: number; pending: number };
const empty = (): ChannelCounts => ({ sent: 0, failed: 0, skipped: 0, pending: 0 });
const CHANNEL_KEY = { SMS: "sms", EMAIL: "email", IN_APP: "inApp" } as const;

export const summarize = (
  groups: { channel: "SMS" | "EMAIL" | "IN_APP"; status: string; _count: { _all: number } }[],
) => {
  const counts = { sms: empty(), email: empty(), inApp: empty() };
  let open = 0;
  for (const g of groups) {
    const bucket = counts[CHANNEL_KEY[g.channel]];
    const n = g._count._all;
    if (g.status === "SENT") bucket.sent += n;
    else if (g.status === "FAILED") bucket.failed += n;
    else if (g.status === "SKIPPED") bucket.skipped += n;
    else {
      bucket.pending += n;
      open += n;
    }
  }
  return { counts, open };
};

/** Recomputes cached counts; marks the dispatch SENT when nothing is open. */
export const refreshDispatch = async (dispatchId: number) => {
  const groups = await prisma.message_recipient.groupBy({
    by: ["channel", "status"],
    where: { dispatch_id: dispatchId },
    _count: { _all: true },
  });
  const people = await prisma.message_recipient.groupBy({
    by: ["recipient_key"],
    where: { dispatch_id: dispatchId },
  });
  const summary = summarize(groups as any);
  await prisma.message_dispatch.updateMany({
    where: { id: dispatchId, status: { in: ["QUEUED", "SENT"] } },
    data: {
      counts: { ...summary.counts, people: people.length },
      ...(summary.open === 0 ? { status: "SENT" } : {}),
    },
  });
};

const processRow = async (row: ChannelRow & { attempts: number }) => {
  try {
    const skipped = await sendByChannel(row);
    await prisma.message_recipient.update({
      where: { id: row.id },
      data: skipped
        ? { status: "SKIPPED", error: skipped, claimed_at: null }
        : { status: "SENT", sent_at: new Date(), error: null, claimed_at: null },
    });
  } catch (error: any) {
    const attempts = row.attempts + 1;
    const delay = error instanceof PermanentError ? null : nextAttemptDelayMs(attempts);
    await prisma.message_recipient.update({
      where: { id: row.id },
      data: {
        attempts,
        error: String(error?.message || error).slice(0, 1000),
        claimed_at: null,
        ...(delay === null
          ? { status: "FAILED" }
          : { status: "PENDING", next_attempt_at: new Date(Date.now() + delay) }),
      },
    });
  }
};

/** Claims and sends one batch. Returns the number of rows processed. */
export const processPendingRecipients = async (): Promise<number> => {
  const now = new Date();

  // Rows stuck in SENDING (crash mid-batch) go back to the queue.
  await prisma.message_recipient.updateMany({
    where: { status: "SENDING", claimed_at: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    data: { status: "PENDING", claimed_at: null },
  });

  const candidates = await prisma.message_recipient.findMany({
    where: {
      status: "PENDING",
      OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }],
      dispatch: { status: "QUEUED" },
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
  });

  const touched = new Set<number>();
  for (const row of candidates) {
    // Per-row claim: a second worker that read the same row gets count 0.
    const claim = await prisma.message_recipient.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING", claimed_at: new Date() },
    });
    if (claim.count !== 1) continue;
    await processRow(row as any);
    touched.add(row.dispatch_id);
  }

  for (const id of touched) await refreshDispatch(id);
  return candidates.length;
};

let running = false;

/** Fire-and-forget nudge after an enqueue. Never throws. */
export const triggerDispatchProcessing = () => {
  if (running) return;
  setImmediate(async () => {
    if (running) return;
    running = true;
    try {
      await processPendingRecipients();
    } catch (error) {
      console.error("[ERROR] Messaging dispatch nudge failed:", error);
    } finally {
      running = false;
    }
  });
};

export const isWorkerRunning = () => running;
export const setWorkerRunning = (value: boolean) => {
  running = value;
};
```

The scheduled-dispatch promotion lives in `messagingService` (Task 11) because it needs audience resolution and settings. The cron (Task 13) calls `promoteDueDispatches` then `processPendingRecipients`.

- [ ] **Step 4: Run tests, type-check, commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, exit 0.

```bash
git add src/modules/messaging/worker.ts src/modules/messaging/worker.test.ts
git commit -m "feat(messaging): outbox worker with per-row claims and retries"
```

---

### Task 11: Messaging service

**Files:**
- Create: `src/modules/messaging/messagingService.ts`

- [ ] **Step 1: Write the service**

```ts
/**
 * Messaging use cases: templates, settings, welcome and birthday enqueue,
 * general dispatches, previews and stats.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError, NotFoundError } from "../../utils/custom-error-handlers";
import { findUnknownPlaceholders, placeholdersFor, renderTemplate, smsSegments, withAppLink } from "./placeholders";
import { ageOn, isBirthdayOn, isBirthdayRunDue, localParts } from "./birthday";
import { buildRecipientRows, insertRecipients } from "./recipients";
import { findUsers, findVisitorPerson, parseAudience, resolveAudience } from "./audience";
import { refreshDispatch, triggerDispatchProcessing } from "./worker";
import {
  Channels,
  hasAnyChannel,
  Person,
  PlaceholderKind,
  placeholderKindOf,
  TEMPLATE_KEYS,
  TemplateKey,
  toChannels,
} from "./types";

const MAX_BODY = 2000;
const MAX_SCHEDULE_DAYS = 90;
const DEFAULT_TITLES: Record<"WELCOME" | "BIRTHDAY" | "GENERAL", string> = {
  WELCOME: "Welcome",
  BIRTHDAY: "Happy birthday",
  GENERAL: "Message from the church",
};

// ---------- settings ----------

export const getSettings = async () =>
  (await prisma.message_settings.findUnique({ where: { id: 1 } })) ??
  prisma.message_settings.create({ data: { id: 1 } });

const httpsOrNull = (value: unknown, field: string): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^https:\/\/\S+$/i.test(text)) throw new InputValidationError(`${field} must be an https:// link`);
  return text.slice(0, 500);
};

export const updateSettings = async (body: any, actorId: number | null) => {
  const time = String(body?.birthdaySendTime ?? "").trim();
  if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    throw new InputValidationError("birthdaySendTime must be HH:mm");
  }
  await getSettings();
  return prisma.message_settings.update({
    where: { id: 1 },
    data: {
      app_store_url: httpsOrNull(body?.appStoreUrl, "App Store link"),
      play_store_url: httpsOrNull(body?.playStoreUrl, "Play Store link"),
      ...(time ? { birthday_send_time: time } : {}),
      updated_by: actorId,
    },
  });
};

const linkSettings = (s: { app_store_url: string | null; play_store_url: string | null }) => ({
  appStoreUrl: s.app_store_url,
  playStoreUrl: s.play_store_url,
});

// ---------- validation shared by templates and general messages ----------

const validateMessage = (args: {
  body: unknown;
  subject: unknown;
  channels: Channels;
  kind: PlaceholderKind;
  requireChannel: boolean;
}) => {
  const body = String(args.body ?? "").trim();
  const subject = String(args.subject ?? "").trim() || null;
  if (!body) throw new InputValidationError("Message text is required");
  if (body.length > MAX_BODY) throw new InputValidationError(`Message text must be at most ${MAX_BODY} characters`);
  if (args.requireChannel && !hasAnyChannel(args.channels)) {
    throw new InputValidationError("Choose at least one channel");
  }
  if (args.channels.email && !subject) throw new InputValidationError("Email subject is required when Email is on");
  const unknown = [
    ...findUnknownPlaceholders(body, args.kind),
    ...findUnknownPlaceholders(subject ?? "", args.kind),
  ];
  if (unknown.length) {
    throw new InputValidationError(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${Array.from(new Set(unknown)).join(", ")}`);
  }
  return { body, subject };
};

// ---------- templates ----------

const toTemplateDto = (t: Prisma.message_templateGetPayload<{}>) => ({
  key: t.key,
  enabled: t.enabled,
  channels: toChannels(t.channels),
  emailSubject: t.email_subject,
  body: t.body,
  includeAppLink: t.include_app_link,
  updatedAt: t.updated_at,
});

export const listTemplates = async () =>
  (await prisma.message_template.findMany({ orderBy: { id: "asc" } })).map(toTemplateDto);

const parseKey = (value: unknown): TemplateKey => {
  const key = String(value ?? "").toUpperCase();
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) throw new NotFoundError("Unknown template");
  return key as TemplateKey;
};

export const updateTemplate = async (rawKey: unknown, body: any, actorId: number | null) => {
  const key = parseKey(rawKey);
  const channels = toChannels(body?.channels);
  const enabled = body?.enabled === true;
  const message = validateMessage({
    body: body?.body,
    subject: body?.emailSubject,
    channels,
    kind: placeholderKindOf(key),
    requireChannel: enabled,
  });
  const updated = await prisma.message_template.update({
    where: { key },
    data: {
      enabled,
      channels,
      body: message.body,
      email_subject: message.subject,
      include_app_link: key === "WELCOME_VISITOR" && body?.includeAppLink === true,
      updated_by: actorId,
    },
  });
  return toTemplateDto(updated);
};

// ---------- enqueue helpers ----------

const createDispatchWithRecipients = async (args: {
  kind: "WELCOME" | "BIRTHDAY";
  templateKey: TemplateKey;
  dedupeKey: string;
  title: string;
  body: string;
  subject: string | null;
  channels: Channels;
  people: Person[];
  ageYear: number | null;
}): Promise<number | null> => {
  const settings = await getSettings();
  let dispatchId: number;
  try {
    const dispatch = await prisma.message_dispatch.create({
      data: {
        kind: args.kind,
        template_key: args.templateKey,
        dedupe_key: args.dedupeKey,
        title: args.title,
        body: args.body,
        email_subject: args.subject,
        channels: args.channels,
        status: "QUEUED",
      },
    });
    dispatchId = dispatch.id;
  } catch (error: any) {
    if (error?.code === "P2002") return null; // already sent for this key
    throw error;
  }
  await insertRecipients(
    buildRecipientRows({
      dispatchId,
      people: args.people,
      body: args.body,
      subject: args.subject,
      defaultTitle: DEFAULT_TITLES[args.kind],
      channels: args.channels,
      settings: linkSettings(settings),
      ageYear: args.ageYear,
    }),
  );
  await refreshDispatch(dispatchId);
  triggerDispatchProcessing();
  return dispatchId;
};

const loadEnabledTemplate = async (key: TemplateKey) => {
  const t = await prisma.message_template.findUnique({ where: { key } });
  if (!t || !t.enabled) return null;
  const channels = toChannels(t.channels);
  return hasAnyChannel(channels) ? { ...t, channels } : null;
};

// ---------- welcome ----------

/**
 * Queues the welcome message for a new app sign-up or a new visitor. Never
 * throws: sign-up and visitor creation must not fail because of messaging.
 */
export const enqueueWelcome = async (
  target: { userId: number; isGuest: boolean } | { visitorId: number },
): Promise<void> => {
  try {
    const key: TemplateKey =
      "visitorId" in target ? "WELCOME_VISITOR" : target.isGuest ? "WELCOME_GUEST" : "WELCOME_MEMBER";
    const template = await loadEnabledTemplate(key);
    if (!template) return;

    const person =
      "visitorId" in target
        ? await findVisitorPerson(target.visitorId)
        : (await findUsers({ id: target.userId }))[0] ?? null;
    if (!person) return;

    const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
    await createDispatchWithRecipients({
      kind: "WELCOME",
      templateKey: key,
      dedupeKey: "visitorId" in target ? `WELCOME:visitor:${target.visitorId}` : `WELCOME:user:${target.userId}`,
      title: `Welcome — ${name || "new sign-up"}`,
      body: withAppLink(template.body, template.include_app_link),
      subject: template.email_subject,
      channels: template.channels,
      people: [person],
      ageYear: null,
    });
  } catch (error) {
    console.error("[ERROR] Failed to queue welcome message:", error);
  }
};

// ---------- birthday ----------

const birthdayCandidates = async (): Promise<Person[]> =>
  findUsers({
    AND: [
      { OR: [{ is_active: true }, { is_active: null }] },
      { user_info: { date_of_birth: { not: null } } },
    ],
  });

/** Runs once per local day after the configured time. Returns people queued. */
export const runBirthdays = async (now: Date = new Date()): Promise<number> => {
  const settings = await getSettings();
  if (!isBirthdayRunDue(settings, now)) return 0;
  const local = localParts(now, settings.timezone);

  const template = await loadEnabledTemplate("BIRTHDAY");
  if (!template) {
    // Mark the day done so turning the template on at 15:00 does not
    // surprise-send hours late; it starts tomorrow.
    await prisma.message_settings.update({ where: { id: 1 }, data: { last_birthday_run_date: local.date } });
    return 0;
  }

  const people = (await birthdayCandidates()).filter(
    (p) => p.dateOfBirth && isBirthdayOn(p.dateOfBirth, local),
  );

  // Claim the day first so a crash after this point cannot double-send;
  // the dispatch dedupe key is the second guard.
  const claim = await prisma.message_settings.updateMany({
    where: { id: 1, OR: [{ last_birthday_run_date: null }, { last_birthday_run_date: { not: local.date } }] },
    data: { last_birthday_run_date: local.date },
  });
  if (claim.count !== 1 || !people.length) return 0;

  await createDispatchWithRecipients({
    kind: "BIRTHDAY",
    templateKey: "BIRTHDAY",
    dedupeKey: `BIRTHDAY:${local.date}`,
    title: `Birthdays — ${local.date}`,
    body: template.body,
    subject: template.email_subject,
    channels: template.channels,
    people,
    ageYear: local.year,
  });
  return people.length;
};

export const upcomingBirthdays = async (days: number, now: Date = new Date()) => {
  const settings = await getSettings();
  const span = Math.min(Math.max(Math.trunc(days) || 7, 1), 31);
  const people = await birthdayCandidates();
  const result: { userId: number; name: string; date: string; age: number | null }[] = [];
  for (let i = 0; i < span; i += 1) {
    const day = localParts(new Date(now.getTime() + i * 86_400_000), settings.timezone);
    for (const p of people) {
      if (p.dateOfBirth && isBirthdayOn(p.dateOfBirth, day)) {
        result.push({
          userId: p.userId as number,
          name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unknown",
          date: day.date,
          age: ageOn(p.dateOfBirth, day.year),
        });
      }
    }
  }
  return result;
};

// ---------- general ----------

const parseSchedule = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (isNaN(date.getTime())) throw new InputValidationError("scheduledFor is not a valid date");
  const now = Date.now();
  if (date.getTime() <= now) throw new InputValidationError("Scheduled time must be in the future");
  if (date.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) {
    throw new InputValidationError(`Schedule at most ${MAX_SCHEDULE_DAYS} days ahead`);
  }
  return date;
};

/** Resolves the audience and inserts recipients for a QUEUED general dispatch. */
const fillGeneralDispatch = async (dispatchId: number) => {
  const d = await prisma.message_dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
  const settings = await getSettings();
  const people = await resolveAudience(parseAudience(d.audience));
  await insertRecipients(
    buildRecipientRows({
      dispatchId,
      people,
      body: d.body,
      subject: d.email_subject,
      defaultTitle: d.title || DEFAULT_TITLES.GENERAL,
      channels: toChannels(d.channels),
      settings: linkSettings(settings),
      ageYear: null,
    }),
  );
  await refreshDispatch(dispatchId);
};

export const createGeneralDispatch = async (body: any, actorId: number | null) => {
  const title = String(body?.title ?? "").trim().slice(0, 150);
  if (!title) throw new InputValidationError("Title is required");
  const channels = toChannels(body?.channels);
  const message = validateMessage({
    body: body?.body,
    subject: body?.emailSubject,
    channels,
    kind: "GENERAL",
    requireChannel: true,
  });
  const audience = parseAudience(body?.audience);
  const scheduledFor = parseSchedule(body?.scheduledFor);

  const dispatch = await prisma.message_dispatch.create({
    data: {
      kind: "GENERAL",
      title,
      body: message.body,
      email_subject: message.subject,
      channels,
      audience,
      status: scheduledFor ? "SCHEDULED" : "QUEUED",
      scheduled_for: scheduledFor,
      created_by: actorId,
    },
  });
  if (!scheduledFor) {
    await fillGeneralDispatch(dispatch.id);
    triggerDispatchProcessing();
  }
  return getDispatch(dispatch.id);
};

/** Moves due SCHEDULED dispatches to QUEUED and fills their recipients. */
export const promoteDueDispatches = async (now: Date = new Date()): Promise<number> => {
  const due = await prisma.message_dispatch.findMany({
    where: { status: "SCHEDULED", scheduled_for: { lte: now } },
    select: { id: true },
    take: 20,
  });
  let promoted = 0;
  for (const { id } of due) {
    const claim = await prisma.message_dispatch.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "QUEUED" },
    });
    if (claim.count !== 1) continue;
    try {
      await fillGeneralDispatch(id);
      promoted += 1;
    } catch (error: any) {
      await prisma.message_dispatch.update({
        where: { id },
        data: { status: "FAILED", error: String(error?.message || error).slice(0, 1000) },
      });
    }
  }
  return promoted;
};

const toDispatchDto = (d: Prisma.message_dispatchGetPayload<{}>) => ({
  id: d.id,
  kind: d.kind,
  templateKey: d.template_key,
  title: d.title,
  body: d.body,
  emailSubject: d.email_subject,
  channels: toChannels(d.channels),
  audience: d.audience,
  status: d.status,
  scheduledFor: d.scheduled_for,
  error: d.error,
  counts: d.counts,
  createdBy: d.created_by,
  createdAt: d.created_at,
});

export const listDispatches = async (query: any) => {
  const kind = ["WELCOME", "BIRTHDAY", "GENERAL"].includes(String(query?.kind)) ? String(query.kind) : undefined;
  const page = Math.max(Number(query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
  const where: Prisma.message_dispatchWhereInput = kind ? { kind: kind as any } : {};
  const [rows, total] = await Promise.all([
    prisma.message_dispatch.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.message_dispatch.count({ where }),
  ]);
  const creatorIds = Array.from(new Set(rows.map((r) => r.created_by).filter((id): id is number => !!id)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(creators.map((c) => [c.id, c.name]));
  return {
    data: rows.map((r) => ({ ...toDispatchDto(r), createdByName: r.created_by ? names.get(r.created_by) ?? null : null })),
    page,
    limit,
    total,
  };
};

export const getDispatch = async (id: number) => {
  const d = await prisma.message_dispatch.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Message not found");
  return toDispatchDto(d);
};

export const listDispatchRecipients = async (id: number, query: any) => {
  await getDispatch(id);
  const page = Math.max(Number(query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
  const where: Prisma.message_recipientWhereInput = { dispatch_id: id };
  if (["SMS", "EMAIL", "IN_APP"].includes(String(query?.channel))) where.channel = query.channel;
  if (["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"].includes(String(query?.status))) where.status = query.status;
  const [rows, total] = await Promise.all([
    prisma.message_recipient.findMany({
      where,
      orderBy: { id: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, channel: true, recipient_name: true, address: true, status: true,
        error: true, attempts: true, sent_at: true, user_id: true, visitor_id: true,
      },
    }),
    prisma.message_recipient.count({ where }),
  ]);
  return { data: rows, page, limit, total };
};

export const cancelDispatch = async (id: number) => {
  const result = await prisma.message_dispatch.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });
  if (result.count !== 1) throw new InputValidationError("Only scheduled messages can be cancelled");
  return getDispatch(id);
};

export const retryFailed = async (id: number) => {
  await getDispatch(id);
  const result = await prisma.message_recipient.updateMany({
    where: { dispatch_id: id, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, next_attempt_at: null, error: null },
  });
  if (result.count) {
    await prisma.message_dispatch.updateMany({ where: { id, status: "SENT" }, data: { status: "QUEUED" } });
    triggerDispatchProcessing();
  }
  return { retried: result.count };
};

// ---------- preview, counts, stats, placeholders ----------

const SAMPLE: Person = {
  userId: null, visitorId: null, firstName: "Ama", lastName: "Mensah", title: null,
  email: null, phone: null, countryCode: null, dateOfBirth: new Date(Date.UTC(1990, 0, 1)),
};

export const preview = async (body: any) => {
  const kind: PlaceholderKind = ["WELCOME", "BIRTHDAY", "GENERAL"].includes(body?.kind) ? body.kind : "GENERAL";
  const settings = await getSettings();
  const userId = Number(body?.userId);
  const person = Number.isInteger(userId) && userId > 0 ? (await findUsers({ id: userId }))[0] ?? SAMPLE : SAMPLE;
  const now = localParts(new Date(), settings.timezone);
  const ctx = {
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    age: kind === "BIRTHDAY" && person.dateOfBirth ? ageOn(person.dateOfBirth, now.year) : null,
    ...linkSettings(settings),
  };
  const text = renderTemplate(withAppLink(String(body?.body ?? ""), body?.includeAppLink === true), ctx);
  return {
    body: text,
    subject: body?.subject ? renderTemplate(String(body.subject), ctx) : null,
    sms: smsSegments(text),
    unknownPlaceholders: findUnknownPlaceholders(String(body?.body ?? "") + " " + String(body?.subject ?? ""), kind),
  };
};

export const audienceCount = async (body: any) => {
  const people = await resolveAudience(parseAudience(body?.audience));
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    const key = p.userId ? `u:${p.userId}` : `v:${p.visitorId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    people: unique.length,
    sms: unique.filter((p) => p.phone?.trim()).length,
    email: unique.filter((p) => p.email?.trim()).length,
    inApp: unique.filter((p) => p.userId).length,
  };
};

export const templateStats = async (days: number) => {
  const since = new Date(Date.now() - Math.min(Math.max(days || 30, 1), 365) * 86_400_000);
  const dispatches = await prisma.message_dispatch.findMany({
    where: { template_key: { not: null }, created_at: { gte: since } },
    select: { id: true, template_key: true },
  });
  const keyOf = new Map(dispatches.map((d) => [d.id, d.template_key as TemplateKey]));
  const groups = dispatches.length
    ? await prisma.message_recipient.groupBy({
        by: ["dispatch_id", "status"],
        where: { dispatch_id: { in: dispatches.map((d) => d.id) } },
        _count: { _all: true },
      })
    : [];
  const stats = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, { sent: 0, failed: 0, skipped: 0 }])) as Record<
    TemplateKey,
    { sent: number; failed: number; skipped: number }
  >;
  for (const g of groups) {
    const bucket = stats[keyOf.get(g.dispatch_id) as TemplateKey];
    if (!bucket) continue;
    if (g.status === "SENT") bucket.sent += g._count._all;
    if (g.status === "FAILED") bucket.failed += g._count._all;
    if (g.status === "SKIPPED") bucket.skipped += g._count._all;
  }
  return stats;
};

export const listPlaceholders = (kind: unknown) =>
  placeholdersFor(["WELCOME", "BIRTHDAY", "GENERAL"].includes(String(kind)) ? (String(kind) as PlaceholderKind) : "GENERAL");
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0. If `prisma.message_settings.create({ data: { id: 1 } })` complains about the `updated_at` requirement, it won't: `@updatedAt` is set automatically.

```bash
git add src/modules/messaging/messagingService.ts
git commit -m "feat(messaging): templates, welcome, birthday and general dispatch service"
```

---

### Task 12: Permission domain

**Files:**
- Modify: `src/middleWare/authorization.ts` (`PERMISSION_KEY_ALIASES` ~line 58; add guards after the Sermons guards ~line 1883)
- Modify: `src/modules/accessLevels/accessLevelController.ts` (`OPTIONAL_PERMISSION_KEYS`, `PERMISSION_KEY_NORMALIZER`)

- [ ] **Step 1: Alias**

In `PERMISSION_KEY_ALIASES`, after the `Promotions` entry:

```ts
  // Admin Messaging (welcome, birthday, general SMS/email/in-app). No
  // fallback: bulk SMS costs money, so it is never inherited from Community.
  // The 20261010120000_messaging migration grants it to full admins.
  Messaging: ["Messaging"],
```

- [ ] **Step 2: Guards**

After `can_delete_sermons`:

```ts
  // Messaging
  can_view_messaging = this.checkPermission(
    "Messaging",
    "view",
    "Not authorized to view messaging",
  );

  can_manage_messaging = this.checkPermission(
    "Messaging",
    "manage",
    "Not authorized to manage messaging",
  );
```

- [ ] **Step 3: Access-level validation**

In `accessLevelController.ts`, append `"Messaging",` to `OPTIONAL_PERMISSION_KEYS` after `"Promotions"`. In `PERMISSION_KEY_NORMALIZER`, after `Promotion: "Promotions",`, add:

```ts
  Messaging: "Messaging",
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/middleWare/authorization.ts src/modules/accessLevels/accessLevelController.ts
git commit -m "feat(messaging): Messaging permission domain"
```

---

### Task 13: Controller, routes, crons

**Files:**
- Create: `src/modules/messaging/messagingController.ts`, `src/modules/messaging/messagingRoute.ts`
- Create: `src/cron-jobs/messagingDispatchCron.ts`, `src/cron-jobs/messagingBirthdayCron.ts`
- Modify: `src/routes/appRouter.ts`, `index.ts`

- [ ] **Step 1: Controller**

```ts
import { Request, Response } from "express";
import * as service from "./messagingService";

const actorId = (req: Request): number | null => {
  const id = Number((req as any)?.user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const idParam = (req: Request): number => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

export const messagingController = {
  listTemplates: async (_req: Request, res: Response) =>
    res.json({ message: "Templates", data: await service.listTemplates() }),
  updateTemplate: async (req: Request, res: Response) =>
    res.json({ message: "Template saved", data: await service.updateTemplate(req.params.key, req.body, actorId(req)) }),
  getSettings: async (_req: Request, res: Response) =>
    res.json({ message: "Settings", data: await service.getSettings() }),
  updateSettings: async (req: Request, res: Response) =>
    res.json({ message: "Settings saved", data: await service.updateSettings(req.body, actorId(req)) }),
  placeholders: async (req: Request, res: Response) =>
    res.json({ message: "Placeholders", data: service.listPlaceholders(req.query.kind) }),
  preview: async (req: Request, res: Response) =>
    res.json({ message: "Preview", data: await service.preview(req.body) }),
  audienceCount: async (req: Request, res: Response) =>
    res.json({ message: "Audience", data: await service.audienceCount(req.body) }),
  upcomingBirthdays: async (req: Request, res: Response) =>
    res.json({ message: "Upcoming birthdays", data: await service.upcomingBirthdays(Number(req.query.days)) }),
  stats: async (req: Request, res: Response) =>
    res.json({ message: "Stats", data: await service.templateStats(Number(req.query.days)) }),
  createDispatch: async (req: Request, res: Response) =>
    res.status(201).json({ message: "Message created", data: await service.createGeneralDispatch(req.body, actorId(req)) }),
  listDispatches: async (req: Request, res: Response) => {
    const result = await service.listDispatches(req.query);
    return res.json({ message: "Messages", ...result });
  },
  getDispatch: async (req: Request, res: Response) =>
    res.json({ message: "Message", data: await service.getDispatch(idParam(req)) }),
  listRecipients: async (req: Request, res: Response) => {
    const result = await service.listDispatchRecipients(idParam(req), req.query);
    return res.json({ message: "Recipients", ...result });
  },
  cancel: async (req: Request, res: Response) =>
    res.json({ message: "Message cancelled", data: await service.cancelDispatch(idParam(req)) }),
  retryFailed: async (req: Request, res: Response) =>
    res.json({ message: "Retry queued", data: await service.retryFailed(idParam(req)) }),
};
```

- [ ] **Step 2: Routes**

```ts
import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import { messagingController as c } from "./messagingController";

const permissions = new Permissions();
const protect = permissions.protect;
const view = [protect, permissions.can_view_messaging];
const manage = [protect, permissions.can_manage_messaging];

const router = Router();

router.get("/templates", view, c.listTemplates);
router.put("/templates/:key", manage, c.updateTemplate);
router.get("/settings", view, c.getSettings);
router.put("/settings", manage, c.updateSettings);
router.get("/placeholders", view, c.placeholders);
router.post("/preview", view, c.preview);
router.post("/audience/count", manage, c.audienceCount);
router.get("/birthdays/upcoming", view, c.upcomingBirthdays);
router.get("/stats", view, c.stats);
router.post("/dispatches", manage, c.createDispatch);
router.get("/dispatches", view, c.listDispatches);
router.get("/dispatches/:id", view, c.getDispatch);
router.get("/dispatches/:id/recipients", view, c.listRecipients);
router.post("/dispatches/:id/cancel", manage, c.cancel);
router.post("/dispatches/:id/retry-failed", manage, c.retryFailed);

export default router;
```

- [ ] **Step 3: Mount**

In `src/routes/appRouter.ts`, add the import after `communityRouter`:

```ts
import messagingRouter from "../modules/messaging/messagingRoute";
```

Add the mount next to the other `appRouter.use` lines, after `/community` (search for `appRouter.use("/community"`):

```ts
appRouter.use("/messaging", messagingRouter);
```

- [ ] **Step 4: Dispatch cron**

`src/cron-jobs/messagingDispatchCron.ts`:

```ts
/**
 * messagingDispatchCron.ts
 *
 * Every minute: promote due scheduled messages, then send one batch of the
 * outbox. Shares the worker's running flag with the post-enqueue nudge so
 * the two never overlap in this process; per-row claims cover other workers.
 */
import cron from "node-cron";
import { promoteDueDispatches } from "../modules/messaging/messagingService";
import { isWorkerRunning, processPendingRecipients, setWorkerRunning } from "../modules/messaging/worker";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

const MESSAGING_DISPATCH_CRON = process.env.MESSAGING_DISPATCH_CRON || "* * * * *";

export async function processMessagingDispatchJob() {
  if (isWorkerRunning()) return;
  setWorkerRunning(true);
  try {
    await promoteDueDispatches();
    await processPendingRecipients();
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Messaging dispatch job", normalizedError);
      return;
    }
    console.error("[ERROR] Messaging dispatch job failed:", normalizedError);
  } finally {
    setWorkerRunning(false);
  }
}

if (!cron.validate(MESSAGING_DISPATCH_CRON)) {
  console.error(`[ERROR] Messaging dispatch job disabled: invalid MESSAGING_DISPATCH_CRON "${MESSAGING_DISPATCH_CRON}".`);
} else {
  cron.schedule(MESSAGING_DISPATCH_CRON, () => {
    void processMessagingDispatchJob();
  });
}
```

- [ ] **Step 5: Birthday cron**

`src/cron-jobs/messagingBirthdayCron.ts`:

```ts
/**
 * messagingBirthdayCron.ts
 *
 * Every 15 minutes: if the birthday template is on, the church-local time
 * has passed the configured send time and today has not run yet, queue
 * today's birthday messages. Catches up after a restart past send time.
 */
import cron from "node-cron";
import { runBirthdays } from "../modules/messaging/messagingService";
import {
  isDatabaseUnavailableError,
  logDatabaseUnavailableWarning,
  normalizeCronJobErrorMessage,
} from "./notificationRetryCronUtils";

let isBirthdayJobRunning = false;
const MESSAGING_BIRTHDAY_CRON = process.env.MESSAGING_BIRTHDAY_CRON || "*/15 * * * *";

export async function processBirthdayMessagesJob() {
  if (isBirthdayJobRunning) return;
  isBirthdayJobRunning = true;
  try {
    const queued = await runBirthdays();
    if (queued) console.info(`[INFO] Queued birthday messages for ${queued} member(s)`);
  } catch (error: any) {
    const normalizedError = normalizeCronJobErrorMessage(error);
    if (isDatabaseUnavailableError(error)) {
      logDatabaseUnavailableWarning("Birthday messages job", normalizedError);
      return;
    }
    console.error("[ERROR] Birthday messages job failed:", normalizedError);
  } finally {
    isBirthdayJobRunning = false;
  }
}

if (!cron.validate(MESSAGING_BIRTHDAY_CRON)) {
  console.error(`[ERROR] Birthday messages job disabled: invalid MESSAGING_BIRTHDAY_CRON "${MESSAGING_BIRTHDAY_CRON}".`);
} else {
  cron.schedule(MESSAGING_BIRTHDAY_CRON, () => {
    void processBirthdayMessagesJob();
  });
}
```

- [ ] **Step 6: Register crons in `index.ts`**

Inside `if (shouldRunBackgroundJobs) {`, after `require("./src/cron-jobs/rideReminderCron");`:

```ts
  require("./src/cron-jobs/messagingDispatchCron");
  require("./src/cron-jobs/messagingBirthdayCron");
```

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/modules/messaging/messagingController.ts src/modules/messaging/messagingRoute.ts \
  src/cron-jobs/messagingDispatchCron.ts src/cron-jobs/messagingBirthdayCron.ts \
  src/routes/appRouter.ts index.ts
git commit -m "feat(messaging): routes and dispatch/birthday crons"
```

---

### Task 14: Welcome hooks

**Files:**
- Modify: `src/modules/user/selfServiceController.ts` (after the `generateUserId` block, before the set-password email)
- Modify: `src/modules/visitorManagement/visitorService.ts:856` (after `prisma.visitor.create`)

- [ ] **Step 1: Self-register hook**

Add the import at the top of `selfServiceController.ts`:

```ts
import { enqueueWelcome } from "../messaging/messagingService";
```

After the `if (!isGuest) { … generateUserId … }` block, insert:

```ts
    // Admin-configured welcome (Messaging > Welcome). The set-password email
    // below is always sent: it is how the member gets into their account.
    void enqueueWelcome({ userId: user.id, isGuest });
```

- [ ] **Step 2: Visitor hook**

Add the import at the top of `visitorService.ts`:

```ts
import { enqueueWelcome } from "../messaging/messagingService";
```

Directly after `const createdVisitor = await prisma.visitor.create({ data: newVisitorData });`, insert:

```ts
    if (createdVisitor.consentToContact) {
      void enqueueWelcome({ visitorId: createdVisitor.id });
    }
```

- [ ] **Step 3: Check for an import cycle**

`messagingService` → `audience` → `community/communityQueries`. Confirm `communityQueries.ts` imports nothing from `user/` or `visitorManagement/`:

```bash
grep -n "^import" src/modules/community/communityQueries.ts
```

Expected: only `prisma`, `@prisma/client` and community-local files. If it imports user or visitor modules, copy `departmentMemberIds` into `audience.ts` instead of importing it.

- [ ] **Step 4: Type-check, test, commit**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all tests PASS.

```bash
git add src/modules/user/selfServiceController.ts src/modules/visitorManagement/visitorService.ts
git commit -m "feat(messaging): send welcome messages on app sign-up and new visitors"
```

---

### Task 15: Manual end-to-end verification

Needs a local MySQL with `DATABASE_URL` and a working `node_modules`. If the iCloud folder's deps hang, use a non-iCloud clone with `npm ci`.

- [ ] **Step 1: Migrate and start**

```bash
npx prisma migrate deploy && npx prisma generate
HUBTEL_SMS_ENABLED=false npm run dev
```

Expected: the server starts, there are no cron validation errors, and the log shows the migration `20261010120000_messaging` applied.

- [ ] **Step 2: Templates and settings** (use an admin token whose level has `Access_rights: Super_Admin`)

```bash
TOKEN=...; API=http://localhost:$PORT
curl -s -H "Authorization: Bearer $TOKEN" $API/messaging/templates | jq '.data[].key'
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"appStoreUrl":"https://apps.apple.com/app/id1","playStoreUrl":"https://play.google.com/store/apps/details?id=x","birthdaySendTime":"07:00"}' \
  $API/messaging/settings | jq .data
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"channels":{"sms":true,"email":false,"inApp":true},"body":"Hi {frist_name}"}' \
  $API/messaging/templates/WELCOME_GUEST | jq .message
```

Expected: the four keys are listed, the settings echo back, and the last call returns `"Unknown placeholder: {frist_name}"`.

- [ ] **Step 3: Welcome flow**

Enable `WELCOME_GUEST` with body `Hi {first_name}, welcome to {church_name}`. Self-register a guest via `POST /user/self-register` with `account_type: guest`. Within a minute:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/messaging/dispatches?kind=WELCOME" | jq '.data[0] | {title,status,counts}'
```

Expected: `status: "SENT"`, `counts.sms.skipped: 1` (SMS disabled), `counts.inApp.sent: 1`. The guest also still receives the set-password email.

- [ ] **Step 4: General message, scheduled then cancelled; and sent now**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Test","body":"Hello {first_name}","channels":{"inApp":true},"audience":{"scope":"PEOPLE","userIds":[<your id>]},"scheduledFor":"2030-01-01T09:00:00Z"}' \
  $API/messaging/dispatches | jq .
```

Expected: 400 "Schedule at most 90 days ahead". Retry with a time 10 minutes ahead and expect `status: "SCHEDULED"`. Then `POST /messaging/dispatches/<id>/cancel` should give `CANCELLED`. Send again without `scheduledFor` and expect an inbox item for your user within a minute.

- [ ] **Step 5: Birthday**

Set a test user's `user_info.date_of_birth` to today (any year). Enable `BIRTHDAY`, set `birthdaySendTime` to the current HH:mm, and set `last_birthday_run_date` to NULL in the DB. Within 15 minutes, `GET /messaging/dispatches?kind=BIRTHDAY` shows `Birthdays — <today>` with that user.

- [ ] **Step 6: Permission**

Use a token whose access level lacks `Messaging`. `GET /messaging/templates` should return 401 "Not authorized to view messaging".

- [ ] **Step 7: Final gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all PASS.

---

## Self-review notes (resolved)

- **Spec coverage.** Every spec section maps to a task: data model (2), placeholders (4), triggers (11, 14), birthday (5, 11, 13), general and audience (7, 11), worker (10, 13), API (13), permission (12), testing (1, 4–7, 10, 15).
- **Spec deviations, which need a spec amendment:**
  1. The set-password email at sign-up is always sent, because it carries the account link. The welcome template is sent in addition.
  2. History tables have no FK to `user` / `visitor`. A `recipient_key` column replaces the nullable unique key.
  3. v1 Messaging is church-wide, not branch-scoped.
  4. Existing access levels with `Access_rights: Super_Admin` get Messaging via migration. Nobody gets it "automatically" at runtime.
  5. The email layout reuses `buildUnifiedEmailTemplate` instead of a new `messagingTemplate.ts`.
- **Type names are consistent:** `Person`, `Channels`, `Audience`, `TemplateKey`, `RecipientRow`, `ChannelRow`, `enqueueWelcome`, `promoteDueDispatches`, `processPendingRecipients`, `refreshDispatch`, `triggerDispatchProcessing`.
