-- AlterTable
ALTER TABLE `event_mgt` ADD COLUMN `event_status` ENUM('CONFIRMED', 'TENTATIVE') NULL,
    ADD COLUMN `event_type` ENUM('ACTIVITY', 'PROGRAM', 'SERVICE') NULL;
