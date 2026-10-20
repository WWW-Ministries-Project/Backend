# Assets redesign — frontend guide

Endpoints behind the redesigned Assets section (Assets register, Reconciliation,
Analytics). Implementation: `src/modules/assets/asset-redesign.ts` (register) and
`src/modules/assets/asset-stock-check.ts` (stock checks). Frontend mirror:
`Frontend/docs/ASSETS_REDESIGN_BACKEND_CONTRACT.md`.

All endpoints are additive. The legacy `create-asset`, `list-assets`, `get-asset`,
`update-asset` and `delete-asset` keep their shapes. Responses use the usual
envelope `{ message, data }`. `assets/` is branch-scoped: GETs take `branch_id`.

## Schema (migration `20261023120000_assets_redesign`)

| Table | Change |
|---|---|
| `asset_status` enum | adds `NEEDS_REPAIR` (reported faulty, repair not started) |
| `assets` | `category`, `status_since`, `status_note`, `lost_confirmed_at`, `last_counted_at`, `repair_request_id` → `request.id` (SET NULL) |
| `asset_history` | `asset_id` → `assets.id` (CASCADE), `tone`; `status_update` now nullable. Every redesign write logs here |
| `asset_stock_check` | one reconciliation round (`OPEN`/`CLOSED`), scope, due date, creator/closer |
| `asset_stock_check_item` | one row per asset in scope: expected department (null = store), result, where found, administrator's fix |
| `asset_stock_check_extra` | items found that aren't on the register |
| `asset_stock_check_department` | per-department sign-off and last reminder. `department_key` 0 = store |

Backfill: `status_since` = `date_assigned` ?? `date_purchased` ?? `created_at`.

Categories (`category`): `sound | music | media | furniture | appliance | vehicle | other`.

## Access

`can_view_assets_scoped` now also sets `req.assetAccess = { canViewAll, canManage, canAdmin, departmentIds }`.

- View (overview, history, stock-check list): Asset `view` sees everything; anyone
  else sees assets held by their departments (`departmentIds` = own department,
  positions, headed departments).
- Register writes and stock-check administration: Asset `manage`.
- Counting (`mark`, `add-extra`, `remove-extra`, `submit`, `reopen`): Asset `manage`,
  or any item whose expected department is one of the viewer's departments. A
  counter can't change a submitted department until they reopen it.
- Delete stays on the legacy `DELETE delete-asset` (Asset `admin`).
- Writes look assets and checks up within the `branch_id` the client sends, so an id from another branch is not found.

## Register

### `GET assets/overview`
```ts
{
  viewer: { user_id; can_view_all; can_manage; can_delete; department_ids: number[] };
  repair_stale_days: 30;
  categories: { key; label }[];
  departments: { id; name; head: { id; name } | null }[];
  assets: AssetRow[];   // newest purchase first, whole register (no paging)
}
type AssetRow = {
  id; code /* asset_id tag */; name; category; status;
  department: { id; name } | null;
  date_assigned; date_purchased; supplier; price; description; photo;
  status_since; status_note; lost_confirmed_at; last_counted_at; created_at; branch_id;
  repair_requisition: { id; generated_id; status: "DRAFT"|"PENDING"|"APPROVED"|"REJECTED" } | null;
}
```

### `GET assets/history?id=` → `{ asset_id, history: { id, at, text, tone, by }[] }`
Oldest first. Assets created before the redesign get "Bought…" / "Added…" entries rebuilt from their fields (negative ids).

### `POST assets/save-asset` (manage)
Create (no `id`) or edit. `{ id?, name, category, date_purchased, supplier, price, status, description, department_id, date_assigned, status_note?, photo?, branch_id? }`.
Validates name, category, date bought, price > 0, description, department when `ASSIGNED`. Returns `AssetRow`. Creates the asset code (`ID_PREFIX`-YYYY0001) and history.

### `POST assets/update-status` (manage)
`{ ids, status, department_id?, date?, note? }` — note required for `NEEDS_REPAIR`, `NOT_FIXABLE`, `LOST_OR_STOLEN`.
Returns `{ assets: AssetRow[], previous: Snapshot[] }`. `previous` is sent back to `assets/restore { snapshots }` for Undo.

### `POST assets/confirm-lost { id }` (manage) → `{ asset, previous }`
### `POST assets/repair-requisition` (manage)
`{ asset_ids, estimates: { [assetId]: amount }, needed_by, purpose, user_sign, fallback_department_id?, branch_id? }`.
Only `NEEDS_REPAIR` assets without a linked requisition are used; the rest come back in `skipped`.
Creates and submits one requisition per department (usual approval chain), links each asset and logs history, all in one transaction: if any department fails, nothing is created. Uses `createRequisitionTx` from the requisition service.
Returns `{ requisitions: { id, generated_id, department, head_name, asset_ids }[], skipped: string[], assets }`.
### `POST assets/clear-repair-requisition { id }` (manage) — only once the linked requisition is rejected, so a new one can be raised.

## Stock checks

Every mutation returns `{ check: StockCheck }` (the viewer's view of it).

### `GET assets/stock-checks?past_offset=0&past_limit=10`
```ts
{
  viewer: { user_id; is_admin; department_keys: number[] };
  checks: StockCheck[];      // open checks in full; counters see only their items
  past: PastStockCheck[];    // closed checks, newest first, admins only, paged (limit ≤ 50)
  past_total; past_offset; past_limit;
}
type PastStockCheck = {
  id; name; scope_label; started_at; closed_at; created_by; closed_by;
  stats: { expected; counted; matched; differences; not_found_value };
}
type StockCheck = {
  id; name; scope_label; status: "open"|"closed"; started_at; due_date; closed_at;
  created_by: { id; name } | null; closed_by: { id; name } | null;
  departments: { key; name; counter: { id; name } | null; submitted_at; submitted_by_name; reminded_at }[];
  items: { asset_id; asset: { code; name; category; status; status_since; status_note; price };
           expected_key; expected_name; result; found_key; found_name; fix; counted_at; counted_by_name }[];
  extras: { id; name; category; found_key; found_name; note; fix: "add"|"ignore"; recorded_at; recorded_by; recorded_by_name; created_asset_id }[];
}
```
### `GET assets/stock-checks/detail?id=` → `{ check: StockCheck }`
One check in full, for a closed report or a notification link. Closed checks are admin-only.

A branch sees its own checks plus checks that span all branches.

Keys: department id, or `0` for the store. The store's counter is whoever started the check; a department's counter is its head.

| Endpoint | Body | Who |
|---|---|---|
| `stock-checks/start` | `{ name, department_key?, category?, due_date, branch_id? }` → also `counted`, `notified`. Serialized with a row lock on the branch (all branch rows for an all-branches check), so only one open check per branch can exist even when two admins start at once | manage |
| `stock-checks/cancel` | `{ check_id }` → `{ id }` (check deleted, counters told) | manage |
| `stock-checks/mark` | `{ check_id, marks: [{ asset_id, result \| null, found_key? }] }` | counter |
| `stock-checks/set-fix` | `{ check_id, asset_id \| extra_id, fix }` | manage |
| `stock-checks/add-extra` | `{ check_id, name, category?, found_key, note? }` | counter |
| `stock-checks/remove-extra` | `{ check_id, extra_id }` | manage or recorder |
| `stock-checks/submit` | `{ check_id, department_key }` (all its items counted) | counter |
| `stock-checks/reopen` | `{ check_id, department_key }` | counter |
| `stock-checks/remind` | `{ check_id, department_keys? }` → also `sent` | manage |
| `stock-checks/recount` | `{ check_id, asset_id }` → also `counter_name` | manage |
| `stock-checks/mark-rest-missing` | `{ check_id }` (uncounted → missing, fix `keep`) | manage |
| `stock-checks/close` | `{ check_id }` (everything counted) | manage |

Results: `found | elsewhere | damaged | missing | atrepair | back`. An `elsewhere` item is done once `found_key` is set.
Default fixes on mark: elsewhere→`move`, damaged→`needs` (`keep` if already needs repair), back→`working`, missing→`lost`.
Allowed fixes: elsewhere `move|return`; damaged `needs|beyond|keep`; back `working|needs|keep`; missing `lost|keep`; extra `add|ignore`.

Closing (one transaction): found / at repair / elsewhere / damaged / back items get `last_counted_at`; `move` reassigns
(or returns to the store), `needs`/`beyond` set the status with a note, `working` puts it back in use, `lost` marks
lost or stolen; extras set to `add` become new assets (price 0, "purchase details to be confirmed"). Every change is logged
in the asset's history and the check is locked as a report.

Notifications (`assets.stock_check_started`, `_reminder`, `_submitted`, `_cancelled`) link to `/home/assets/count?check=<id>`.
A daily job (08:00, `ASSET_STOCK_CHECK_REMINDER_CRON` overrides) reminds counters who haven't submitted once a check is
within 3 days of its due date, at most once a day per department.
