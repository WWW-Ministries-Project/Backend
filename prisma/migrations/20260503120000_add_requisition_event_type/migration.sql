ALTER TABLE `request` ADD COLUMN `event_type_id` INTEGER NULL;

CREATE INDEX `request_event_type_id_fkey` ON `request`(`event_type_id`);

ALTER TABLE `request` ADD CONSTRAINT `request_event_type_id_fkey`
  FOREIGN KEY (`event_type_id`) REFERENCES `event_act`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
