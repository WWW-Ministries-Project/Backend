CREATE TABLE IF NOT EXISTS `availability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `day` VARCHAR(191) NOT NULL,
    `maxBookingsPerSlot` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `sessionDurationMinutes` INTEGER NOT NULL DEFAULT 30,
    `userId` INTEGER NOT NULL,

    INDEX `availability_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `availability_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_slot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `start` VARCHAR(191) NOT NULL,
    `end` VARCHAR(191) NOT NULL,
    `availabilityId` INTEGER NOT NULL,

    INDEX `session_slot_availabilityId_fkey`(`availabilityId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `session_slot_availabilityId_fkey`
        FOREIGN KEY (`availabilityId`) REFERENCES `availability`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `appointment` (
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
    PRIMARY KEY (`id`),
    CONSTRAINT `appointment_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
