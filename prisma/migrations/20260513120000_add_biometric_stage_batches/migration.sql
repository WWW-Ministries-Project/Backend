ALTER TABLE `event_biometric_import_job`
  ADD COLUMN `source_stage_batch_id` INTEGER NULL;

CREATE TABLE `event_biometric_stage_batch` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `source` VARCHAR(191) NOT NULL DEFAULT 'ZTECO_LIBRARY',
  `total_punches` INTEGER NOT NULL DEFAULT 0,
  `staged_punches` INTEGER NOT NULL DEFAULT 0,
  `duplicate_punches` INTEGER NOT NULL DEFAULT 0,
  `event_count` INTEGER NOT NULL DEFAULT 0,
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

  INDEX `event_biometric_stage_batch_status_created_idx`(`status`, `created_at`),
  INDEX `event_biometric_stage_batch_created_by_time_idx`(`created_by`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `event_biometric_stage_punch` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `batch_id` INTEGER NOT NULL,
  `device_id` INTEGER NULL,
  `device_ip` VARCHAR(191) NOT NULL,
  `device_port` VARCHAR(191) NULL,
  `device_user_id` VARCHAR(191) NOT NULL,
  `device_user_name` VARCHAR(191) NULL,
  `record_time` DATETIME(3) NOT NULL,
  `state` INTEGER NOT NULL DEFAULT -1,
  `source_fingerprint` VARCHAR(191) NOT NULL,
  `raw_payload` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `event_biometric_stage_punch_batch_fingerprint_key`(`batch_id`, `source_fingerprint`),
  INDEX `event_biometric_stage_punch_batch_time_idx`(`batch_id`, `record_time`),
  INDEX `event_biometric_stage_punch_device_time_idx`(`device_ip`, `record_time`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_biometric_import_job`
  ADD INDEX `event_biometric_import_job_stage_batch_idx`(`source_stage_batch_id`);

ALTER TABLE `event_biometric_import_job`
  ADD CONSTRAINT `event_biometric_import_job_source_stage_batch_id_fkey`
    FOREIGN KEY (`source_stage_batch_id`) REFERENCES `event_biometric_stage_batch`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `event_biometric_stage_batch`
  ADD CONSTRAINT `event_biometric_stage_batch_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `event_biometric_stage_punch`
  ADD CONSTRAINT `event_biometric_stage_punch_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `event_biometric_stage_batch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
