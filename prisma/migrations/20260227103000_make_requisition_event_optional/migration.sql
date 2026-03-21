-- DropForeignKey
ALTER TABLE `request` DROP FOREIGN KEY `request_event_id_fkey`;

-- AlterTable
ALTER TABLE `request` MODIFY `event_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `request` ADD CONSTRAINT `request_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
