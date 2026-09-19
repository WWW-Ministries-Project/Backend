/*
  Adds a category and a weekly schedule to `event_act` (the event *type* record
  created via POST /event/create-event-type, not a scheduled occurrence).

  `event_category` distinguishes a recurring fixture from a one-off and is
  rendered against the row's `event_type` — WEEKLY + SERVICE reads as "Weekly
  Service". Storing the enum rather than the composed label keeps the label
  correct when `event_type` is later edited.

  `schedule_day` is 0-6 with 0 = Sunday, matching JS getDay() and the weekday
  values the events UI already uses for recurrence. Times are "HH:mm" strings,
  consistent with event_mgt.start_time / end_time.

  All four columns are nullable and additive: existing rows need no backfill
  and callers posting the old payload keep working.
*/

-- AlterTable
ALTER TABLE `event_act`
    ADD COLUMN `event_category` ENUM('WEEKLY', 'SPECIAL') NULL,
    ADD COLUMN `schedule_day` INTEGER NULL,
    ADD COLUMN `schedule_start_time` VARCHAR(5) NULL,
    ADD COLUMN `schedule_end_time` VARCHAR(5) NULL;
