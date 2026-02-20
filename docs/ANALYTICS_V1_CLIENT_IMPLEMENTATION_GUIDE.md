# Analytics V1 Client Implementation Guide

## Purpose
This guide helps frontend implement Analytics V1 using the **current backend endpoints**.

V1 constraints:
- No new analytics backend route.
- No schema changes.
- Client composes and normalizes module APIs into analytics widgets.

---

## 1) Base Setup

## Base URL
Use your deployed API origin, for example:
- `https://dev.worldwidewordministries.org`


All endpoints below are relative to this base.

## Auth
Most endpoints require:
- `Authorization: Bearer <JWT>`

## Time and Date
- Send date filters in `YYYY-MM-DD`.
- Backend stores timestamps in UTC-like DateTime fields.
- For day-level analytics, normalize on client to day start/day end in your selected timezone.

---

## 2) V1 Analytics Contract on Client

You can keep the client contract you proposed and build it in an adapter layer.

Input contract (client-side):

```json
{
  "date_range": { "from": "2025-01-01", "to": "2026-02-19" },
  "timezone": "Africa/Accra",
  "filters": {},
  "metrics": [],
  "group_by": "month",
  "compare": { "enabled": true, "mode": "previous_period" }
}
```

Output contract (client-side normalized):

```json
{
  "module": "membership",
  "generated_at": "2026-02-19T10:30:00Z",
  "filters_applied": {},
  "metrics": {}
}
```

Metric payload types (client adapter):
- `timeseries`
- `breakdown`
- `ratio`
- `funnel`
- `distribution`
- `cohort`
- `score`

---

## 3) Endpoint Map by Module

## Membership
- `GET /user/list-users`
- `GET /user/search-users`
- `GET /user/stats-users`
- `GET /user/get-user`

Useful query params on `/user/list-users`:
- `page`, `take`
- `is_active`
- `is_user` or `ministry_worker`
- `department_id`
- `membership_type`
- `name`

## Visitors
- `GET /visitor/visitors`
- `GET /visitor/visits`
- `GET /visitor/followups`
- `POST /visitor/convert-to-member?id=<visitorId>`

Useful query params on `/visitor/visitors`:
- `search`
- `createdMonth` (`YYYY-MM`)
- `visitMonth` (`YYYY-MM`)
- `eventId`
- `page`, `limit`

## Events
- `GET /event/list-events`
- `POST /event/register`
- `GET /event/get-registered-event-members?event_id=<id>`

Useful query params on `/event/list-events`:
- `month`, `year`
- `event_type`
- `event_status`
- `page`, `take`

## Attendance
- `GET /event/church-attendance`

Supported filters:
- event-based: `?eventId=12`
- date-based: `?date=2026-02-20`
- both: `?eventId=12&date=2026-02-20`

## Appointments
- `GET /appointment/bookings`
- `GET /appointment/availability`
- `GET /appointment/availability/status`

Useful query params on `/appointment/bookings`:
- `staffId` (or `userId`)
- `requesterId`
- `email`
- `status`
- `date`

## Assets
- `GET /assets/list-assets?page=1&take=50`

## Marketplace
- `GET /orders/get-all-orders`
- `GET /orders/get-orders-by-market?market_id=<id>`
- `GET /market/list-markets`
- `GET /market/list-active-markets`
- `GET /product/list-products`
- `GET /product/list-products-by-market?market_id=<id>`

## School of Ministry
- `GET /program/programs`
- `GET /program/cohorts`
- `GET /program/cohort-courses?cohortId=<id>`
- `GET /program/courses?page=1&take=4000` (all courses, optional pagination)
- `GET /program/user-enrollment?userId=<id>` or `/program/user-enrollment/:id`
- `GET /program/assignment-results?topicId=<id>&cohortId=<id>&programId=<id>`

---

## 4) Known Endpoint Caveats (Important)

1. Some `GET` endpoints read filters from `req.body.filters` (`/market/list-markets`, `/product/list-products`, `/market/get-market-count`).
- Many clients/proxies do not support GET body.
- Recommended V1 approach: call without body filters and filter client-side.

2. Attendance date filter is day-level. If you pass `date`, backend applies start-of-day to next-day range.

3. Appointments do not have `COMPLETED` status in schema.
- Use `PENDING`, `CONFIRMED`, `CANCELLED` for V1 outcome/status analytics.

4. Visitor conversion timestamp is not explicit.
- Use `visitor.is_member = true` as conversion signal.

---

## 5) Global Filter Mapping (Client)

Use this mapping when building your analytics filter bar.

- `date_range.from/to`
  - Membership: filter by `created_at`, optionally `updated_at` depending metric.
  - Visitors: `createdAt` and visit dates.
  - Events: `start_date`/`end_date`.
  - Attendance: `date`.
  - Appointments: `date`.
  - Assets: `date_purchased`, `created_at`.
  - Marketplace: `orders.created_at`, `markets.start_date/end_date`.
  - School: `enrolledAt`, `submittedAt`, `createdAt`.

- `membership_type`
  - Membership and attendance/member-linked views.

- `department`
  - Membership and assets.

- `country/state/city`
  - Membership and visitors.

- `life_center_id`
  - Apply only where life-center context is present.

---

## 6) Metric Implementation (V1)

## Membership
- `new_members_trend`: count `user` by `created_at` buckets.
- `active_inactive_split`: breakdown by `is_active`.
- `program_participation_rate`: users with >=1 enrollment / total users.
- `ministry_involvement_rate`: users with any of `department_id`, `position_id`, `department_positions`, `life_center_member`.
- `discipleship_completion_rate`: completed enrollments / total enrollments.
- `age_band_distribution`: from `user_info.date_of_birth`.
- `gender_distribution`: from `user_info.gender`.
- `marital_status_distribution`: from `user_info.marital_status`.
- `location_distribution`: `country/state_region/city`.
- `family_connection_coverage`: users with `family_relation` links / total users.
- `emergency_contact_completeness`: score required emergency fields.
- `profile_completeness_score`: score required profile fields.
- `duplicate_risk`: same email/phone collisions.
- `lifecycle_stage_distribution`: rule-based current state only.

## Visitors
- `new_visitors_trend`: count `visitor.createdAt` by bucket.
- `repeat_visitor_rate`: visitors with `visitCount > 1` / total visitors.
- `source_mix`: `howHeard` and event linkage.
- `followup_status_mix`: `follow_up.status` breakdown.
- `visitor_to_member_conversion_rate`: `is_member=true` / total visitors.

## Events
- `events_created_trend`: count `event_mgt.created_at`.
- `event_type_mix`: breakdown `event_type`.
- `upcoming_active_ended_split`:
  - upcoming: `start_date > now`
  - active: `start_date <= now <= end_date` (or no end date but started)
  - ended: `end_date < now`
- `registration_attendance_rate`: attendance / registrations per event.
- `no_show_rate`: (registrations - attendance) / registrations.

## Attendance
- `total_attendance_trend`: sum per `event_attendance_summary.date`.
- `adult_children_youth_mix`: aggregate summary fields.
- `male_female_mix`: aggregate male/female fields.
- `avg_attendance_per_event`: total attendance / distinct events.
- `visiting_pastors_trend`: sum `visitingPastors` over time.

## Appointments
- `bookings_trend`: count by `appointment.date`.
- `status_mix`: breakdown by `status`.
- `confirmation_rate`: confirmed / total.
- `cancellation_rate`: cancelled / total.
- `slot_utilization_rate`:
  - numerator: booked sessions (non-cancelled)
  - denominator: available sessions from availability schedule

## Assets
- `asset_count`: count and status split.
- `asset_value_total`: sum `price`.
- `asset_value_by_department`: grouped sum.
- `asset_age_distribution`: by `date_purchased` age buckets.
- `procurement_trend`: count/sum by `date_purchased` bucket.

## Marketplace
- `gmv_trend`: sum order item total by `created_at`.
- `orders_trend`: count distinct `order_id`.
- `aov`: GMV / orders.
- `payment_status_mix`: from `orders.payment_status`.
- `pending_reconciliation_exposure`: sum pending orders amount.

## School of Ministry
- `programs_cohorts_classes_count`: counts from programs/cohorts/courses.
- `enrollment_trend`: by `enrolledAt`.
- `capacity_utilization`: enrolled / capacity.
- `completion_rate`: completed enrollments / total enrollments.
- `assignment_outcome_mix`: PASS/FAIL/PENDING from progress/submissions.
- `instructor_load`: students/classes per instructor.

---

## 7) Client Adapter Pattern

Use one module orchestrator per analytics sub-nav.

```ts
type ModuleResult = {
  module: string;
  generated_at: string;
  filters_applied: Record<string, unknown>;
  metrics: Record<string, unknown>;
};

async function getMembershipAnalytics(ctx: {
  token: string;
  dateRange: { from: string; to: string };
  filters: Record<string, unknown>;
}): Promise<ModuleResult> {
  const [usersRes, statsRes] = await Promise.all([
    api.get("/user/list-users", {
      params: { page: 1, take: 5000 },
      headers: { Authorization: `Bearer ${ctx.token}` },
    }),
    api.get("/user/stats-users", {
      headers: { Authorization: `Bearer ${ctx.token}` },
    }),
  ]);

  const users = usersRes.data?.data ?? [];

  return {
    module: "membership",
    generated_at: new Date().toISOString(),
    filters_applied: ctx.filters,
    metrics: {
      // build normalized metrics here
      active_inactive_split: buildActiveInactive(users),
      gender_distribution: buildGender(statsRes.data),
    },
  };
}
```

### Recommended client data layer
- `api/`: raw endpoint clients
- `analytics/mappers/`: metric builders per module
- `analytics/types/`: normalized metric payload types
- `analytics/cache/`: query-key caching per module + filter hash

---

## 8) Performance Guidance

- Fetch independent endpoints in parallel.
- Cache raw responses by `module + filter hash + date_range`.
- Recompute derived metrics client-side without re-fetching when only chart type changes.
- For large datasets, prefer server paginated pulls and incremental aggregation in client.

---

## 9) Error Handling Contract (Client)

Handle these statuses explicitly:
- `400`: invalid query/filter shape.
- `401`: token/session issue.
- `404`: resource scope missing.
- `500`: server failure.

Fallback UX:
- show partial widgets if some metric calls fail.
- annotate widget with source endpoint failure details.

---

## 10) V1 Out-of-Scope (Do Not Block UI)

These should be hidden or marked "coming soon" in V1:
- Lifecycle transition funnel
- Lifecycle dwell time
- Appointment outcome analytics
- True historical workforce load timeseries

---

## 11) Quick Test Calls

```bash
# Attendance by event + date
curl -H "Authorization: Bearer <JWT>" \
  "<BASE_URL>/event/church-attendance?eventId=12&date=2026-02-20"

# Membership list
curl -H "Authorization: Bearer <JWT>" \
  "<BASE_URL>/user/list-users?page=1&take=100&membership_type=IN_HOUSE"

# Appointments status mix source
curl -H "Authorization: Bearer <JWT>" \
  "<BASE_URL>/appointment/bookings?date=2026-02-20"
```
