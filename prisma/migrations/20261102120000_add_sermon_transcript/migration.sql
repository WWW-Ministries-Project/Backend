-- CreateTable
CREATE TABLE `sermon_transcript` (
    `video_id` VARCHAR(191) NOT NULL,
    `segments` JSON NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
