CREATE TABLE `event_biometric_import_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_mgt_id` INTEGER NOT NULL,
    `occurrence_date` DATETIME(3) NOT NULL,
    `dry_run` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `progress_percentage` INTEGER NOT NULL DEFAULT 0,
    `current_step` VARCHAR(191) NULL,
    `progress_payload` JSON NULL,
    `request_payload` JSON NOT NULL,
    `result_payload` JSON NULL,
    `error_message` TEXT NULL,
    `created_by` INTEGER NOT NULL,
    `created_by_name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `event_biometric_import_job_event_date_idx`(`event_mgt_id`, `occurrence_date`),
    INDEX `event_biometric_import_job_status_created_idx`(`status`, `created_at`),
    INDEX `event_biometric_import_job_created_by_time_idx`(`created_by`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_biometric_import_job`
    ADD CONSTRAINT `event_biometric_import_job_event_mgt_id_fkey`
    FOREIGN KEY (`event_mgt_id`) REFERENCES `event_mgt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `event_biometric_import_job`
    ADD CONSTRAINT `event_biometric_import_job_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
