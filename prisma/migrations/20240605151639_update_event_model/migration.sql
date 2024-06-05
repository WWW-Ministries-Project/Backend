/*
  Warnings:

  - You are about to drop the column `date` on the `event_mgt` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `event_mgt` DROP COLUMN `date`,
    ADD COLUMN `end_date` DATETIME(3) NULL,
    ADD COLUMN `start_date` DATETIME(3) NULL,
    MODIFY `start_time` VARCHAR(191) NULL,
    MODIFY `end_time` VARCHAR(191) NULL;
