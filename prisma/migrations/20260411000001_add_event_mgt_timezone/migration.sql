-- AlterTable: add timezone to event_mgt
ALTER TABLE `event_mgt` ADD COLUMN `timezone` VARCHAR(191) NULL DEFAULT 'UTC';
