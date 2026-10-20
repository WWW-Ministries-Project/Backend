# Life centers redesign — backend contract

Agreed shapes for the redesigned Life Centers pages (list, detail, analytics,
member-portal leader view). Backend implementation:
`Backend/src/modules/lifeCenterMangement`. Frontend client types:
`Frontend/src/utils/api/lifeCenter/interfaces.ts`; frontend copy:
`Frontend/docs/LIFE_CENTERS_REDESIGN_BACKEND_CONTRACT.md`.

Everything is additive except where marked **changed**. Responses use the usual
envelope `{ message, data }`. Dates are `YYYY-MM-DD` taken from the stored UTC
date unless noted. Branch-scoped reads take `branch_id` (omitted = all branches).

"Scoped" below means `can_view_life_center_scoped` / `can_manage_life_center_scoped`:
admins with Life Center view/manage see everything; anyone else only the centers
they belong to (401 otherwise).

## Schema (migration `20261025120000_life_centers_redesign`)

| Table | Change |
|---|---|
| `life_center` | Adds `createdAt` (backfilled to the earliest of first meeting / first soul won, else migration time) and `lastRemindedAt` |
| `life_center_meeting_member` | New: `(meetingId, userId)` unique. Members who came. Cascades with the meeting |
| `life_center_role` | Inserts `Leader`, `Assistant leader`, `Member` when missing (matched case-insensitively, `_` = space) |

One leader per center: create/update with `leaderUserId`, `add-lifecenter-member`
and `update-member-role` with the Leader role move the current leader to
`Assistant leader`. Leader eligibility (`life_center_leader`) is checked only when
the target role is Leader.

## Reads

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `overview` | `from`, `to`, `lifeCenterId?`, `branch_id?` | Scoped. `{ roles, centers, meetings, souls }`; `from`/`to` bound `meetings` and `souls`, center totals are all time. `roles[].member_count` counts the returned centers. `first_timer_ids` / `recent_meetings[].first_timers` = every soul-won attendee row |
| GET | `get-lifecenter` | `id` | Scoped. Adds `created_at`, `leader`, `members[].phone` / `attended` / `of` (last 10 meetings), `soulsWon[].gender` / `country_code` / `first_meeting_date` (earliest meeting attended) |
| GET | `meetings` | `lifeCenterId?`, `page`, `take` (≤ 500) | **Changed**: scoped instead of creator-only. Adds `day`, `members: { user_id, name, role \| null }[]`, `created_by: { id, name } \| null` |
| GET | `meeting` | `id` | Same shape and scope |
| GET | `meetings/export` | — | No longer creator-only (matches `meetings`) |
| GET | `get-roles` | — | Adds `member_count` (all centers) |

## Writes

| Method | Path | Body | Notes |
|---|---|---|---|
| POST/PUT | `meeting` | adds `memberUserIds: number[]` | Members must belong to the center (people already on the meeting stay valid). `newFirstTimers[]` needs only `first_name`, `last_name`, `contact_number`; defaults `country ""`, `city` = first part of the location, `date_won` = meeting date, `wonById` = leader else caller. Needs ≥ 1 member or soul. 409 `"A meeting is already recorded for this date."` (one per center per UTC day). Update/delete: anyone whose scope covers the center |
| POST | `create-lifecenter` | adds `leaderUserId?` | Response includes `id`, `created_at` |
| PUT | `update-lifecenter` | adds `leaderUserId?` | Adds the person if needed; previous leader → Assistant leader |
| DELETE | `delete-lifecenter` | `id` | **Changed**: one transaction removes meetings (members/attendees), souls won (converted users keep membership, link cleared), members, then the center. 404 if missing |
| POST/PUT | `add-lifecenter-member` / `update-member-role` | — | **Changed**: leader swap |
| DELETE | `delete-role` | `id` | **Changed**: 400 for Leader/Member; holders move to Member first |
| POST | `remind-leader` | `{ lifeCenterId, reason: "overdue" \| "irregular" \| "attendance" }` | `can_manage_life_center`. In-app + push to the leader (`life_center.leader_reminder`, action `/member/life-center`). 429 `"A reminder was already sent to this leader today."` within 24h; 400 if no leader. Returns `{ sent_to }` |
