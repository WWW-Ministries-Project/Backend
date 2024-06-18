/*
  Warnings:

  - You are about to drop the column `name` on the `user_info` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `user_info` DROP COLUMN `name`,
    ADD COLUMN `emergency_contact_id` INTEGER NULL,
    ADD COLUMN `first_name` VARCHAR(191) NULL,
    ADD COLUMN `last_name` VARCHAR(191) NULL,
    ADD COLUMN `marital_status` ENUM('SINGLE', 'MARRIED') NULL,
    ADD COLUMN `nationality` VARCHAR(191) NULL,
    ADD COLUMN `other_name` VARCHAR(191) NULL,
    ADD COLUMN `work_info_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `user_work_info` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name_of_institution` VARCHAR(191) NOT NULL,
    `industry` VARCHAR(191) NOT NULL,
    `Position` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_emergency_contact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `relation` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_info` ADD CONSTRAINT `user_info_work_info_id_fkey` FOREIGN KEY (`work_info_id`) REFERENCES `user_work_info`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_info` ADD CONSTRAINT `user_info_emergency_contact_id_fkey` FOREIGN KEY (`emergency_contact_id`) REFERENCES `user_emergency_contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
