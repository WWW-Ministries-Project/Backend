/*
  Warnings:

  - You are about to drop the column `event_act_id` on the `event_mgt` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `event_mgt` table. All the data in the column will be lost.
  - You are about to drop the column `event_act_id` on the `markets` table. All the data in the column will be lost.
  - You are about to drop the column `image` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `priceAmount` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `priceCurrency` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `product_categoryId` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `product_typeId` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `published` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `sizes` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `stock` on the `products` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `markets` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `event_name_id` to the `event_mgt` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `event_mgt` DROP FOREIGN KEY `event_mgt_event_act_id_fkey`;

-- DropForeignKey
ALTER TABLE `markets` DROP FOREIGN KEY `markets_event_act_id_fkey`;

-- DropForeignKey
ALTER TABLE `products` DROP FOREIGN KEY `products_product_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `products` DROP FOREIGN KEY `products_product_typeId_fkey`;

-- DropIndex
DROP INDEX `event_mgt_event_act_id_fkey` ON `event_mgt`;

-- DropIndex
DROP INDEX `markets_event_act_id_fkey` ON `markets`;

-- DropIndex
DROP INDEX `products_product_categoryId_fkey` ON `products`;

-- DropIndex
DROP INDEX `products_product_typeId_fkey` ON `products`;

-- AlterTable
ALTER TABLE `enrollment` ADD COLUMN `completed` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `completedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `event_mgt` DROP COLUMN `event_act_id`,
    DROP COLUMN `name`,
    ADD COLUMN `event_name_id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `markets` DROP COLUMN `event_act_id`,
    ADD COLUMN `event_mgt_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `products` DROP COLUMN `image`,
    DROP COLUMN `priceAmount`,
    DROP COLUMN `priceCurrency`,
    DROP COLUMN `product_categoryId`,
    DROP COLUMN `product_typeId`,
    DROP COLUMN `published`,
    DROP COLUMN `sizes`,
    DROP COLUMN `stock`,
    ADD COLUMN `image_url` VARCHAR(191) NULL,
    ADD COLUMN `market_id` INTEGER NULL,
    ADD COLUMN `price_amount` DOUBLE NULL,
    ADD COLUMN `price_currency` VARCHAR(191) NULL,
    ADD COLUMN `product_category_id` INTEGER NULL,
    ADD COLUMN `product_type_id` INTEGER NULL,
    ADD COLUMN `status` VARCHAR(191) NULL DEFAULT 'draft',
    ADD COLUMN `stock_managed` VARCHAR(191) NOT NULL DEFAULT 'no';

-- AlterTable
ALTER TABLE `progress` ADD COLUMN `completed` BOOLEAN NULL DEFAULT false;

-- AlterTable
ALTER TABLE `topic` ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `order_number` INTEGER NULL;

-- CreateTable
CREATE TABLE `family_relation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `family_id` INTEGER NOT NULL,
    `relation` VARCHAR(191) NOT NULL,

    INDEX `family_relation_family_id_fkey`(`family_id`),
    UNIQUE INDEX `family_relation_user_id_family_id_key`(`user_id`, `family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_attendance_summary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_mgt_id` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `group` ENUM('ADULTS', 'CHILDREN', 'BOTH') NOT NULL DEFAULT 'BOTH',
    `adultMale` INTEGER NOT NULL DEFAULT 0,
    `adultFemale` INTEGER NOT NULL DEFAULT 0,
    `childrenMale` INTEGER NOT NULL DEFAULT 0,
    `childrenFemale` INTEGER NOT NULL DEFAULT 0,
    `recordedBy` INTEGER NOT NULL,
    `recordedByName` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    INDEX `event_attendance_summary_event_mgt_id_idx`(`event_mgt_id`),
    INDEX `event_attendance_summary_date_idx`(`date`),
    INDEX `event_attendance_summary_recordedBy_fkey`(`recordedBy`),
    UNIQUE INDEX `event_attendance_summary_event_mgt_id_date_key`(`event_mgt_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_registers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_attendance_event_id_fkey`(`event_id`),
    INDEX `event_attendance_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningUnit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topicId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `maxAttempts` INTEGER NULL DEFAULT 3,

    UNIQUE INDEX `LearningUnit_topicId_key`(`topicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cohort_assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cohortId` INTEGER NOT NULL,
    `learningUnitId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `activatedAt` DATETIME(3) NULL,
    `dueDate` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,

    INDEX `cohort_assignment_learningUnitId_fkey`(`learningUnitId`),
    UNIQUE INDEX `cohort_assignment_cohortId_learningUnitId_key`(`cohortId`, `learningUnitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_submission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `learningUnitId` INTEGER NOT NULL,
    `content` LONGTEXT NULL,
    `fileUrl` VARCHAR(191) NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('SUBMITTED', 'RESUBMITTED', 'GRADED', 'RETURNED') NOT NULL DEFAULT 'SUBMITTED',
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `score` INTEGER NULL,
    `feedback` VARCHAR(191) NULL,
    `gradedById` INTEGER NULL,
    `gradedAt` DATETIME(3) NULL,

    INDEX `assignment_submission_enrollmentId_learningUnitId_idx`(`enrollmentId`, `learningUnitId`),
    INDEX `assignment_submission_gradedById_fkey`(`gradedById`),
    INDEX `assignment_submission_learningUnitId_fkey`(`learningUnitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sizes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,
    `updated_at_id` INTEGER NULL,

    UNIQUE INDEX `sizes_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_colour` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colour` VARCHAR(191) NULL,
    `image_url` VARCHAR(191) NULL,
    `product_id` INTEGER NOT NULL,

    INDEX `product_colour_product_id_fkey`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_stock` (
    `product_colour_id` INTEGER NOT NULL,
    `size_id` INTEGER NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,

    INDEX `product_stock_product_colour_id_fkey`(`product_colour_id`),
    PRIMARY KEY (`size_id`, `product_colour_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_number` VARCHAR(191) NULL,
    `total_amount` DOUBLE NOT NULL,
    `user_id` INTEGER NULL,
    `payment_status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `delivery_status` ENUM('pending', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,

    INDEX `orders_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `market_id` INTEGER NULL,
    `product_id` INTEGER NULL,
    `price_amount` DOUBLE NOT NULL,
    `price_currency` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `product_type` VARCHAR(191) NOT NULL,
    `product_category` VARCHAR(191) NOT NULL,
    `image_url` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NOT NULL,

    INDEX `order_items_market_id_fkey`(`market_id`),
    INDEX `order_items_order_id_fkey`(`order_id`),
    INDEX `order_items_product_id_fkey`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_details` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `country_code` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `billing_details_order_id_key`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `programId` INTEGER NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `certificateNumber` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `certificate_certificateNumber_key`(`certificateNumber`),
    INDEX `certificate_programId_fkey`(`programId`),
    UNIQUE INDEX `certificate_userId_programId_key`(`userId`, `programId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnualTheme` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `verseReference` VARCHAR(191) NOT NULL,
    `verse` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AnnualTheme_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `availability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `day` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `sessionDurationMinutes` INTEGER NOT NULL DEFAULT 30,
    `userId` INTEGER NOT NULL,
    `maxBookingsPerSlot` INTEGER NOT NULL,

    INDEX `availability_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session_slot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `start` VARCHAR(191) NOT NULL,
    `end` VARCHAR(191) NOT NULL,
    `availabilityId` INTEGER NOT NULL,

    INDEX `session_slot_availabilityId_fkey`(`availabilityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` INTEGER NOT NULL,

    INDEX `appointment_email_idx`(`email`),
    INDEX `appointment_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paymentConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bankAccountConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `percentage` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receiptConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `financeData` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `metaData` JSON NULL,
    `receipts` JSON NULL,
    `tithe` JSON NULL,
    `payments` JSON NULL,
    `balance` JSON NULL,
    `fundsAllocation` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `event_mgt_event_name_id_fkey` ON `event_mgt`(`event_name_id`);

-- CreateIndex
CREATE UNIQUE INDEX `markets_name_key` ON `markets`(`name`);

-- CreateIndex
CREATE INDEX `markets_event_mgt_id_fkey` ON `markets`(`event_mgt_id`);

-- CreateIndex
CREATE INDEX `products_market_id_fkey` ON `products`(`market_id`);

-- CreateIndex
CREATE INDEX `products_product_category_id_fkey` ON `products`(`product_category_id`);

-- CreateIndex
CREATE INDEX `products_product_type_id_fkey` ON `products`(`product_type_id`);

-- AddForeignKey
ALTER TABLE `family_relation` ADD CONSTRAINT `family_relation_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_relation` ADD CONSTRAINT `family_relation_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_mgt` ADD CONSTRAINT `event_mgt_event_name_id_fkey` FOREIGN KEY (`event_name_id`) REFERENCES `event_act`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_attendance_summary` ADD CONSTRAINT `event_attendance_summary_event_mgt_id_fkey` FOREIGN KEY (`event_mgt_id`) REFERENCES `event_mgt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_attendance_summary` ADD CONSTRAINT `event_attendance_summary_recordedBy_fkey` FOREIGN KEY (`recordedBy`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_registers` ADD CONSTRAINT `event_registers_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_registers` ADD CONSTRAINT `event_registers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningUnit` ADD CONSTRAINT `LearningUnit_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cohort_assignment` ADD CONSTRAINT `cohort_assignment_cohortId_fkey` FOREIGN KEY (`cohortId`) REFERENCES `cohort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cohort_assignment` ADD CONSTRAINT `cohort_assignment_learningUnitId_fkey` FOREIGN KEY (`learningUnitId`) REFERENCES `LearningUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submission` ADD CONSTRAINT `assignment_submission_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submission` ADD CONSTRAINT `assignment_submission_gradedById_fkey` FOREIGN KEY (`gradedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_submission` ADD CONSTRAINT `assignment_submission_learningUnitId_fkey` FOREIGN KEY (`learningUnitId`) REFERENCES `LearningUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `markets` ADD CONSTRAINT `markets_event_mgt_id_fkey` FOREIGN KEY (`event_mgt_id`) REFERENCES `event_mgt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_market_id_fkey` FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_product_category_id_fkey` FOREIGN KEY (`product_category_id`) REFERENCES `product_category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_product_type_id_fkey` FOREIGN KEY (`product_type_id`) REFERENCES `product_type`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_colour` ADD CONSTRAINT `product_colour_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_stock` ADD CONSTRAINT `product_stock_product_colour_id_fkey` FOREIGN KEY (`product_colour_id`) REFERENCES `product_colour`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_stock` ADD CONSTRAINT `product_stock_size_id_fkey` FOREIGN KEY (`size_id`) REFERENCES `sizes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_market_id_fkey` FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `billing_details` ADD CONSTRAINT `billing_details_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificate` ADD CONSTRAINT `certificate_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificate` ADD CONSTRAINT `certificate_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability` ADD CONSTRAINT `availability_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_slot` ADD CONSTRAINT `session_slot_availabilityId_fkey` FOREIGN KEY (`availabilityId`) REFERENCES `availability`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment` ADD CONSTRAINT `appointment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
