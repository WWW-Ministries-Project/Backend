/*
  Appointments redesign.

  - appointment_status gains RESCHEDULED, DECLINED, COMPLETED and NO_SHOW.
  - appointment gains the picked reason id, reply fields (respondedAt,
    acceptedAt, proposed slot, decline reason, response message, remindedAt),
    a server-written JSON history, and one marker per scheduled notification
    so the 15-minute job sends each one once.
  - appointment_staff_profile: break between sessions + pause switch.
  - appointment_time_off: days a person takes no new bookings.
  - appointment_settings: singleton rules + notification matrix. No row means
    the defaults in code apply.

  Backfill: existing bookings get a first history line, and the job markers
  are set on old bookings so the first run does not alert admins about every
  stale request or prompt outcomes for long-past appointments. Forward-only.
*/

-- AlterTable
ALTER TABLE `appointment` ADD COLUMN `acceptedAt` DATETIME(3) NULL,
    ADD COLUMN `declineReason` VARCHAR(120) NULL,
    ADD COLUMN `history` JSON NULL,
    ADD COLUMN `nudgedAt` DATETIME(3) NULL,
    ADD COLUMN `outcomePromptedAt` DATETIME(3) NULL,
    ADD COLUMN `overdueNotifiedAt` DATETIME(3) NULL,
    ADD COLUMN `proposedDate` DATETIME(3) NULL,
    ADD COLUMN `proposedEndTime` VARCHAR(191) NULL,
    ADD COLUMN `proposedStartTime` VARCHAR(191) NULL,
    ADD COLUMN `reasonId` INTEGER NULL,
    ADD COLUMN `remindedAt` DATETIME(3) NULL,
    ADD COLUMN `reminderSentAt` DATETIME(3) NULL,
    ADD COLUMN `respondedAt` DATETIME(3) NULL,
    ADD COLUMN `responseMessage` TEXT NULL,
    ADD COLUMN `unansweredNotifiedAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'RESCHEDULED', 'DECLINED', 'CANCELLED', 'COMPLETED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE `appointment_staff_profile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `buffer_minutes` INTEGER NOT NULL DEFAULT 0,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `appointment_staff_profile_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_time_off` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `appointment_time_off_user_id_to_date_idx`(`user_id`, `to_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `reply_deadline_hours` INTEGER NOT NULL DEFAULT 24,
    `unanswered_after_hours` INTEGER NOT NULL DEFAULT 72,
    `min_notice_hours` INTEGER NOT NULL DEFAULT 12,
    `book_ahead_days` INTEGER NOT NULL DEFAULT 60,
    `reminder_hours` INTEGER NOT NULL DEFAULT 24,
    `cancel_cutoff_hours` INTEGER NOT NULL DEFAULT 12,
    `notifications` JSON NULL,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `appointment_status_created_at_idx` ON `appointment`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `appointment_status_date_idx` ON `appointment`(`status`, `date`);

-- AddForeignKey
ALTER TABLE `appointment_staff_profile` ADD CONSTRAINT `appointment_staff_profile_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_time_off` ADD CONSTRAINT `appointment_time_off_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: first history line for existing bookings
UPDATE `appointment`
SET `history` = JSON_ARRAY(
    JSON_OBJECT(
        'at', DATE_FORMAT(`createdAt`, '%Y-%m-%dT%H:%i:%s.000Z'),
        'text', CONCAT('Requested by ', `fullName`),
        'tone', 'neutral'
    )
)
WHERE `history` IS NULL;

-- Backfill: keep the first job run from alerting on stale requests
UPDATE `appointment`
SET `nudgedAt` = CURRENT_TIMESTAMP(3),
    `overdueNotifiedAt` = CURRENT_TIMESTAMP(3),
    `unansweredNotifiedAt` = CURRENT_TIMESTAMP(3)
WHERE `createdAt` < (CURRENT_TIMESTAMP(3) - INTERVAL 3 DAY);

-- Backfill: no reminders or outcome prompts for appointments already past
UPDATE `appointment`
SET `reminderSentAt` = CURRENT_TIMESTAMP(3),
    `outcomePromptedAt` = CURRENT_TIMESTAMP(3)
WHERE `date` < (CURRENT_DATE() - INTERVAL 1 DAY);
