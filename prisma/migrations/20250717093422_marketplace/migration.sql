/*
  Warnings:

  - You are about to drop the column `instructor` on the `course` table. All the data in the column will be lost.
  - You are about to drop the column `courseId` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `enrollment` table. All the data in the column will be lost.
  - You are about to drop the column `eligibility` on the `program` table. All the data in the column will be lost.
  - The values [MEMBER,VISITOR] on the enum `user_membership_type` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[user_id,course_id]` on the table `enrollment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[spouse_id]` on the table `user` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[payment_info_token]` on the table `user_info` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `course_id` to the `enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `event_act_id` to the `event_mgt` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `enrollment` DROP FOREIGN KEY `enrollment_courseId_fkey`;

-- DropForeignKey
ALTER TABLE `enrollment` DROP FOREIGN KEY `enrollment_userId_fkey`;

-- DropForeignKey
ALTER TABLE `follow_up` DROP FOREIGN KEY `follow_up_userId_fkey`;

-- DropForeignKey
ALTER TABLE `follow_up` DROP FOREIGN KEY `follow_up_visitorId_fkey`;

-- DropForeignKey
ALTER TABLE `note` DROP FOREIGN KEY `note_userId_fkey`;

-- DropForeignKey
ALTER TABLE `note` DROP FOREIGN KEY `note_visitorId_fkey`;

-- DropForeignKey
ALTER TABLE `prayer_request` DROP FOREIGN KEY `prayer_request_userId_fkey`;

-- DropForeignKey
ALTER TABLE `prayer_request` DROP FOREIGN KEY `prayer_request_visitorId_fkey`;

-- DropForeignKey
ALTER TABLE `visit` DROP FOREIGN KEY `visit_visitorId_fkey`;

-- DropIndex
DROP INDEX `enrollment_email_courseId_key` ON `enrollment`;

-- DropIndex
DROP INDEX `enrollment_userId_courseId_key` ON `enrollment`;

-- AlterTable
ALTER TABLE `assets` ADD COLUMN `asset_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `course` DROP COLUMN `instructor`,
    ADD COLUMN `instructorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `enrollment` DROP COLUMN `courseId`,
    DROP COLUMN `email`,
    DROP COLUMN `firstName`,
    DROP COLUMN `lastName`,
    DROP COLUMN `phone`,
    DROP COLUMN `userId`,
    ADD COLUMN `course_id` INTEGER NOT NULL,
    ADD COLUMN `user_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `event_mgt` ADD COLUMN `event_act_id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `program` DROP COLUMN `eligibility`;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `spouse_id` INTEGER NULL,
    MODIFY `membership_type` ENUM('ONLINE', 'IN_HOUSE') NULL;

-- AlterTable
ALTER TABLE `user_emergency_contact` ADD COLUMN `country_code` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `user_info` ADD COLUMN `payment_info_token` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `visitor` ADD COLUMN `country_code` VARCHAR(191) NULL,
    ADD COLUMN `otherName` VARCHAR(191) NULL,
    ADD COLUMN `title` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `event_act` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_name` VARCHAR(191) NULL DEFAULT 'event_name',
    `event_status` ENUM('CONFIRMED', 'TENTATIVE') NULL,
    `event_type` ENUM('ACTIVITY', 'PROGRAM', 'SERVICE', 'OTHER') NULL,
    `event_description` VARCHAR(191) NULL DEFAULT 'event_description',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `life_center_role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `life_center` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `meetingLocation` VARCHAR(191) NOT NULL,
    `meetingDays` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `life_center_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `lifeCenterId` INTEGER NOT NULL,
    `roleId` INTEGER NOT NULL,

    UNIQUE INDEX `life_center_member_userId_lifeCenterId_key`(`userId`, `lifeCenterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `soul_won` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `other_name` VARCHAR(191) NULL,
    `contact_number` VARCHAR(191) NOT NULL,
    `contact_email` VARCHAR(191) NULL,
    `country_code` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `date_won` DATETIME(3) NOT NULL,
    `wonById` INTEGER NOT NULL,
    `lifeCenterId` INTEGER NOT NULL,

    UNIQUE INDEX `soul_won_id_key`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_name` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(191) NOT NULL,
    `port` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_positions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `department_id` INTEGER NOT NULL,
    `position_id` INTEGER NULL,

    INDEX `department_positions_user_id_idx`(`user_id`),
    INDEX `department_positions_department_id_idx`(`department_id`),
    INDEX `department_positions_position_id_idx`(`position_id`),
    UNIQUE INDEX `department_positions_user_id_department_id_key`(`user_id`, `department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `markets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `event_act_id` INTEGER NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,
    `updated_at_id` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `published` BOOLEAN NOT NULL DEFAULT false,
    `product_typeId` INTEGER NULL,
    `product_categoryId` INTEGER NULL,
    `colours` VARCHAR(191) NULL,
    `priceCurrency` VARCHAR(191) NULL,
    `priceAmount` DOUBLE NULL,
    `sizes` VARCHAR(191) NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,
    `updated_at_id` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `enrollment_user_id_course_id_key` ON `enrollment`(`user_id`, `course_id`);

-- CreateIndex
CREATE UNIQUE INDEX `user_spouse_id_key` ON `user`(`spouse_id`);

-- CreateIndex
CREATE UNIQUE INDEX `user_info_payment_info_token_key` ON `user_info`(`payment_info_token`);

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_spouse_id_fkey` FOREIGN KEY (`spouse_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_mgt` ADD CONSTRAINT `event_mgt_event_act_id_fkey` FOREIGN KEY (`event_act_id`) REFERENCES `event_act`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course` ADD CONSTRAINT `course_instructorId_fkey` FOREIGN KEY (`instructorId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollment` ADD CONSTRAINT `enrollment_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollment` ADD CONSTRAINT `enrollment_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `course`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `visit` ADD CONSTRAINT `visit_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_up` ADD CONSTRAINT `follow_up_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_up` ADD CONSTRAINT `follow_up_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_request` ADD CONSTRAINT `prayer_request_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_request` ADD CONSTRAINT `prayer_request_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_member` ADD CONSTRAINT `life_center_member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_member` ADD CONSTRAINT `life_center_member_lifeCenterId_fkey` FOREIGN KEY (`lifeCenterId`) REFERENCES `life_center`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_member` ADD CONSTRAINT `life_center_member_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `life_center_role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `soul_won` ADD CONSTRAINT `soulwon_wonby_fkey` FOREIGN KEY (`wonById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `soul_won` ADD CONSTRAINT `soulwon_lifecenter_fkey` FOREIGN KEY (`lifeCenterId`) REFERENCES `life_center`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_positions` ADD CONSTRAINT `department_positions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_positions` ADD CONSTRAINT `department_positions_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_positions` ADD CONSTRAINT `department_positions_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `position`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `markets` ADD CONSTRAINT `markets_event_act_id_fkey` FOREIGN KEY (`event_act_id`) REFERENCES `event_act`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_product_typeId_fkey` FOREIGN KEY (`product_typeId`) REFERENCES `product_type`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_product_categoryId_fkey` FOREIGN KEY (`product_categoryId`) REFERENCES `product_category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
