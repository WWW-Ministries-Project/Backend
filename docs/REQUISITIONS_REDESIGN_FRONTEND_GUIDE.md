# Requisitions redesign — frontend implementation guide

Agreed shapes for the redesigned Requisition section (My requisitions,
Requisitions, Analytics). Backend implementation: `Backend/src/modules/requisitions/requisition-redesign.ts`.
All endpoints are additive; the existing `list-requisition`, `my-requisitions`,
`get-requisition` responses are unchanged for older clients and the mobile app.

All responses use the usual envelope `{ message, data }`. `branch_id` is added
by the client's branch scoping (`requisitions/` is branch-scoped).

## Schema changes (migration `20261022120000_requisition_redesign`)

| Table | Column | Notes |
|---|---|---|
| `request` | `needed_by` DATETIME NULL | Date the items are needed by |
| `request` | `purpose` TEXT NULL | "Why it's needed". Legacy rows fall back to the requester's first comment |
| `request` | `created_at` DATETIME NULL | Backfilled from `requisition_date` |
| `request` | `submitted_at` DATETIME NULL | Set on submit; backfilled from the first approval instance |
| `request` | `last_reminder_at` DATETIME NULL | Last manual or automatic reminder |
| `request` | `revised_from_id` INT NULL | Draft created with "Revise as new draft" |
| `request` | `history` JSON NULL | Server-written events with no other record (reminders, revisions) |
| `requisition_approval_instances` | `signature` VARCHAR NULL | Approver's typed full name |
| `requisition_approval_configs` | `approval_reply_days` INT DEFAULT 3 | Days before a step is overdue and chased |

## Changed request bodies

- `POST create-requisition`, `PUT update-requisition`: accept `needed_by`
  (`YYYY-MM-DD` or null), `purpose` (string), and on create `revised_from_id`.
  Edits to `needed_by`/`purpose` are recorded in the edit audit.
- `POST approval-action`: accepts `user_sign`; stored on the acted instance.
- `POST upsert-approval-config`: accepts `approval_reply_days` (1–30). Omitting
  it keeps the stored value. `get-approval-config` returns it.

## `GET requisitions/overview?scope=mine|all`

- `mine`: everything the viewer raised, drafts included.
- `all`: managers (Requisition `Can_Manage`/`Super_Admin`) get every submitted
  requisition; anyone else gets submitted requisitions with a step assigned to
  them (waiting, current or done).

```ts
{
  viewer: { user_id: number; is_manager: boolean; is_approver: boolean };
  reply_days: number;          // approval_reply_days
  lookback_days: number;       // similar_item_lookback_days
  requisitions: Row[];         // newest first
}

type Row = {
  id: number; generated_id: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED"; raw_status: string;
  requester: { id: number; name: string; position: string | null };
  department: { id: number; name: string };
  event: { id: number; name: string } | null;
  branch_id: number | null; currency: string; total_amount: number;
  items: { name: string; quantity: number; unit_price: number }[];
  purpose: string | null; needed_by: string | null; request_date: string;
  created_at: string; submitted_at: string | null; decided_at: string | null;
  last_reminder_at: string | null;
  revised_from: { id: number; generated_id: string } | null;
  revised_to: { id: number; generated_id: string } | null;
  attachment_count: number; comment_count: number;
  steps: {
    order: number;
    label: string;               // "Head of department", position name, or approver's position
    type: "HEAD_OF_DEPARTMENT" | "POSITION" | "SPECIFIC_PERSON";
    approver: { id: number; name: string };
    status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED";
    started_at: string | null;   // submission, or the previous step's decision
    acted_at: string | null; comment: string | null; signature: string | null;
  }[];
};
```

## `GET requisitions/overview-detail?id=`

Access as `get-requisition` (requester, manager or approval participant).
Returns `Row` plus:

```ts
products: { id: number; name: string; quantity: number; unit_price: number; image_url: string | null }[];
attachments: { id: number; url: string }[];
comments: { id: number; user_id: number | null; name: string; comment: string; created_at: string }[];
history: { at: string; text: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }[];
```

History is derived from `created_at`, `submitted_at`, approval instances, edit
logs and the `history` JSON, oldest first.

## `POST requisitions/send-reminder { requisition_id }`

Managers only. Notifies the current approver (`requisition.approval_reminder`,
in-app + push + email), sets `last_reminder_at`, adds a history entry. One per
hour per requisition (400 otherwise). Returns `{ requisition_id, reminded_at, approver_name }`.

A daily job (08:00 server time, `REQUISITION_REMINDER_CRON` to override) sends
the same reminder automatically once a step has waited longer than
`approval_reply_days`, then again every `approval_reply_days`.

## `POST requisitions/add-comment { requisition_id, comment }`

Anyone who can open the requisition (requester, manager, any approver on it)
can comment at any stage; up to 2000 characters. Notifies the requester and
current approver (`requisition.comment_added`). Returns `{ id, created_at }`.

## `GET requisitions/analytics?from&to&bucket&department_id`

`from`/`to` are `YYYY-MM-DD`, `to` inclusive, at most two years. `bucket` is
`day|week|month` (defaults by span). Managers and anyone with an assigned
approval step; others get 401. Non-managers only see requisitions that pass through their steps. Counted by submission date; "waiting now" and
`stuck_now` cover every requisition still in approval.

```ts
{
  period: { from; to; bucket }; currency: string; reply_days: number;
  viewer: { user_id; is_manager };
  kpis: { submitted; requested_value; approved_value; approved_count; rejected_count;
          in_approval; median_days_to_approval: number | null; slow_count };
  buckets: { label; start; end; submitted; requested_value; approved_value }[];
  steps: { order; label; median_days: number | null; over_count; total; waiting_now }[];
  departments: { department_id; name; approved_value; submitted; rejected; decided }[];
  approvers: { user_id; name; role; decided; approved; median_days: number | null;
               over_count; waiting_now; oldest_waiting_days: number | null }[];
  top_items: { name; times; quantity; value; departments }[];   // top 6
  stuck_now: { count; value; generated_ids: string[] };
  rows: { id; generated_id; requester; department; event: string | null; amount; currency;
          status; submitted_at; step_days: { order; label; days: number | null }[];
          days_to_decision: number | null }[];                 // for CSV export
}
```
