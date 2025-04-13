/*
  Warnings:

  - A unique constraint covering the columns `[email,courseId]` on the table `enrollment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `email` to the `enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `enrollment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `enrollment` ADD COLUMN `email` VARCHAR(191) NOT NULL,
    ADD COLUMN `firstName` VARCHAR(191) NOT NULL,
    ADD COLUMN `lastName` VARCHAR(191) NOT NULL,
    ADD COLUMN `phone` VARCHAR(191) NOT NULL,
    MODIFY `userId` INTEGER NULL;

-- AlterTable
ALTER TABLE `program` ADD COLUMN `leader_required` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `member_required` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ministry_required` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `mode` ENUM('In_Person', 'Online', 'Hybrid') NULL,
    MODIFY `status` ENUM('UNCONFIRMED', 'CONFIRMED', 'MEMBER') NULL;

-- CreateTable
CREATE TABLE `progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `topicId` INTEGER NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('FAIL', 'PASS', 'PENDING') NOT NULL DEFAULT 'PENDING',
    `completedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,

    UNIQUE INDEX `progress_enrollmentId_topicId_key`(`enrollmentId`, `topicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `visitor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `zipCode` VARCHAR(191) NULL,
    `visitDate` DATETIME(3) NOT NULL,
    `is_member` BOOLEAN NOT NULL DEFAULT false,
    `howHeard` VARCHAR(191) NULL,
    `consentToContact` BOOLEAN NOT NULL DEFAULT false,
    `membershipWish` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `visitor_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `visit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitorId` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,
    `eventId` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_up` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitorId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `notes` VARCHAR(191) NULL,
    `assignedTo` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prayer_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitorId` INTEGER NULL,
    `userId` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,
    `request` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `note` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitorId` INTEGER NULL,
    `userId` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,
    `author` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `enrollment_email_courseId_key` ON `enrollment`(`email`, `courseId`);

-- AddForeignKey
ALTER TABLE `progress` ADD CONSTRAINT `progress_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress` ADD CONSTRAINT `progress_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `visit` ADD CONSTRAINT `visit_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `visit` ADD CONSTRAINT `visit_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `event_mgt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_up` ADD CONSTRAINT `follow_up_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_up` ADD CONSTRAINT `follow_up_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_request` ADD CONSTRAINT `prayer_request_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_request` ADD CONSTRAINT `prayer_request_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `visitor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `note` ADD CONSTRAINT `note_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
