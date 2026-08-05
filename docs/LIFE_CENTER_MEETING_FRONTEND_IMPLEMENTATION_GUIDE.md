# Life Center Meeting — Frontend Implementation Guide

## 1. Scope

Endpoints for logging dated Life Center meetings: attendees, first-timers,
offering amount, optional note. All under `/lifecenter`.

## 2. API Endpoints

### 2.1 Create — `POST /lifecenter/meeting`

Body:
```json
{
  "lifeCenterId": 3,
  "date": "2026-08-02",
  "offeringAmount": "150.00",
  "currency": "GHS",
  "note": "<p>optional html</p>",
  "attendeeSoulWonIds": [12, 14],
  "firstTimerSoulWonIds": [21],
  "newFirstTimers": [
    { "first_name": "Ama", "last_name": "Owusu", "contact_number": "...", "country": "Ghana", "city": "Accra", "date_won": "2026-08-02", "wonById": 7 }
  ]
}
```
Auth: caller must be a `life_center_member` of `lifeCenterId` (any role) or a
privileged user with the `Life Center` manage permission. Response `201`.

### 2.2 Update — `PUT /lifecenter/meeting`

Same body as create, plus `"id"`. Fully replaces the attendee list. Only the
creator (or a privileged user) may update. `401` otherwise.

### 2.3 Delete — `DELETE /lifecenter/meeting?id=`

Only the creator (or a privileged user) may delete. `401` otherwise.

### 2.4 Get one — `GET /lifecenter/meeting?id=`

### 2.5 List ("My Meetings") — `GET /lifecenter/meetings?lifeCenterId=&page=&take=`

Always filtered server-side to the caller's own `createdById` — this is what
makes it "my" meetings, not a separate permission tier. Paginated envelope:
```json
{ "message": "OK", "current_page": 1, "page_size": 10, "total": 4, "totalPages": 1, "data": [ /* meetings */ ] }
```

### 2.6 Eligible first-timers — `GET /lifecenter/soulswon-eligible-first-timers?lifeCenterId=`

Souls won for that life center with zero prior meeting attendance. Backs the
"First timers" dropdown. The existing `GET /lifecenter/soulswon?lifeCenterId=`
(unfiltered) backs the "Attendees" dropdown — no change there.

## 3. Data shape

```ts
type MeetingAttendee = { soulWonId: number; name: string; isFirstTimer: boolean };
type Meeting = {
  id: number; lifeCenterId: number; date: string;
  offeringAmount: string; currency: "GHS" | "USD" | "GBP";
  note: string | null; createdById: number; createdAt: string;
  attendees: MeetingAttendee[];
};
```

## 4. Validation rules (match backend)

- `date` required, not in the future.
- At least one id across `attendeeSoulWonIds` + `firstTimerSoulWonIds` +
  `newFirstTimers` combined — a meeting with nobody recorded is rejected
  (`400`, "A meeting must have at least one attendee or first-timer").
- `offeringAmount` required, `>= 0`.
- `currency` one of `GHS` / `USD` / `GBP`.
- `note` optional.

## 5. Error handling

- `400` — validation failures (missing `lifeCenterId`, empty attendee list, etc).
- `401` — permission domain check failed, or ownership check failed on
  update/delete/get-one.
- `404` — meeting id not found.

## 6. Implementation checklist

- [ ] Frontend web: API layer + `MeetingsList`/`MeetingForm` + tabs on
      `ViewLifeCenter.tsx` and `MyLifeCenter.tsx`.
- [ ] Mobile: types + api + `MeetingRecordForm` + tab switcher on
      `LifeCenterScreen`.
