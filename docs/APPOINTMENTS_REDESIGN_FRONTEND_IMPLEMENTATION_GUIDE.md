# Appointments redesign — frontend implementation guide

Backend side of `Frontend/docs/APPOINTMENTS_REDESIGN_BACKEND_CONTRACT.md`. Everything is additive: existing fields, routes and the mobile app keep working. This page lists what shipped and where it differs from, or adds to, the contract.

Code: `src/modules/appointment/` (`appointment-actions.ts`, `appointment-rules.ts`, `appointment-settings.ts`, `appointment-notifications.ts`, `appointment-jobs.ts`), cron `src/cron-jobs/appointmentNotificationCron.ts`, migration `prisma/migrations/20261021120000_appointments_redesign`.

## Error shape

- New endpoints (actions, pause, time off, settings) throw and are answered by the global handler: `{ "message": "...", "data": null }` with 400 / 403 / 404.
- Existing endpoints keep `{ "error": "..." }` (`POST /appointment/book`, `PUT /appointment/bookings/:id/cancel`).
- Read `message ?? error`. Messages are written for toasts (no status codes, no "Please").

## Booking fields

Every booking (`GET /appointment/bookings`, `GET /appointment/bookings/:id`, actions, book, cancel) adds:

| Field | Type |
|---|---|
| `reasonId` | `number \| null` |
| `respondedAt` | ISO string `\| null` |
| `proposedDate` | `YYYY-MM-DD \| null` |
| `proposedStartTime` / `proposedEndTime` | `string \| null` (as stored on the session, e.g. `"10:00"`) |
| `declineReason` | `string \| null` |
| `responseMessage` | `string \| null` |
| `remindedAt` | ISO string `\| null` |
| `history` | `{ at, text, tone }[]`, oldest first, always an array |

`GET /appointment/bookings?status=` now accepts all seven statuses. `PUT /appointment/bookings/:id` and `PUT /appointment/status` still only write `PENDING` / `CONFIRMED` / `CANCELLED`; both now append a history line when the status or time changes.

Slot occupancy: `CANCELLED` and `DECLINED` bookings free their slot. A `RESCHEDULED` booking holds its **proposed** slot (not the original), matching the frontend's `slotOf`.

## `POST /appointment/book`

- `reasonId` (optional): must be an existing `appointment_reason`. When `purpose` is missing, the reason's label is used.
- `requesterId` other than the caller, or `status: "CONFIRMED"`: manage only. Otherwise 400 "You can only book appointments for yourself." / "Only appointment managers can confirm a booking straight away." `status` may only be `PENDING` or `CONFIRMED`.
- When booking for a member, `fullName`, `email` and `phone` default to the member's record if not sent.
- Confirmed bookings set `respondedAt`. Notifications: person booked gets the `new` → attendee channels (with "confirmed" wording); member gets `accepted` → requester channels.
- Rule errors (400): "<Name> isn't taking new bookings right now.", "<Name> is away on that day. Choose another day or someone else.", "That time is too soon. Bookings need at least 12 hours' notice.", "That date is too far ahead. Bookings open 60 days in advance."
- Taken slot stays 409 `{ error, code: "SLOT_UNAVAILABLE" }` as before.

## `POST /appointment/bookings/:id/actions`

Returns `{ message: "Appointment updated", data: <booking> }`.

Access: manage, or the person booked on their own booking. `remind`, `reassign` and `confirm_proposal` are manage only (403 "Only appointment managers can do that."). Anyone else: 403 "You can only act on appointments booked with you."

| `action` | Body | Notes |
|---|---|---|
| `accept` | | `CONFIRMED`; sets `respondedAt` if empty |
| `reopen` | | `CONFIRMED` within 10 min of the last accept → `PENDING`. Clears `respondedAt` only if that accept set it |
| `suggest` | `date`, `startTime`, `endTime`, `message?` | Slot must be one of the person's sessions on that weekday and free; booking rules apply. Same as current time → 400 |
| `decline` | `reason`, `message?` | `reason` exactly one of "Not available then", "Better suited to someone else", "Outside my ministry area", "Other" |
| `cancel` | `message?` | `message` stored in `responseMessage` |
| `complete` / `no_show` | | Only after the end time |
| `remind` | | Sets `remindedAt`; always push + SMS to the person booked |
| `reassign` | `attendeeId` | Slot must be one of the new person's sessions and free; rules apply. Resets `createdAt`, clears reply fields and job markers. New person gets the `new` notification; the member is told it moved |
| `confirm_proposal` | | Copies proposed slot onto `date` / `startTime` / `endTime`, clears the proposal, `CONFIRMED` |

`message` is trimmed, max 1000 characters; blank becomes `null`.

Wrong-state messages (400): "This request has already been answered.", "This appointment was cancelled.", "This appointment is already confirmed.", "It's too late to undo. Suggest a new time or cancel instead.", "You can record how it went once the appointment has ended.", "There's no suggested time to confirm on this appointment.", "This appointment can't be cancelled any more.". Taken slot on suggest / reassign / confirm_proposal is 400: "<Name> is already booked then. Choose another time."

History text: the person booked acting is just their name ("Accepted by Pastor Samuel Addo"); anyone else is "<Admin> for <Attendee>" ("Kwame Mensah for Pastor Samuel Addo suggested Thu 22 Oct, 10:00 AM"). `confirm_proposal` reads "<Admin> for <Member> accepted Thu 22 Oct, 10:00 AM"; `reassign` reads "Reassigned from A to B by <Admin>".

## Availability

`GET /appointment/availability` (and the responses of `POST /appointment/availability` and `PUT /appointment/availability/:id`) add per person: `position`, `bufferMinutes` (0 default), `paused` (false default) and `timeOff: { id, from, to, note }[]`. `timeOff` lists only entries ending today or later.

`POST /appointment/availability` accepts top-level `bufferMinutes` (integer 0–240).

- `PUT /appointment/availability/staff/:userId/pause` body `{ paused: boolean }` → `{ userId: number, paused }`.
- `POST /appointment/availability/staff/:userId/time-off` body `{ from, to, note? }` (note max 255) → 201 `{ id, userId, from, to, note }`.
- `DELETE /appointment/availability/time-off/:id` → the deleted entry.

`GET /appointment/availability/status` and `/availability/booking-options` drop paused people, and drop a time slot when its date (the `?date=` given, or the slot's next matching weekday) is in the person's time off.

## Settings

`GET /appointment/settings` (any signed-in user) and `PUT /appointment/settings` (Appointments manage). Shape and defaults exactly as in the contract. PUT merges any subset, including a partial `notifications` (per event, per audience) and returns the full object. Bad values → 400, e.g. "Book up to has to be 14, 30, 60 or 90 days.", `"fax" isn't a channel. Use push, sms or email.`

## Notifications

Channels map to the shared notification service: `push` = in-app row + web/Expo push, `email`, `sms`. The matrix is the policy, so SMS does not need a member opt-in, but a member who explicitly turned a channel off in their notification preferences is respected. A person gets one message per event even when they fill two roles; the person who acted gets none (except the member's own `new` receipt). Notification types: `appointment.booked` (new), `appointment.status_changed` (accepted / suggested / declined / cancelled), `appointment.reminder` (nudge, reminder, outcome, admin remind) and `appointment.overdue` (overdue, unanswered). Action URLs: `/member/appointments` for the member, `/home/appointments` for everyone else.

## Scheduled job

Every 15 minutes (`APPOINTMENT_JOBS_CRON`, default `7,22,37,52 * * * *`). Each booking is claimed under a row lock by setting a marker before sending, so each notification goes once.

- Nudge: `PENDING` past half the reply deadline (and not yet overdue). History "Reminder sent to <Name> (12 h without a reply)".
- Overdue: history "Overdue: admins alerted".
- Unanswered: push to the member (not part of the matrix), history "No reply after 72 h: <Member> offered other people".
- Reminder and outcome: no history line.

The migration backfills a first history line ("Requested by <fullName>") and marks bookings created more than 3 days ago (and appointments dated before yesterday) as already notified, so the first run does not flood admins.

Times: booking dates and "HH:MM" times are read on the church clock, `APPOINTMENTS_UTC_OFFSET_MINUTES` (falls back to `RIDES_UTC_OFFSET_MINUTES`, default 0).
