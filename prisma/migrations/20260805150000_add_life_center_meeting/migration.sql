-- CreateTable
CREATE TABLE `life_center_meeting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lifeCenterId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `offeringAmount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `note` TEXT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `life_center_meeting_lifeCenterId_idx`(`lifeCenterId`),
    INDEX `life_center_meeting_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `life_center_meeting_attendee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `soulWonId` INTEGER NOT NULL,
    `isFirstTimer` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `life_center_meeting_attendee_meetingId_soulWonId_key`(`meetingId`, `soulWonId`),
    INDEX `life_center_meeting_attendee_meetingId_idx`(`meetingId`),
    INDEX `life_center_meeting_attendee_soulWonId_idx`(`soulWonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `life_center_meeting` ADD CONSTRAINT `life_center_meeting_lifeCenterId_fkey` FOREIGN KEY (`lifeCenterId`) REFERENCES `life_center`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_meeting` ADD CONSTRAINT `life_center_meeting_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_meeting_attendee` ADD CONSTRAINT `life_center_meeting_attendee_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `life_center_meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_meeting_attendee` ADD CONSTRAINT `life_center_meeting_attendee_soulWonId_fkey` FOREIGN KEY (`soulWonId`) REFERENCES `soul_won`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
