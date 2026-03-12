ALTER TABLE `in_app_notification`
    ADD COLUMN `sms_delivery_status` ENUM('PENDING', 'PROCESSING', 'SENT', 'DEAD') NULL,
    ADD COLUMN `sms_queued_at` DATETIME(3) NULL,
    ADD COLUMN `sms_last_attempt_at` DATETIME(3) NULL,
    ADD COLUMN `sms_sent_at` DATETIME(3) NULL,
    ADD COLUMN `sms_last_error_code` VARCHAR(64) NULL,
    ADD COLUMN `sms_last_error_message` VARCHAR(1024) NULL;

ALTER TABLE `notification_preference`
    ADD COLUMN `sms_enabled` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `notification_sms_delivery_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `notification_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `notification_type` VARCHAR(191) NOT NULL,
    `dedupe_key` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `phone_number` VARCHAR(32) NOT NULL,
    `message` VARCHAR(2000) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SENT', 'DEAD') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` VARCHAR(1024) NULL,
    `last_error_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_sms_delivery_jobs_notification_id_key`(`notification_id`),
    UNIQUE INDEX `notification_sms_delivery_jobs_idempotency_key_key`(`idempotency_key`),
    INDEX `notification_sms_delivery_jobs_status_next_attempt_idx`(`status`, `next_attempt_at`),
    INDEX `notification_sms_delivery_jobs_user_idx`(`user_id`),
    INDEX `notification_sms_delivery_jobs_type_idx`(`notification_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_sms_delivery_jobs`
    ADD CONSTRAINT `notification_sms_delivery_jobs_notification_id_fkey`
    FOREIGN KEY (`notification_id`) REFERENCES `in_app_notification`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notification_sms_delivery_jobs`
    ADD CONSTRAINT `notification_sms_delivery_jobs_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
