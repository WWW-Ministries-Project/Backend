-- AlterTable: add recurrence_series_id to event_mgt
ALTER TABLE `event_mgt` ADD COLUMN `recurrence_series_id` VARCHAR(191) NULL;

-- CreateIndex for recurrence_series_id
CREATE INDEX `event_mgt_recurrence_series_id_idx` ON `event_mgt`(`recurrence_series_id`);

-- CreateTable: event_reminder
CREATE TABLE `event_reminder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `remind_at` DATETIME(3) NOT NULL,
    `offset_minutes` INTEGER NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'in_app',
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_reminder_remind_at_status_idx`(`remind_at`, `status`),
    INDEX `event_reminder_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_reminder` ADD CONSTRAINT `event_reminder_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
