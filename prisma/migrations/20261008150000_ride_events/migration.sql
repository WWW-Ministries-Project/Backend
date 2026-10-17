/*
  Rides for any church event.

  Rides were for "this Sunday" only. A ride now belongs to one occurrence of a
  church event (`event_mgt`) — the Sunday service, a midweek service, a
  program — and a member can hold one ride per event. `service_date` stays as
  the event's day, which the reminder cron and the office overview key on.

  Pickup alerts move from (user, point, date) to (user, point, event): two
  events on one day are separate rides.

  Existing offers and alerts are matched to an event on the same day,
  preferring a SERVICE and then the earliest start; one with no event that day
  keeps a null `event_id` and drops out of the member views.

  Forward-only.
*/

-- AlterTable
ALTER TABLE `ride_offer` ADD COLUMN `event_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `ride_pickup_alert` ADD COLUMN `event_id` INTEGER NULL;

-- Backfill
UPDATE `ride_offer` o SET o.`event_id` = (
    SELECT e.`id` FROM `event_mgt` e
    WHERE DATE(e.`start_date`) = o.`service_date`
    ORDER BY (e.`event_type` = 'SERVICE') DESC, e.`start_time` ASC, e.`id` ASC
    LIMIT 1
);

-- Backfill
UPDATE `ride_pickup_alert` a SET a.`event_id` = (
    SELECT e.`id` FROM `event_mgt` e
    WHERE DATE(e.`start_date`) = a.`service_date`
    ORDER BY (e.`event_type` = 'SERVICE') DESC, e.`start_time` ASC, e.`id` ASC
    LIMIT 1
);

-- CreateIndex (before the old unique goes: it also backs the user_id foreign key)
CREATE UNIQUE INDEX `ride_pickup_alert_user_id_pickup_point_id_event_id_key` ON `ride_pickup_alert`(`user_id`, `pickup_point_id`, `event_id`);

-- DropIndex
DROP INDEX `ride_pickup_alert_user_id_pickup_point_id_service_date_key` ON `ride_pickup_alert`;

-- CreateIndex
CREATE INDEX `ride_pickup_alert_event_id_pickup_point_id_idx` ON `ride_pickup_alert`(`event_id`, `pickup_point_id`);

-- CreateIndex
CREATE INDEX `ride_offer_event_id_status_idx` ON `ride_offer`(`event_id`, `status`);

-- AddForeignKey
ALTER TABLE `ride_offer` ADD CONSTRAINT `ride_offer_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_pickup_alert` ADD CONSTRAINT `ride_pickup_alert_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
