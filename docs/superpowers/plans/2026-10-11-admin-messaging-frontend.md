# Admin Messaging — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Communication → Messaging to the admin dashboard, with three tabs and two supporting pieces:
- **Welcome tab:** three template cards.
- **Birthday tab:** one template plus the upcoming birthdays.
- **General tab:** a compose / audience / schedule form and a sent-message history.
- **Settings modal:** store links and the birthday send time.
- **Live preview:** every message box shows placeholder chips and an SMS segment counter.

**Architecture:** A new `ChurchCommunication/Messaging/` folder:
- One page, `MessagingManager`, with `?tab=` synced tabs, the same pattern as `CommunityManager`.
- Small focused components with a shared `MessageComposer`.
- API calls are added to the existing `api.fetch` / `api.post` / `api.put` classes, with types in `utils/api/messaging/interfaces.ts`.
- The server is the single source of truth for placeholders and SMS segment counts, through a debounced `POST /messaging/preview`, so the GSM rules are never duplicated client-side.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, Formik (only where the repo already uses it), Radix `Modal`, `TabSelection`, `MultiSelect`, `useFetch`, `showNotification`.

**Backend contract:** `Backend/docs/superpowers/specs/2026-10-10-admin-messaging-design.md`, section API, as implemented on Backend `feat/messaging`. List endpoints return `{ data, page, limit, total, current_page, take, totalPages }`, so the dashboard's `ApiResponse.meta` is filled.

---

## Conventions an implementer must know

- **Repository.** `/Users/akwaah/Documents/GitHub/Frontend`, base branch `development`. Create `feat/messaging` from `origin/development`. This checkout lives in iCloud: untracked `* 2.tsx` / `* 2.ts` files are iCloud duplicates and must never be staged. Stage by explicit path only.
- **Gates.** There is no test runner. Before each commit run:
  - `npx tsc --noEmit -p tsconfig.json` — must exit 0 for files you touched. Pre-existing errors elsewhere: note them, don't fix.
  - `npx eslint <touched files> --max-warnings 0`
  
  If `node_modules` hangs (iCloud eviction), report it. Don't improvise.
- **API errors.** `ApiErrorHandler` already toasts errors. Success toasts use `showNotification(msg, "success")` from `@/pages/HomePage/utils`. Wrap awaited calls in `try { … } catch { /* already shown */ }`, as `ChurchMessageForm` does.
- **Data loading.** `useFetch(fn, query?, lazy?)` returns `{ data, loading, refetch }`, where `data` is `ApiResponse<T>` and the payload is `data.data`.
- **Permissions.** Pages read `canManageCurrentRoute` from `useRouteAccess()` (`@/context/RouteAccessContext`). Users without manage rights see everything read-only, with no Save/Send buttons.
- **Styling.** Use Tailwind with existing tokens (`text-primary`, `border-lightGray`, `bg-lightGray`). No new colour hexes.
- **Commits.** Messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `src/utils/accessControl.ts` (modify) | `Messaging` domain, editor metadata, `view_messaging` / `manage_messaging` |
| `src/utils/api/messaging/interfaces.ts` (create) | API types |
| `src/utils/api/apiFetch.ts`, `apiPost.ts`, `apiPut.ts` (modify) | endpoint calls |
| `src/routes/appRoutes.tsx` (modify), `ChurchCommunication/CommunicationIndexRedirect.tsx` (modify) | route + redirect order |
| `ChurchCommunication/Messaging/MessagingManager.tsx` | page shell, tabs, settings button, unsaved-changes guard |
| `Messaging/useMessagePreview.ts` | debounced server preview hook |
| `Messaging/components/MessageComposer.tsx` | textarea + placeholder chips + counter + unknown-token errors |
| `Messaging/components/ChannelPicker.tsx` | SMS / Email / In-app checkboxes |
| `Messaging/components/MessagePreviewPanel.tsx` | SMS bubble + email card |
| `Messaging/components/MessagingSettingsModal.tsx` | store links, birthday time |
| `Messaging/components/TemplateCard.tsx` | one automatic template (welcome or birthday) |
| `Messaging/components/WelcomeTab.tsx`, `BirthdayTab.tsx` | tab bodies |
| `Messaging/components/AudiencePicker.tsx` | church / departments / people + toggles + live count |
| `Messaging/components/GeneralTab.tsx` | compose form + confirm + history |
| `Messaging/components/DispatchHistory.tsx`, `DispatchDetail.tsx` | history list, recipients drawer with cancel / retry |

All `Messaging/...` paths are under `src/pages/HomePage/pages/ChurchCommunication/`.

---

### Task 1: Branch and permission domain

**Files:**
- Modify: `src/utils/accessControl.ts` (`CANONICAL_PERMISSION_DOMAINS` ~line 13, aliases ~line 107, `ACCESS_LEVEL_DOMAINS` after the Promotions entry ~line 266, permission-key map ~line 383)

- [ ] **Step 1: Branch**

```bash
cd /Users/akwaah/Documents/GitHub/Frontend
git status --short | grep -v ' 2\.' ; git fetch origin development
git switch -c feat/messaging origin/development
```

Expected: no tracked modifications listed, then `Switched to a new branch 'feat/messaging'`.

If the working tree has tracked changes, stop and report: they belong to the current branch (`feat/community-rich-text`). If `git fetch` fails with "bad object refs/... 2", move `.git` entries named `* [0-9]` (excluding `objects/`) into a backup folder in the scratchpad and retry.

- [ ] **Step 2: Domain list.** Append `"Messaging",` after `"Promotions",` in `CANONICAL_PERMISSION_DOMAINS`.

- [ ] **Step 3: Aliases.** After `Promotions: ["Promotions", "Promotion"],`, add:

```ts
  Messaging: ["Messaging"],
```

Add **no** `DOMAIN_FALLBACKS` entry. The backend has none either: bulk SMS costs money and is never inherited from Community. The two tables must agree, or the UI shows a page the API refuses.

- [ ] **Step 4: Editor metadata.** After the `Promotions` object in `ACCESS_LEVEL_DOMAINS`, add:

```ts
  {
    key: "Messaging",
    label: "Messaging",
    description: "Welcome, birthday and church-wide SMS, email and in-app messages",
    group: "Engagement",
    required: false,
  },
```

- [ ] **Step 5: Permission keys.** After `manage_promotions: { domain: "Promotions", action: "manage" },`, add:

```ts
  view_messaging: { domain: "Messaging", action: "view" },
  manage_messaging: { domain: "Messaging", action: "manage" },
```

- [ ] **Step 6: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/utils/accessControl.ts --max-warnings 0
git add src/utils/accessControl.ts
git commit -m "feat(messaging): Messaging permission domain"
```

---

### Task 2: API types and calls

**Files:**
- Create: `src/utils/api/messaging/interfaces.ts`
- Modify: `src/utils/api/apiFetch.ts`, `apiPost.ts`, `apiPut.ts`

- [ ] **Step 1: Types**

```ts
export type MessageTemplateKey =
  | "WELCOME_MEMBER"
  | "WELCOME_GUEST"
  | "WELCOME_VISITOR"
  | "BIRTHDAY";

export type PlaceholderKind = "WELCOME" | "BIRTHDAY" | "GENERAL";

export interface MessageChannels {
  sms: boolean;
  email: boolean;
  inApp: boolean;
}

export interface MessageTemplate {
  key: MessageTemplateKey;
  enabled: boolean;
  channels: MessageChannels;
  emailSubject: string | null;
  body: string;
  includeAppLink: boolean;
  updatedAt: string;
}

export interface UpdateMessageTemplateDto {
  enabled: boolean;
  channels: MessageChannels;
  emailSubject: string | null;
  body: string;
  includeAppLink: boolean;
}

export interface MessagingSettings {
  app_store_url: string | null;
  play_store_url: string | null;
  birthday_send_time: string;
  timezone: string;
  last_birthday_run_date: string | null;
}

export interface UpdateMessagingSettingsDto {
  appStoreUrl: string;
  playStoreUrl: string;
  birthdaySendTime: string;
}

export interface PlaceholderInfo {
  token: string;
  description: string;
  kinds: PlaceholderKind[];
}

export interface MessagePreviewRequest {
  body: string;
  subject?: string | null;
  kind: PlaceholderKind;
  includeAppLink?: boolean;
}

export interface MessagePreview {
  body: string;
  subject: string | null;
  sms: { length: number; segments: number; unicode: boolean };
  unknownPlaceholders: string[];
}

export type AudienceScope = "CHURCH" | "DEPARTMENTS" | "PEOPLE";

export interface MessageAudience {
  scope: AudienceScope;
  departmentIds: number[];
  userIds: number[];
  includeGuests: boolean;
  includeVisitors: boolean;
}

export interface AudienceCount {
  people: number;
  sms: number;
  email: number;
  inApp: number;
}

export interface ChannelCounts {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export type DispatchStatus = "SCHEDULED" | "QUEUED" | "SENT" | "CANCELLED" | "FAILED";
export type DispatchKind = "WELCOME" | "BIRTHDAY" | "GENERAL";

export interface MessageDispatch {
  id: number;
  kind: DispatchKind;
  templateKey: MessageTemplateKey | null;
  title: string;
  body: string;
  emailSubject: string | null;
  channels: MessageChannels;
  audience: MessageAudience | null;
  status: DispatchStatus;
  scheduledFor: string | null;
  error: string | null;
  counts: {
    sms: ChannelCounts;
    email: ChannelCounts;
    inApp: ChannelCounts;
    people?: number;
  } | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface CreateGeneralMessageDto {
  title: string;
  body: string;
  emailSubject: string | null;
  channels: MessageChannels;
  audience: MessageAudience;
  scheduledFor?: string;
}

export type RecipientChannel = "SMS" | "EMAIL" | "IN_APP";
export type RecipientStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";

export interface MessageRecipient {
  id: number;
  channel: RecipientChannel;
  recipient_name: string;
  address: string | null;
  status: RecipientStatus;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  user_id: number | null;
  visitor_id: number | null;
}

export type TemplateStats = Record<
  MessageTemplateKey,
  { sent: number; failed: number; skipped: number }
>;

export interface UpcomingBirthday {
  userId: number;
  name: string;
  date: string;
  age: number | null;
}
```

- [ ] **Step 2: Fetch calls.** In `apiFetch.ts`, import the types:

```ts
import type {
  MessageDispatch,
  MessageRecipient,
  MessageTemplate,
  MessagingSettings,
  PlaceholderInfo,
  TemplateStats,
  UpcomingBirthday,
} from "./messaging/interfaces";
```

Then add these methods to `ApiCalls`, next to `fetchPromotions`:

```ts
  // Messaging
  fetchMessageTemplates = (): Promise<ApiResponse<MessageTemplate[]>> =>
    this.fetchFromApi("messaging/templates");

  fetchMessagingSettings = (): Promise<ApiResponse<MessagingSettings>> =>
    this.fetchFromApi("messaging/settings");

  fetchMessagePlaceholders = (
    query?: QueryType
  ): Promise<ApiResponse<PlaceholderInfo[]>> =>
    this.fetchFromApi("messaging/placeholders", query);

  fetchUpcomingBirthdays = (
    query?: QueryType
  ): Promise<ApiResponse<UpcomingBirthday[]>> =>
    this.fetchFromApi("messaging/birthdays/upcoming", query);

  fetchMessagingStats = (
    query?: QueryType
  ): Promise<ApiResponse<TemplateStats>> =>
    this.fetchFromApi("messaging/stats", query);

  fetchMessageDispatches = (
    query?: QueryType
  ): Promise<ApiResponse<MessageDispatch[]>> =>
    this.fetchFromApi("messaging/dispatches", query);

  fetchMessageRecipients = (
    id: number,
    query?: QueryType
  ): Promise<ApiResponse<MessageRecipient[]>> =>
    this.fetchFromApi(`messaging/dispatches/${id}/recipients`, query);
```

- [ ] **Step 3: Post calls.** In `apiPost.ts`, import the types:

```ts
import type {
  AudienceCount,
  CreateGeneralMessageDto,
  MessageAudience,
  MessageDispatch,
  MessagePreview,
  MessagePreviewRequest,
} from "./messaging/interfaces";
```

Then add these methods to `ApiCreationCalls`, after `createCommunityPost`:

```ts
  // Messaging
  previewMessage = (
    payload: MessagePreviewRequest
  ): Promise<ApiResponse<MessagePreview>> =>
    this.postToApi("messaging/preview", payload);

  countMessageAudience = (payload: {
    audience: MessageAudience;
  }): Promise<ApiResponse<AudienceCount>> =>
    this.postToApi("messaging/audience/count", payload);

  createGeneralMessage = (
    payload: CreateGeneralMessageDto
  ): Promise<ApiResponse<MessageDispatch>> =>
    this.postToApi("messaging/dispatches", payload);

  cancelMessageDispatch = (id: number): Promise<ApiResponse<MessageDispatch>> =>
    this.postToApi(`messaging/dispatches/${id}/cancel`, {});

  retryFailedMessages = (
    id: number
  ): Promise<ApiResponse<{ retried: number }>> =>
    this.postToApi(`messaging/dispatches/${id}/retry-failed`, {});
```

- [ ] **Step 4: Put calls.** In `apiPut.ts`, import the types:

```ts
import type {
  MessageTemplate,
  MessageTemplateKey,
  MessagingSettings,
  UpdateMessageTemplateDto,
  UpdateMessagingSettingsDto,
} from "./messaging/interfaces";
```

Then add these methods to `ApiUpdateCalls`, after `updatePromotion`:

```ts
  // Messaging
  updateMessageTemplate = (
    key: MessageTemplateKey,
    payload: UpdateMessageTemplateDto
  ): Promise<ApiResponse<MessageTemplate>> =>
    this.apiExecution.updateData(`messaging/templates/${key}`, payload);

  updateMessagingSettings = (
    payload: UpdateMessagingSettingsDto
  ): Promise<ApiResponse<MessagingSettings>> =>
    this.apiExecution.updateData("messaging/settings", payload);
```

If `updateData`'s payload parameter is typed `Record<string, unknown>`, pass `{ ...payload }`.

- [ ] **Step 5: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/utils/api/messaging/interfaces.ts src/utils/api/apiFetch.ts src/utils/api/apiPost.ts src/utils/api/apiPut.ts --max-warnings 0
git add src/utils/api/messaging/interfaces.ts src/utils/api/apiFetch.ts src/utils/api/apiPost.ts src/utils/api/apiPut.ts
git commit -m "feat(messaging): API types and calls"
```

---

### Task 3: Preview hook, composer, channel picker, preview panel

**Files:**
- Create: `Messaging/useMessagePreview.ts`, `Messaging/components/MessageComposer.tsx`, `ChannelPicker.tsx`, `MessagePreviewPanel.tsx`

- [ ] **Step 1: `useMessagePreview.ts`**

```ts
import { useEffect, useState } from "react";
import { api } from "@/utils/api/apiCalls";
import type {
  MessagePreview,
  PlaceholderKind,
} from "@/utils/api/messaging/interfaces";

const DEBOUNCE_MS = 400;

/** Server-rendered preview of a message: text with placeholders filled for a
 *  sample person, SMS length/segments, and unknown placeholders. The server
 *  owns the rules so the dashboard never drifts from what is actually sent. */
export const useMessagePreview = (args: {
  body: string;
  subject?: string | null;
  kind: PlaceholderKind;
  includeAppLink?: boolean;
}) => {
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const { body, subject, kind, includeAppLink } = args;

  useEffect(() => {
    if (!body.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await api.post.previewMessage({
          body,
          subject: subject ?? null,
          kind,
          includeAppLink,
        });
        if (!cancelled) setPreview(response.data);
      } catch {
        // Preview is best-effort; save-time validation is authoritative.
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, subject, kind, includeAppLink]);

  return preview;
};
```

- [ ] **Step 2: `MessageComposer.tsx`**

```tsx
import { useRef } from "react";
import { api } from "@/utils/api/apiCalls";
import { useFetch } from "@/CustomHooks/useFetch";
import type {
  MessagePreview,
  PlaceholderKind,
} from "@/utils/api/messaging/interfaces";

interface MessageComposerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  kind: PlaceholderKind;
  preview: MessagePreview | null;
  /** Show the SMS counter (only when SMS is a chosen channel). */
  showSmsCounter: boolean;
  disabled?: boolean;
  rows?: number;
}

/** Message textarea with click-to-insert placeholder chips, a live SMS
 *  counter and inline errors for placeholders the server does not know. */
export const MessageComposer = ({
  id,
  label,
  value,
  onChange,
  kind,
  preview,
  showSmsCounter,
  disabled,
  rows = 5,
}: MessageComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data } = useFetch(api.fetch.fetchMessagePlaceholders, { kind });
  const placeholders = data?.data ?? [];

  const insert = (token: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const unknown = preview?.unknownPlaceholders ?? [];

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-primary">
        {label}
      </label>
      {!disabled && placeholders.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Insert placeholder">
          {placeholders.map((p) => (
            <button
              key={p.token}
              type="button"
              title={p.description}
              onClick={() => insert(p.token)}
              className="rounded-full border border-lightGray px-3 py-1 text-xs text-primary hover:bg-lightGray"
            >
              {p.token}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={id}
        ref={textareaRef}
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-lightGray p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-lightGray/40"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-red-600" role="alert">
          {unknown.length > 0 &&
            `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`}
        </span>
        {showSmsCounter && preview && (
          <span className="text-gray-500">
            {preview.sms.length} chars · {preview.sms.segments} SMS
            {preview.sms.unicode ? " (special characters)" : ""}
          </span>
        )}
      </div>
    </div>
  );
};
```

If `text-red-600` / `text-gray-500` aren't used anywhere in the repo, swap in the repo's existing error / muted text classes. Grep `FormikInputDiv` / `InputDiv` for the error class it uses.

- [ ] **Step 3: `ChannelPicker.tsx`**

```tsx
import type { MessageChannels } from "@/utils/api/messaging/interfaces";

const OPTIONS: { key: keyof MessageChannels; label: string; hint: string }[] = [
  { key: "sms", label: "SMS", hint: "Text message to their phone" },
  { key: "email", label: "Email", hint: "Email to their address" },
  { key: "inApp", label: "In-app", hint: "App inbox and push notification" },
];

interface ChannelPickerProps {
  value: MessageChannels;
  onChange: (value: MessageChannels) => void;
  disabled?: boolean;
  /** Channels that cannot reach this audience (e.g. in-app for visitors). */
  unavailable?: Partial<Record<keyof MessageChannels, string>>;
}

export const ChannelPicker = ({ value, onChange, disabled, unavailable }: ChannelPickerProps) => (
  <fieldset className="space-y-2">
    <legend className="text-sm font-medium text-primary">Send by</legend>
    <div className="flex flex-wrap gap-4">
      {OPTIONS.map((option) => (
        <label key={option.key} className="flex items-start gap-2 text-sm" title={unavailable?.[option.key] ?? option.hint}>
          <input
            type="checkbox"
            checked={value[option.key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [option.key]: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            {option.label}
            {unavailable?.[option.key] && value[option.key] && (
              <span className="block text-xs text-gray-500">{unavailable[option.key]}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);
```

- [ ] **Step 4: `MessagePreviewPanel.tsx`**

```tsx
import type { MessageChannels, MessagePreview } from "@/utils/api/messaging/interfaces";

interface MessagePreviewPanelProps {
  preview: MessagePreview | null;
  channels: MessageChannels;
}

/** How the message reads for a sample person ("Ama Mensah"). */
export const MessagePreviewPanel = ({ preview, channels }: MessagePreviewPanelProps) => {
  if (!preview) {
    return <p className="text-sm text-gray-500">Type a message to see a preview.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">Preview for a sample member</p>
      {(channels.sms || channels.inApp) && (
        <div className="max-w-sm whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-lightGray px-4 py-3 text-sm">
          {preview.body}
        </div>
      )}
      {channels.email && (
        <div className="rounded-lg border border-lightGray">
          <div className="border-b border-lightGray px-4 py-2 text-sm font-medium">
            {preview.subject || "(no subject)"}
          </div>
          <div className="whitespace-pre-wrap px-4 py-3 text-sm">{preview.body}</div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication/Messaging --max-warnings 0
git add src/pages/HomePage/pages/ChurchCommunication/Messaging/useMessagePreview.ts \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/MessageComposer.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/ChannelPicker.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/MessagePreviewPanel.tsx
git commit -m "feat(messaging): composer with placeholder chips, channel picker and preview"
```

---

### Task 4: Settings modal and template card

**Files:**
- Create: `Messaging/components/MessagingSettingsModal.tsx`, `Messaging/components/TemplateCard.tsx`

- [ ] **Step 1: `MessagingSettingsModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components";
import { FormHeader } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { api } from "@/utils/api/apiCalls";
import { showNotification } from "@/pages/HomePage/utils";
import type { MessagingSettings } from "@/utils/api/messaging/interfaces";

interface MessagingSettingsModalProps {
  open: boolean;
  settings: MessagingSettings | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const MessagingSettingsModal = ({ open, settings, canManage, onClose, onSaved }: MessagingSettingsModalProps) => {
  const [appStoreUrl, setAppStoreUrl] = useState("");
  const [playStoreUrl, setPlayStoreUrl] = useState("");
  const [birthdaySendTime, setBirthdaySendTime] = useState("07:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAppStoreUrl(settings?.app_store_url ?? "");
    setPlayStoreUrl(settings?.play_store_url ?? "");
    setBirthdaySendTime(settings?.birthday_send_time ?? "07:00");
  }, [open, settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put.updateMessagingSettings({ appStoreUrl, playStoreUrl, birthdaySendTime });
      showNotification("Messaging settings saved", "success");
      onSaved();
      onClose();
    } catch {
      // ApiErrorHandler has already shown the error.
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full rounded-lg border border-lightGray p-2 text-sm disabled:bg-lightGray/40";

  return (
    <Modal open={open} onClose={onClose} title="Messaging settings">
      <div className="w-[min(92vw,520px)]">
        <FormHeader>
          <p className="text-lg font-semibold">Messaging settings</p>
          <p className="text-sm text-white">App download links and when birthday messages go out.</p>
        </FormHeader>
        <div className="space-y-4 px-6 py-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-primary">App Store link (iPhone)</span>
            <input className={input} type="url" placeholder="https://apps.apple.com/…" value={appStoreUrl} disabled={!canManage} onChange={(e) => setAppStoreUrl(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-primary">Play Store link (Android)</span>
            <input className={input} type="url" placeholder="https://play.google.com/store/apps/…" value={playStoreUrl} disabled={!canManage} onChange={(e) => setPlayStoreUrl(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-primary">Birthday messages send at</span>
            <input className={input} type="time" value={birthdaySendTime} disabled={!canManage} onChange={(e) => setBirthdaySendTime(e.target.value)} />
            <span className="block text-xs text-gray-500">Church time ({settings?.timezone ?? "Africa/Accra"})</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-lightGray px-6 py-3">
          <Button value="Close" variant="secondary" onClick={onClose} />
          {canManage && <Button value="Save" variant="primary" loading={saving} disabled={saving} onClick={save} />}
        </div>
      </div>
    </Modal>
  );
};
```

- [ ] **Step 2: `TemplateCard.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components";
import { api } from "@/utils/api/apiCalls";
import { showNotification } from "@/pages/HomePage/utils";
import type {
  MessageChannels,
  MessageTemplate,
  PlaceholderKind,
} from "@/utils/api/messaging/interfaces";
import { useMessagePreview } from "../useMessagePreview";
import { ChannelPicker } from "./ChannelPicker";
import { MessageComposer } from "./MessageComposer";
import { MessagePreviewPanel } from "./MessagePreviewPanel";

interface TemplateCardProps {
  template: MessageTemplate;
  title: string;
  description: string;
  canManage: boolean;
  stats?: { sent: number; failed: number; skipped: number };
  /** Note shown under the channels (e.g. the always-sent set-password email). */
  channelNote?: string;
  /** Visitor welcome only. */
  allowAppLink?: boolean;
  storeLinksMissing?: boolean;
  onOpenSettings?: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  onSaved: () => void;
}

const sameChannels = (a: MessageChannels, b: MessageChannels) =>
  a.sms === b.sms && a.email === b.email && a.inApp === b.inApp;

export const TemplateCard = ({
  template,
  title,
  description,
  canManage,
  stats,
  channelNote,
  allowAppLink,
  storeLinksMissing,
  onOpenSettings,
  onDirtyChange,
  onSaved,
}: TemplateCardProps) => {
  const [enabled, setEnabled] = useState(template.enabled);
  const [channels, setChannels] = useState(template.channels);
  const [subject, setSubject] = useState(template.emailSubject ?? "");
  const [body, setBody] = useState(template.body);
  const [includeAppLink, setIncludeAppLink] = useState(template.includeAppLink);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(template.enabled);
    setChannels(template.channels);
    setSubject(template.emailSubject ?? "");
    setBody(template.body);
    setIncludeAppLink(template.includeAppLink);
  }, [template]);

  const dirty = useMemo(
    () =>
      enabled !== template.enabled ||
      !sameChannels(channels, template.channels) ||
      subject !== (template.emailSubject ?? "") ||
      body !== template.body ||
      includeAppLink !== template.includeAppLink,
    [enabled, channels, subject, body, includeAppLink, template]
  );

  useEffect(() => {
    onDirtyChange(template.key, dirty);
  }, [dirty, onDirtyChange, template.key]);

  const kind: PlaceholderKind = template.key === "BIRTHDAY" ? "BIRTHDAY" : "WELCOME";
  const preview = useMessagePreview({
    body,
    subject: channels.email ? subject : null,
    kind,
    includeAppLink: allowAppLink && includeAppLink,
  });

  const save = async () => {
    setSaving(true);
    try {
      await api.put.updateMessageTemplate(template.key, {
        enabled,
        channels,
        emailSubject: subject.trim() || null,
        body,
        includeAppLink: Boolean(allowAppLink && includeAppLink),
      });
      showNotification(`${title} saved`, "success");
      onSaved();
    } catch {
      // ApiErrorHandler has already shown the error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-lightGray bg-white p-5" aria-labelledby={`${template.key}-title`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${template.key}-title`} className="text-base font-semibold text-primary">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />
          {enabled ? "On" : "Off"}
        </label>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ChannelPicker
            value={channels}
            onChange={setChannels}
            disabled={!canManage}
            unavailable={allowAppLink ? { inApp: "Visitors have no app account, so in-app is skipped." } : undefined}
          />
          {channelNote && <p className="text-xs text-gray-500">{channelNote}</p>}
          {channels.email && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-primary">Email subject</span>
              <input
                className="w-full rounded-lg border border-lightGray p-2 text-sm disabled:bg-lightGray/40"
                value={subject}
                maxLength={150}
                disabled={!canManage}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          )}
          <MessageComposer
            id={`${template.key}-body`}
            label="Message"
            value={body}
            onChange={setBody}
            kind={kind}
            preview={preview}
            showSmsCounter={channels.sms}
            disabled={!canManage}
          />
          {allowAppLink && (
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeAppLink} disabled={!canManage} onChange={(e) => setIncludeAppLink(e.target.checked)} />
                Include app download link
              </label>
              {includeAppLink && storeLinksMissing && (
                <p className="text-xs text-red-600">
                  No store links yet.{" "}
                  <button type="button" className="underline" onClick={onOpenSettings}>Add them in Messaging settings</button>
                </p>
              )}
            </div>
          )}
        </div>
        <MessagePreviewPanel preview={preview} channels={channels} />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-lightGray pt-3">
        <span className="text-xs text-gray-500">
          {stats ? `Last 30 days: ${stats.sent} sent · ${stats.failed} failed · ${stats.skipped} skipped` : ""}
        </span>
        {canManage && <Button value="Save" variant="primary" disabled={!dirty || saving} loading={saving} onClick={save} />}
      </footer>
    </section>
  );
};
```

- [ ] **Step 3: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication/Messaging --max-warnings 0
git add src/pages/HomePage/pages/ChurchCommunication/Messaging/components/MessagingSettingsModal.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/TemplateCard.tsx
git commit -m "feat(messaging): settings modal and template card"
```

---

### Task 5: Welcome and Birthday tabs

**Files:**
- Create: `Messaging/components/WelcomeTab.tsx`, `Messaging/components/BirthdayTab.tsx`

- [ ] **Step 1: `WelcomeTab.tsx`**

```tsx
import type {
  MessageTemplate,
  MessagingSettings,
  TemplateStats,
} from "@/utils/api/messaging/interfaces";
import { TemplateCard } from "./TemplateCard";

const SET_PASSWORD_NOTE =
  "New app sign-ups always also get the account email with their set-password link.";

interface WelcomeTabProps {
  templates: MessageTemplate[];
  settings: MessagingSettings | null;
  stats: TemplateStats | null;
  canManage: boolean;
  onOpenSettings: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  onSaved: () => void;
}

export const WelcomeTab = ({ templates, settings, stats, canManage, onOpenSettings, onDirtyChange, onSaved }: WelcomeTabProps) => {
  const byKey = Object.fromEntries(templates.map((t) => [t.key, t]));
  const storeLinksMissing = !settings?.app_store_url && !settings?.play_store_url;
  const common = { canManage, onDirtyChange, onSaved };

  return (
    <div className="space-y-6">
      {byKey.WELCOME_MEMBER && (
        <TemplateCard {...common} template={byKey.WELCOME_MEMBER} stats={stats?.WELCOME_MEMBER}
          title="Member sign-up" description="Sent when someone joins as a member in the mobile app."
          channelNote={SET_PASSWORD_NOTE} />
      )}
      {byKey.WELCOME_GUEST && (
        <TemplateCard {...common} template={byKey.WELCOME_GUEST} stats={stats?.WELCOME_GUEST}
          title="Guest sign-up" description="Sent when someone joins as a guest in the mobile app."
          channelNote={SET_PASSWORD_NOTE} />
      )}
      {byKey.WELCOME_VISITOR && (
        <TemplateCard {...common} template={byKey.WELCOME_VISITOR} stats={stats?.WELCOME_VISITOR}
          title="Visitor added" description="Sent when a visitor who agreed to be contacted is added."
          allowAppLink storeLinksMissing={storeLinksMissing} onOpenSettings={onOpenSettings} />
      )}
    </div>
  );
};
```

- [ ] **Step 2: `BirthdayTab.tsx`**

```tsx
import { api } from "@/utils/api/apiCalls";
import { useFetch } from "@/CustomHooks/useFetch";
import type {
  MessageTemplate,
  MessagingSettings,
  TemplateStats,
} from "@/utils/api/messaging/interfaces";
import { TemplateCard } from "./TemplateCard";

interface BirthdayTabProps {
  template: MessageTemplate | undefined;
  settings: MessagingSettings | null;
  stats: TemplateStats | null;
  canManage: boolean;
  onOpenSettings: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  onSaved: () => void;
}

const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const BirthdayTab = ({ template, settings, stats, canManage, onOpenSettings, onDirtyChange, onSaved }: BirthdayTabProps) => {
  const { data } = useFetch(api.fetch.fetchUpcomingBirthdays, { days: 7 });
  const upcoming = data?.data ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Sends daily at <strong>{settings?.birthday_send_time ?? "07:00"}</strong> ({settings?.timezone ?? "Africa/Accra"}) to members and guests with a date of birth on file.{" "}
        <button type="button" className="text-primary underline" onClick={onOpenSettings}>Change time</button>
      </p>
      {template && (
        <TemplateCard template={template} stats={stats?.BIRTHDAY} canManage={canManage}
          title="Birthday message" description="People born on 29 February get theirs on 28 February in non-leap years."
          onDirtyChange={onDirtyChange} onSaved={onSaved} />
      )}
      <section className="rounded-xl border border-lightGray bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-primary">Upcoming birthdays (next 7 days)</h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500">No birthdays in the next 7 days.</p>
        ) : (
          <ul className="divide-y divide-lightGray text-sm">
            {upcoming.map((b) => (
              <li key={`${b.userId}-${b.date}`} className="flex justify-between py-2">
                <span>{b.name}</span>
                <span className="text-gray-500">{formatDay(b.date)}{b.age ? ` · turning ${b.age}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
```

- [ ] **Step 3: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication/Messaging --max-warnings 0
git add src/pages/HomePage/pages/ChurchCommunication/Messaging/components/WelcomeTab.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/BirthdayTab.tsx
git commit -m "feat(messaging): welcome and birthday tabs"
```

---

### Task 6: Audience picker and General tab (compose + confirm)

**Files:**
- Create: `Messaging/components/AudiencePicker.tsx`, `Messaging/components/GeneralTab.tsx`

- [ ] **Step 1: `AudiencePicker.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import Multiselect from "@/components/MultiSelect";
import { api } from "@/utils/api/apiCalls";
import { useFetch } from "@/CustomHooks/useFetch";
import { useStore } from "@/store/useStore";
import type {
  AudienceCount,
  AudienceScope,
  MessageAudience,
} from "@/utils/api/messaging/interfaces";

const SCOPES: { value: AudienceScope; label: string }[] = [
  { value: "CHURCH", label: "Whole church" },
  { value: "DEPARTMENTS", label: "Departments" },
  { value: "PEOPLE", label: "Specific people" },
];

export const emptyAudience = (): MessageAudience => ({
  scope: "CHURCH",
  departmentIds: [],
  userIds: [],
  includeGuests: false,
  includeVisitors: false,
});

export const isAudienceComplete = (a: MessageAudience) =>
  a.scope === "CHURCH" ||
  (a.scope === "DEPARTMENTS" && a.departmentIds.length > 0) ||
  (a.scope === "PEOPLE" && a.userIds.length > 0);

interface AudiencePickerProps {
  value: MessageAudience;
  onChange: (value: MessageAudience) => void;
  onCount: (count: AudienceCount | null) => void;
  count: AudienceCount | null;
}

export const AudiencePicker = ({ value, onChange, onCount, count }: AudiencePickerProps) => {
  const { data: departmentsData } = useFetch(api.fetch.fetchDepartments);
  const membersOptions = useStore((s) => s.membersOptions);
  const [counting, setCounting] = useState(false);

  const departmentOptions = useMemo(
    () => (departmentsData?.data ?? []).map((d) => ({ label: d.name, value: String(d.id) })),
    [departmentsData]
  );

  useEffect(() => {
    if (!isAudienceComplete(value)) {
      onCount(null);
      return;
    }
    let cancelled = false;
    setCounting(true);
    const timer = setTimeout(async () => {
      try {
        const response = await api.post.countMessageAudience({ audience: value });
        if (!cancelled) onCount(response.data);
      } catch {
        if (!cancelled) onCount(null);
      } finally {
        if (!cancelled) setCounting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, onCount]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-primary">Send to</legend>
      <div className="inline-flex rounded-lg border border-lightGray p-1" role="radiogroup">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={value.scope === s.value}
            onClick={() => onChange({ ...emptyAudience(), scope: s.value })}
            className={`rounded-md px-3 py-1.5 text-sm ${value.scope === s.value ? "bg-primary text-white" : "text-primary"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {value.scope === "CHURCH" && (
        <div className="space-y-1 text-sm">
          <p className="text-gray-500">All active members.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.includeGuests} onChange={(e) => onChange({ ...value, includeGuests: e.target.checked })} />
            Include guests
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.includeVisitors} onChange={(e) => onChange({ ...value, includeVisitors: e.target.checked })} />
            Include visitors who agreed to be contacted
          </label>
        </div>
      )}
      {value.scope === "DEPARTMENTS" && (
        <Multiselect
          options={departmentOptions}
          selectedValues={value.departmentIds.map(String)}
          onChange={(ids) => onChange({ ...value, departmentIds: ids.map(Number) })}
          placeholder="Choose departments"
        />
      )}
      {value.scope === "PEOPLE" && (
        <Multiselect
          options={membersOptions}
          selectedValues={value.userIds.map(String)}
          onChange={(ids) => onChange({ ...value, userIds: ids.map(Number) })}
          placeholder="Search members"
        />
      )}

      <p className="text-sm text-gray-600" aria-live="polite">
        {counting
          ? "Counting…"
          : count
            ? `${count.people} people · ${count.sms} with a phone · ${count.email} with an email · ${count.inApp} on the app`
            : ""}
      </p>
    </fieldset>
  );
};
```

Before writing, check:
- the `MultiSelect` default-export name and path (`@/components/MultiSelect`);
- where `useStore` lives and the `membersOptions` shape (`{ label, value: string }[]`). Grep `useStore(` in `HomePage.tsx`.

Adapt the imports to what you find.

- [ ] **Step 2: `GeneralTab.tsx`**

```tsx
import { useCallback, useState } from "react";
import { Button } from "@/components";
import { Modal } from "@/components/Modal";
import { api } from "@/utils/api/apiCalls";
import { showNotification } from "@/pages/HomePage/utils";
import type {
  AudienceCount,
  MessageAudience,
  MessageChannels,
} from "@/utils/api/messaging/interfaces";
import { useMessagePreview } from "../useMessagePreview";
import { AudiencePicker, emptyAudience, isAudienceComplete } from "./AudiencePicker";
import { ChannelPicker } from "./ChannelPicker";
import { DispatchHistory } from "./DispatchHistory";
import { MessageComposer } from "./MessageComposer";
import { MessagePreviewPanel } from "./MessagePreviewPanel";

const NO_CHANNELS: MessageChannels = { sms: false, email: false, inApp: true };

/** Earliest selectable schedule time: now + 5 minutes, as a local datetime-local value. */
const minScheduleValue = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const GeneralTab = ({ canManage }: { canManage: boolean }) => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [channels, setChannels] = useState<MessageChannels>(NO_CHANNELS);
  const [audience, setAudience] = useState<MessageAudience>(emptyAudience());
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const onCount = useCallback((c: AudienceCount | null) => setCount(c), []);
  const preview = useMessagePreview({ body, subject: channels.email ? subject : null, kind: "GENERAL" });

  const hasChannel = channels.sms || channels.email || channels.inApp;
  const ready =
    title.trim() &&
    body.trim() &&
    hasChannel &&
    (!channels.email || subject.trim()) &&
    isAudienceComplete(audience) &&
    (when === "now" || scheduledFor) &&
    !(preview?.unknownPlaceholders.length);

  const reset = () => {
    setTitle("");
    setBody("");
    setSubject("");
    setChannels(NO_CHANNELS);
    setAudience(emptyAudience());
    setWhen("now");
    setScheduledFor("");
  };

  const send = async () => {
    setSending(true);
    try {
      await api.post.createGeneralMessage({
        title: title.trim(),
        body,
        emailSubject: channels.email ? subject.trim() : null,
        channels,
        audience,
        ...(when === "later" ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
      });
      showNotification(when === "later" ? "Message scheduled" : "Message is sending", "success");
      setConfirmOpen(false);
      reset();
      setHistoryKey((k) => k + 1);
    } catch {
      // ApiErrorHandler has already shown the error.
    } finally {
      setSending(false);
    }
  };

  const reach = count
    ? [
        `${count.people} people`,
        channels.sms && `${count.sms} SMS`,
        channels.email && `${count.email} email`,
        channels.inApp && `${count.inApp} in-app`,
      ].filter(Boolean).join(" · ")
    : "";

  const input = "w-full rounded-lg border border-lightGray p-2 text-sm";

  return (
    <div className="space-y-8">
      {canManage && (
        <section className="rounded-xl border border-lightGray bg-white p-5">
          <h3 className="mb-4 text-base font-semibold text-primary">New message</h3>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-primary">Title (only admins see this)</span>
                <input className={input} value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday service moved to 9am" />
              </label>
              <AudiencePicker value={audience} onChange={setAudience} onCount={onCount} count={count} />
              <ChannelPicker value={channels} onChange={setChannels} />
              {channels.email && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-primary">Email subject</span>
                  <input className={input} value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
                </label>
              )}
              <MessageComposer id="general-body" label="Message" value={body} onChange={setBody} kind="GENERAL" preview={preview} showSmsCounter={channels.sms} />
              <fieldset className="space-y-2 text-sm">
                <legend className="font-medium text-primary">When</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Send now
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
                </label>
                {when === "later" && (
                  <input type="datetime-local" className={input} min={minScheduleValue()} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                )}
              </fieldset>
              <div className="flex justify-end">
                <Button value={when === "later" ? "Schedule…" : "Send…"} variant="primary" disabled={!ready} onClick={() => setConfirmOpen(true)} />
              </div>
            </div>
            <MessagePreviewPanel preview={preview} channels={channels} />
          </div>
        </section>
      )}

      <DispatchHistory refreshKey={historyKey} canManage={canManage} />

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm message">
        <div className="w-[min(92vw,440px)] space-y-4 p-6">
          <p className="text-lg font-semibold text-primary">{when === "later" ? "Schedule this message?" : "Send this message now?"}</p>
          <p className="text-sm">{reach || "Counting recipients…"}</p>
          {when === "later" && scheduledFor && (
            <p className="text-sm text-gray-600">Goes out {new Date(scheduledFor).toLocaleString()}.</p>
          )}
          {channels.sms && <p className="text-xs text-gray-500">SMS messages are charged per message.</p>}
          <div className="flex justify-end gap-2">
            <Button value="Back" variant="secondary" onClick={() => setConfirmOpen(false)} />
            <Button value={when === "later" ? "Schedule" : "Send"} variant="primary" loading={sending} disabled={sending} onClick={send} />
          </div>
        </div>
      </Modal>
    </div>
  );
};
```

- [ ] **Step 3: Check** (this task's commit waits for Task 7, because `GeneralTab` imports `DispatchHistory`)

```bash
npx eslint src/pages/HomePage/pages/ChurchCommunication/Messaging/components/AudiencePicker.tsx --max-warnings 0
```

---

### Task 7: History and detail

**Files:**
- Create: `Messaging/components/DispatchHistory.tsx`, `Messaging/components/DispatchDetail.tsx`

- [ ] **Step 1: `DispatchHistory.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "@/utils/api/apiCalls";
import { useFetch } from "@/CustomHooks/useFetch";
import type { DispatchStatus, MessageDispatch } from "@/utils/api/messaging/interfaces";
import { DispatchDetail } from "./DispatchDetail";

const STATUS_STYLE: Record<DispatchStatus, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700",
  QUEUED: "bg-yellow-50 text-yellow-700",
  SENT: "bg-green-50 text-green-700",
  CANCELLED: "bg-lightGray text-gray-600",
  FAILED: "bg-red-50 text-red-700",
};
const STATUS_LABEL: Record<DispatchStatus, string> = {
  SCHEDULED: "Scheduled",
  QUEUED: "Sending",
  SENT: "Sent",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export const audienceSummary = (d: MessageDispatch) => {
  const a = d.audience;
  if (!a) return "—";
  if (a.scope === "DEPARTMENTS") return `${a.departmentIds.length} department${a.departmentIds.length === 1 ? "" : "s"}`;
  if (a.scope === "PEOPLE") return `${a.userIds.length} ${a.userIds.length === 1 ? "person" : "people"}`;
  return ["Whole church", a.includeGuests && "guests", a.includeVisitors && "visitors"].filter(Boolean).join(" + ");
};

export const channelSummary = (d: MessageDispatch) => {
  if (!d.counts) return "";
  const parts: string[] = [];
  const add = (label: string, c: { sent: number; failed: number; skipped: number }) =>
    parts.push(`${label} ${c.sent}✓${c.failed ? ` ${c.failed}✗` : ""}${c.skipped ? ` ${c.skipped} skipped` : ""}`);
  if (d.channels.sms) add("SMS", d.counts.sms);
  if (d.channels.email) add("Email", d.counts.email);
  if (d.channels.inApp) add("In-app", d.counts.inApp);
  return parts.join(" · ");
};

export const DispatchHistory = ({ refreshKey, canManage }: { refreshKey: number; canManage: boolean }) => {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MessageDispatch | null>(null);
  const { data, refetch } = useFetch(api.fetch.fetchMessageDispatches, { kind: "GENERAL", page, limit: 20 });
  const rows = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  useEffect(() => {
    refetch({ kind: "GENERAL", page, limit: 20 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, page]);

  // While anything is sending or scheduled, poll so counts move.
  const active = rows.some((r) => r.status === "QUEUED" || r.status === "SCHEDULED");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => refetch({ kind: "GENERAL", page, limit: 20 }), 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page]);

  return (
    <section className="rounded-xl border border-lightGray bg-white">
      <h3 className="border-b border-lightGray px-5 py-3 text-base font-semibold text-primary">Sent and scheduled</h3>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">No messages yet.</p>
      ) : (
        <ul className="divide-y divide-lightGray">
          {rows.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => setSelected(d)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-lightGray/40">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block text-xs text-gray-500">
                    {audienceSummary(d)} · {d.createdByName ?? "—"} ·{" "}
                    {new Date(d.scheduledFor ?? d.createdAt).toLocaleString()}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-gray-600">{channelSummary(d)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="flex justify-end gap-2 border-t border-lightGray px-5 py-2 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">Next</button>
        </div>
      )}
      <DispatchDetail
        dispatch={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onChanged={() => refetch({ kind: "GENERAL", page, limit: 20 })}
      />
    </section>
  );
};
```

If the repo has no `bg-blue-50` / `bg-green-50` usages, reuse the repo's existing status-chip classes (grep `StatusChip` / `Badge` under `src/components`).

- [ ] **Step 2: `DispatchDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components";
import { Modal } from "@/components/Modal";
import { api } from "@/utils/api/apiCalls";
import { showNotification } from "@/pages/HomePage/utils";
import type {
  MessageDispatch,
  MessageRecipient,
  RecipientChannel,
  RecipientStatus,
} from "@/utils/api/messaging/interfaces";

const CHANNEL_LABEL: Record<RecipientChannel, string> = { SMS: "SMS", EMAIL: "Email", IN_APP: "In-app" };

interface DispatchDetailProps {
  dispatch: MessageDispatch | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export const DispatchDetail = ({ dispatch, canManage, onClose, onChanged }: DispatchDetailProps) => {
  const [rows, setRows] = useState<MessageRecipient[]>([]);
  const [channel, setChannel] = useState<RecipientChannel | "">("");
  const [status, setStatus] = useState<RecipientStatus | "">("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChannel("");
    setStatus("");
    setPage(1);
  }, [dispatch?.id]);

  useEffect(() => {
    if (!dispatch) return;
    let cancelled = false;
    (async () => {
      try {
        const query: Record<string, string | number> = { page, limit: 50 };
        if (channel) query.channel = channel;
        if (status) query.status = status;
        const response = await api.fetch.fetchMessageRecipients(dispatch.id, query);
        if (!cancelled) {
          setRows(response.data ?? []);
          setTotalPages(response.meta?.totalPages ?? 1);
        }
      } catch {
        // ApiErrorHandler has already shown the error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, channel, status, page]);

  const act = async (action: "cancel" | "retry") => {
    if (!dispatch) return;
    setBusy(true);
    try {
      if (action === "cancel") {
        await api.post.cancelMessageDispatch(dispatch.id);
        showNotification("Scheduled message cancelled", "success");
      } else {
        const response = await api.post.retryFailedMessages(dispatch.id);
        showNotification(`Retrying ${response.data.retried} failed message(s)`, "success");
      }
      onChanged();
      onClose();
    } catch {
      // ApiErrorHandler has already shown the error.
    } finally {
      setBusy(false);
    }
  };

  const failed =
    (dispatch?.counts?.sms.failed ?? 0) + (dispatch?.counts?.email.failed ?? 0) + (dispatch?.counts?.inApp.failed ?? 0);

  return (
    <Modal open={!!dispatch} onClose={onClose} title={dispatch?.title ?? "Message"}>
      {dispatch && (
        <div className="flex max-h-[85vh] w-[min(94vw,760px)] flex-col">
          <div className="space-y-2 border-b border-lightGray p-5">
            <p className="text-lg font-semibold text-primary">{dispatch.title}</p>
            <p className="whitespace-pre-wrap rounded-lg bg-lightGray/50 p-3 text-sm">{dispatch.body}</p>
            {dispatch.error && <p className="text-sm text-red-600">{dispatch.error}</p>}
          </div>
          <div className="flex flex-wrap gap-2 px-5 pt-3 text-sm">
            <select value={channel} onChange={(e) => { setChannel(e.target.value as RecipientChannel | ""); setPage(1); }} className="rounded border border-lightGray p-1">
              <option value="">All channels</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
              <option value="IN_APP">In-app</option>
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value as RecipientStatus | ""); setPage(1); }} className="rounded border border-lightGray p-1">
              <option value="">All statuses</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="SKIPPED">Skipped</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div className="flex-1 overflow-auto px-5 py-3">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr><th className="py-1">Name</th><th>Channel</th><th>To</th><th>Status</th></tr>
              </thead>
              <tbody className="divide-y divide-lightGray">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5">{r.recipient_name}</td>
                    <td>{CHANNEL_LABEL[r.channel]}</td>
                    <td className="max-w-[180px] truncate">{r.address ?? "—"}</td>
                    <td>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      {r.error && <span className="block text-xs text-gray-500">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="py-4 text-sm text-gray-500">No recipients match.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-lightGray px-5 py-3">
            <span className="text-sm">
              {totalPages > 1 && (
                <>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="mr-2 disabled:opacity-40">Previous</button>
                  {page} / {totalPages}
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="ml-2 disabled:opacity-40">Next</button>
                </>
              )}
            </span>
            <span className="flex gap-2">
              {canManage && dispatch.status === "SCHEDULED" && (
                <Button value="Cancel message" variant="secondary" disabled={busy} onClick={() => act("cancel")} />
              )}
              {canManage && failed > 0 && dispatch.status !== "SCHEDULED" && (
                <Button value={`Retry ${failed} failed`} variant="primary" disabled={busy} onClick={() => act("retry")} />
              )}
              <Button value="Close" variant="secondary" onClick={onClose} />
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
};
```

- [ ] **Step 3: Check, then commit Tasks 6 and 7 together**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication/Messaging --max-warnings 0
git add src/pages/HomePage/pages/ChurchCommunication/Messaging/components/AudiencePicker.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/GeneralTab.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/DispatchHistory.tsx \
  src/pages/HomePage/pages/ChurchCommunication/Messaging/components/DispatchDetail.tsx
git commit -m "feat(messaging): general messages with audience, scheduling and history"
```

---

### Task 8: Page shell, route and redirect

**Files:**
- Create: `Messaging/MessagingManager.tsx`
- Modify: `src/routes/appRoutes.tsx` (import near line 98; child route after `sermons` ~line 618), `ChurchCommunication/CommunicationIndexRedirect.tsx`

- [ ] **Step 1: `MessagingManager.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { HeaderControls } from "@/components/HeaderControls";
import { useRouteAccess } from "@/context/RouteAccessContext";
import { useFetch } from "@/CustomHooks/useFetch";
import { api } from "@/utils/api/apiCalls";
import PageOutline from "../../../Components/PageOutline";
import TabSelection from "../../../Components/reusable/TabSelection";
import { BirthdayTab } from "./components/BirthdayTab";
import { GeneralTab } from "./components/GeneralTab";
import { MessagingSettingsModal } from "./components/MessagingSettingsModal";
import { WelcomeTab } from "./components/WelcomeTab";

type MessagingTab = "Welcome messages" | "Birthday messages" | "General messages";

const TABS: MessagingTab[] = ["Welcome messages", "Birthday messages", "General messages"];
const TAB_PARAM: Record<MessagingTab, string> = {
  "Welcome messages": "welcome",
  "Birthday messages": "birthday",
  "General messages": "general",
};

/** Communication > Messaging: automatic welcome and birthday templates and
 *  church-wide messages over SMS, email and in-app. */
const MessagingManager = () => {
  const { canManageCurrentRoute } = useRouteAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dirtyKeys = useRef(new Set<string>());

  const { data: templatesData, refetch: refetchTemplates } = useFetch(api.fetch.fetchMessageTemplates);
  const { data: settingsData, refetch: refetchSettings } = useFetch(api.fetch.fetchMessagingSettings);
  const { data: statsData, refetch: refetchStats } = useFetch(api.fetch.fetchMessagingStats, { days: 30 });

  const templates = templatesData?.data ?? [];
  const settings = settingsData?.data ?? null;
  const stats = statsData?.data ?? null;

  const activeTab: MessagingTab =
    TABS.find((tab) => TAB_PARAM[tab] === searchParams.get("tab")) ?? "Welcome messages";

  const onDirtyChange = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.add(key);
    else dirtyKeys.current.delete(key);
  }, []);

  // Warn before leaving the page with unsaved template edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyKeys.current.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const selectTab = (tab: MessagingTab) => {
    if (dirtyKeys.current.size && !window.confirm("You have unsaved changes. Leave this tab without saving?")) return;
    dirtyKeys.current.clear();
    const next = new URLSearchParams(searchParams);
    next.set("tab", TAB_PARAM[tab]);
    setSearchParams(next, { replace: true });
  };

  const onTemplateSaved = () => {
    refetchTemplates();
    refetchStats();
  };

  const templateProps = {
    settings,
    stats,
    canManage: canManageCurrentRoute,
    onOpenSettings: () => setSettingsOpen(true),
    onDirtyChange,
    onSaved: onTemplateSaved,
  };

  return (
    <PageOutline>
      <HeaderControls
        title="Messaging"
        subtitle="Welcome and birthday messages sent automatically, and messages to the church, departments or people"
        btnName="Settings"
        customIcon={<Cog6ToothIcon className="h-5 w-5" />}
        screenWidth={window.innerWidth}
        handleClick={() => setSettingsOpen(true)}
      />

      <div className="mb-6">
        <TabSelection tabs={TABS} selectedTab={activeTab} onTabSelect={selectTab} />
      </div>

      {activeTab === "Welcome messages" ? (
        <WelcomeTab {...templateProps} templates={templates} />
      ) : activeTab === "Birthday messages" ? (
        <BirthdayTab {...templateProps} template={templates.find((t) => t.key === "BIRTHDAY")} />
      ) : (
        <GeneralTab canManage={canManageCurrentRoute} />
      )}

      <MessagingSettingsModal
        open={settingsOpen}
        settings={settings}
        canManage={canManageCurrentRoute}
        onClose={() => setSettingsOpen(false)}
        onSaved={refetchSettings}
      />
    </PageOutline>
  );
};

export default MessagingManager;
```

Before writing, check:
- **`HeaderControls`:** does it hide its button for view-only users (`requireManageAccess`)? The Settings modal is still useful read-only, so make sure the button shows for viewers too. Pass `requireManageAccess={false}` if that prop exists and defaults to true.
- **`customIcon`:** confirm it renders inside the button. If it doesn't, drop the prop.
- **Relative paths:** `PageOutline` and `TabSelection` are one folder deeper than in `CommunityManager`. Fix the `../../../` depth if tsc complains.

- [ ] **Step 2: Route.** In `appRoutes.tsx`, add the import beside the other ChurchCommunication imports:

```ts
import MessagingManager from "@/pages/HomePage/pages/ChurchCommunication/Messaging/MessagingManager.js";
```

Then add this as the last child of `communication`, after `sermons`:

```tsx
          {
            path: "messaging",
            name: "Messaging",
            element: <MessagingManager />,
            isPrivate: true,
            permissionNeeded: "view_messaging",
            sideTab: true,
          },
```

- [ ] **Step 3: Redirect.** In `CommunicationIndexRedirect.tsx`, append to `COMMUNICATION_PAGES`:

```ts
  { path: "messaging", permission: "view_messaging" },
```

- [ ] **Step 4: Check, then commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication src/routes/appRoutes.tsx --max-warnings 0
git add src/pages/HomePage/pages/ChurchCommunication/Messaging/MessagingManager.tsx \
  src/routes/appRoutes.tsx src/pages/HomePage/pages/ChurchCommunication/CommunicationIndexRedirect.tsx
git commit -m "feat(messaging): Communication > Messaging page with welcome, birthday and general tabs"
```

---

### Task 9: Manual verification

Run against a local Backend on `feat/messaging` (local DB), with `VITE_API_URL` (or the repo's API base env) pointing at it. Never run against production.

- [ ] **Step 1:** Run `npm run dev`. Log in as a full admin. The sidebar should show Communication → Messaging.
- [ ] **Step 2 — Welcome tab:**
  - Three cards are listed.
  - Typing `{frist_name}` shows "Unknown placeholder: {frist_name}".
  - Clicking a chip inserts it at the cursor.
  - The SMS counter updates.
  - Save toasts, and a reload keeps the change.
- [ ] **Step 3 — Visitor card:** "Include app download link" with no store links shows the warning. Its link opens Settings. After saving the links, the preview shows both of them.
- [ ] **Step 4 — Birthday tab:** shows the send time and the upcoming list.
- [ ] **Step 5 — General tab:**
  - Pick Departments and check that the count updates.
  - Tick SMS + In-app. The confirm modal shows reach.
  - Send. The history shows "Sending", then "Sent" with counts.
  - Open the row: the recipients list is shown, and the filters work.
- [ ] **Step 6 — Scheduling:** schedule a message 10 minutes ahead, cancel it from the detail view, and check its status shows "Cancelled".
- [ ] **Step 7 — Viewer:** log in as a user with `Messaging: Can_View`. Everything is visible, but there are no Save, Send or New message controls.
- [ ] **Step 8 — Unsaved changes:** edit a template, then switch tabs. The confirm prompt appears.
- [ ] **Step 9 — Final gate:**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/pages/HomePage/pages/ChurchCommunication src/utils src/routes --max-warnings 0
```

---

## Self-review notes

- **Spec coverage:**

  | Spec item | Task |
  |---|---|
  | Permission | 1 |
  | API | 2 |
  | Composer, chips, counter, preview | 3 |
  | Settings, template card | 4 |
  | Welcome / Birthday tabs (incl. upcoming birthdays and 30-day stats) | 5 |
  | General compose, audience, schedule, confirm | 6 |
  | History, detail, cancel, retry | 7 |
  | Route, redirect, tabs synced to `?tab=`, unsaved-changes guard | 8 |
  | Manual end-to-end check | 9 |

- **Spec deviation:** history opens in a modal (Radix `Modal`) rather than a side drawer, to reuse the repo's only dialog primitive.
- **Type names match across tasks:** `MessageTemplate`, `MessagingSettings`, `MessagePreview`, `MessageAudience`, `AudienceCount`, `MessageDispatch`, `MessageRecipient`, `TemplateStats`, `UpcomingBirthday`, `useMessagePreview`, `emptyAudience`, `isAudienceComplete`, `audienceSummary`, `channelSummary`.
