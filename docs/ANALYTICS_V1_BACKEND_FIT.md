# Analytics V1 Backend Fit

## Scope
- No schema changes.
- No new analytics module.
- No new aggregate endpoint.
- Use current routes and normalize response on the client side.

## V1 Modules and Tabs

### Membership
1. Growth and Health
2. Spiritual and Ministry Engagement
3. Demographics
4. Pastoral Care
5. Workforce Snapshot
6. Onboarding Snapshot
7. Geographic Outreach
8. Data Quality
9. Lifecycle Snapshot

### Visitors
1. Acquisition
2. Engagement
3. Follow-up
4. Conversion
5. Data Quality

### Events
1. Event Portfolio
2. Registration vs Attendance
3. Type Performance
4. Seasonality

### Attendance
1. Trends
2. Demographics
3. Service Performance
4. Visitor Impact

### Appointments
1. Demand
2. Utilization
3. Status Mix
4. Staff Performance

### Assets
1. Portfolio Value
2. Assignment
3. Status Mix
4. Procurement

### Marketplace
1. Sales
2. Payments
3. Products
4. Customers
5. Reconciliation

### School of Ministry
1. Programs
2. Cohorts
3. Enrollment and Capacity
4. Learning Outcomes
5. Instructor Load

## Global Filters (V1)
- `date_range`
- `membership_type`
- `department_id`
- `country`
- `state_region`
- `city`
- `life_center_id` (where applicable)

### Excluded as Global in V1
- `campus/life_center` unified filter is not globally available across all modules.
- Use `life_center_id` only for life-center linked views.

## Existing Route Sources

### Membership
- `GET /user/list-users`
- `GET /user/filter-users-info`
- `GET /user/get-user`
- `GET /user/stats-users`

### Visitors
- `GET /visitor/visitors`
- `GET /visitor/visits`
- `GET /visitor/followups`
- `POST /visitor/convert-to-member`

### Events and Attendance
- `GET /event/list-events`
- `POST /event/register`
- `GET /event/get-registered-event-members`
- `GET /event/church-attendance`

Attendance analytics filtering supports:
- event-based: `GET /event/church-attendance?eventId=12`
- date-based: `GET /event/church-attendance?date=2026-02-20`
- combined: `GET /event/church-attendance?eventId=12&date=2026-02-20`

### Appointments
- `GET /appointment/bookings`
- `GET /appointment/availability`
- `GET /appointment/availability/status`

### Assets
- `GET /assets/list-assets`

### Marketplace
- `GET /orders/get-all-orders`
- `GET /orders/get-orders-by-market`
- `GET /market/list-markets`
- `GET /product/list-products`

### School of Ministry
- `GET /program/programs`
- `GET /program/cohorts`
- `GET /program/cohort-courses`
- `GET /program/courses` (alias; supports optional `page`/`take` and optional `cohortId`)
- `GET /program/user-enrollment`
- `GET /program/assignment-results`

## Metric Status and V1 Adjustments

## Membership
- `new_members_trend`: ready (`user.created_at`).
- `active_inactive_split`: ready (`user.is_active`).
- `onboarding_retention`: partial. Implement as snapshot retention by join cohort.
- `visitor_to_member_funnel`: partial. Use visitor `is_member=true` as conversion event.
- `program_participation_rate`: ready (enrollment over members).
- `ministry_involvement_rate`: ready (department/position/department_positions/life_center_member).
- `volunteer_participation_rate`: ready with proxy (life_center_member OR department_positions).
- `discipleship_completion_rate`: ready (completed enrollments / enrolled).
- `age_band_distribution`: ready.
- `gender_distribution`: ready.
- `marital_status_distribution`: ready.
- `nationality_location_distribution`: ready.
- `pastoral_risk_segments`: ready with field-based rules.
- `family_connection_coverage`: ready (`family_relation`).
- `emergency_contact_completeness`: ready (scored completeness).
- `employment_risk_proxy`: ready (`user_work_info.employment_status` and work fields).
- `volunteer_to_member_ratio`: ready with proxy definition.
- `leadership_density`: ready (`position_id` or leadership roles).
- `department_participation`: ready.
- `workforce_load_index`: partial as point-in-time (no historical membership timestamps).
- `first_90_day_integration_rate`: partial proxy using enrollment and ministry links.
- `time_to_first_engagement`: partial (first enrollment date available; department assignment has no timestamp).
- `first_year_retention_rate`: partial snapshot.
- `onboarding_completion_rate`: ready when onboarding program is configured.
- `geo_growth_hotspots`: ready.
- `diaspora_share`: ready.
- `online_vs_inhouse_reach`: ready.
- `geo_concentration_index`: ready.
- `profile_completeness_score`: ready.
- `critical_field_missing_rates`: ready.
- `duplicate_risk`: ready.
- `stale_profile_rate`: partial (`user.updated_at` exists, `user_info.updatedAt` not present).
- `lifecycle_stage_distribution`: ready with rule-based current-state classification.
- `stage_transition_funnel`: not in V1 (no stage history table).
- `stage_dwell_time`: not in V1 (no stage timestamps).
- `disengagement_risk_count`: partial rule-based.

## Visitors
- `new_visitors_trend`: ready.
- `repeat_visitor_rate`: ready (`visitCount > 1`).
- `source_mix`: ready (`howHeard`, visit event).
- `followup_status_mix`: ready.
- `visitor_to_member_conversion_rate`: partial (use `visitor.is_member`).

## Events
- `events_created_trend`: ready.
- `event_type_mix`: ready.
- `upcoming_active_ended_split`: ready.
- `registration_attendance_rate`: ready.
- `no_show_rate`: ready.

## Attendance
- `total_attendance_trend`: ready.
- `adult_children_youth_mix`: ready.
- `male_female_mix`: ready.
- `avg_attendance_per_event`: ready.
- `visiting_pastors_trend`: ready.

## Appointments
- `bookings_trend`: ready.
- `status_mix`: ready.
- `confirmation_rate`: ready.
- `completion_rate`: not in V1 (`COMPLETED` status does not exist).
- `slot_utilization_rate`: ready.
- `outcomes`: not in V1 (no outcome fields).

## Assets
- `asset_count`: ready.
- `asset_value_total`: ready.
- `asset_value_by_department`: ready.
- `asset_age_distribution`: ready.
- `procurement_trend`: ready.
- lifecycle history metrics: not in V1 (`asset_history` is not linked to asset id).

## Marketplace
- `gmv_trend`: ready.
- `orders_trend`: ready.
- `aov`: ready.
- `payment_status_mix`: ready.
- `pending_reconciliation_exposure`: ready.

## School of Ministry
- `programs_cohorts_classes_count`: ready.
- `enrollment_trend`: ready.
- `capacity_utilization`: ready.
- `completion_rate`: ready.
- `assignment_outcome_mix`: ready.
- `instructor_load`: ready.

## Normalized Frontend Response Shapes
Use these normalized shapes at the frontend analytics adapter layer:
- `timeseries`
- `breakdown`
- `ratio`
- `funnel`
- `distribution`
- `cohort`
- `score`

This keeps UI contracts stable while backend remains module-native in V1.

## Lifecycle Rules (V1 Server Logic)

```json
{
  "lifecycle_rules": {
    "visitor": "record exists in visitor and is_member=false",
    "new_member": "user.created_at within 90 days",
    "active_member": "user.is_active=true",
    "leader_worker": "position_id!=null OR department_positions exists OR life_center_member exists",
    "mature_member": "user.created_at older than 730 days AND status='MEMBER'",
    "disengaged": "user.is_active=false"
  }
}
```

## V1 Notes
- Conversion timestamps are currently inferred, not explicit.
- Retention metrics in V1 are snapshot-based unless historical state tracking is introduced.
- Attendance summary endpoint currently supports event-level and date filtering with `date`.
