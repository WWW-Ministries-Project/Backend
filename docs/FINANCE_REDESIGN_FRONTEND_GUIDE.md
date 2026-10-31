# Finance redesign — backend contract

Agreed shapes for the redesigned Finance section (Finance Manager and weekly
records, Configuration, Giving options, Giving contributions, Pledges). Backend
implementation: `Backend/src/modules/finance/Financials`, `finance/GivingOption`
and `pledges/`. Frontend client types: `Frontend/src/utils/api/finance/interface.ts` and
`Frontend/src/utils/api/pledges/interface.ts`; frontend copy: `Frontend/docs/FINANCE_REDESIGN_BACKEND_CONTRACT.md`.

Everything is additive except one behaviour change: weekly records are now
unique per **week and branch** instead of per month (see Schema). Responses use
the usual envelope `{ message, data }`. `financials/`, the four `*config/`
prefixes and `givingoption/` are branch-scoped by the API layer; `pledges/`
takes `branch_id` explicitly.

## Schema (migration `20261024120000_finance_redesign`)

| Table | Change |
|---|---|
| `financials` | Drops the global unique index on `periodDate`; adds unique `(branch_id, periodDate)`. Adds `returned_by_user_id`, `returned_at`, `return_note` |
| `finance_approval_config` | Adds `tithe_percentage DECIMAL(5,2) DEFAULT 10` |
| `pledger` | Adds `reminded_at` (last balance reminder) |

`metaData.periodDate` is now the week's first day (`YYYY-MM-DD`). `YYYY-MM` is
still accepted so records saved before the redesign can be opened and edited;
saving one from the new screen moves it to its week key.

## Weekly records (`financials/`)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `get-financials` | `page`, `take` (client asks for 500) | Rows gain `createdByUserId`, `updatedByUserId`, `returnedByUserId`, `returnedAt`, `returnNote`, `branch_id` |
| POST | `create-financial` | `FinanceData & { action, branch_id? }` | 409 when the branch already has a record for that week |
| PUT | `update-financial?id=` | same | `SAVE_AND_APPROVE` clears any return note |
| POST | `approve-financial?id=` | — | Finance approver only, record must be `PENDING_APPROVAL`. Notifies the preparer and the configured recipients |
| POST | `return-financial?id=` | `{ note }` | Finance approver only, `PENDING_APPROVAL` → `DRAFT` with the note. Notifies the preparer |
| GET | `auto-amounts?from=&to=` | `YYYY-MM-DD` | `{ online_giving, online_giving_count, pledges_redeemed, pledges_redeemed_count }`, major units |
| GET/POST | `get-approval-config` / `upsert-approval-config` | adds `tithe_percentage` (0–100) | Omitting it leaves the stored rate unchanged |

`auto-amounts`: online giving = successful giving contributions by `paid_at`;
pledges redeemed = redemptions by `date`, excluding the `paystack` method (online
pledge payments settle into the pledge's own account, not the offering).

The client fills receipt lines named like "Pledges Redeemed" (contains *pledge*
and *redeem*) and "Online giving (Paystack)" (contains *online giving* or
*paystack*) from these totals. Weekly totals (tithe, balances, fund allocation)
are still computed client-side and stored in the payload.

## Giving (`givingoption/`)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `contributions/recheck` | `{ references: string[] }` (max 50) | `can_manage_giving`. Verifies unsettled rows with Paystack through the normal settle path. Returns `{ data: GivingContribution[], checked, failed }` |
| POST | `contributions/nudge` | `{ reference }` | `can_manage_giving`. Failed/abandoned gifts by a member only: in-app + email linking to `/member/giving?option=<id>` |

Pausing an option is the existing archive (`delete-giving-option`); resuming is
`restore-giving-option`. The list is fetched with `include_archived=true`.
Shared giving links are `/member/giving?option=<id>`; the member Give page
preselects that option.

## Pledges (`pledges/`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `get-pledges` | — | Rows gain `target_amount`, `created_at`, `pledger_count`, `pledgers_with_balance`, `uncredited_payments` (settled online payments with no redemption) |
| GET | `get-pledge` | `id` | Pledger rows gain `reminded_at` |
| POST | `remind-pledgers` | `{ pledge_id, pledger_ids? }` | `can_manage_pledges`. Members with a balance get in-app + email; guests are skipped. Returns `{ reminded, skipped_guests, pledger_ids }` |
| POST | `credit-payment` | `{ payment_id }` | `can_manage_pledges`. Writes the missing redemption for a settled payment. Idempotent |

Pledge routes in the app now check `view_pledges` / `manage_pledges`, matching
the backend, instead of the Financials permissions.
