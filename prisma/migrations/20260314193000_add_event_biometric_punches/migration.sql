CREATE TABLE `event_biometric_punch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_mgt_id` INTEGER NOT NULL,
    `device_id` INTEGER NULL,
    `device_ip` VARCHAR(191) NOT NULL,
    `device_port` VARCHAR(191) NULL,
    `device_user_id` VARCHAR(191) NOT NULL,
    `device_user_name` VARCHAR(191) NULL,
    `matched_user_id` INTEGER NULL,
    `matched_member_id` VARCHAR(191) NULL,
    `matched_user_name` VARCHAR(191) NULL,
    `record_time` DATETIME(3) NOT NULL,
    `state` INTEGER NOT NULL DEFAULT -1,
    `raw_payload` JSON NOT NULL,
    `imported_by` INTEGER NOT NULL,
    `imported_by_name` VARCHAR(191) NOT NULL,
    `imported_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_biometric_punch_event_device_user_time_state_key`(`event_mgt_id`, `device_ip`, `device_user_id`, `record_time`, `state`),
    INDEX `event_biometric_punch_event_time_idx`(`event_mgt_id`, `record_time`),
    INDEX `event_biometric_punch_matched_user_time_idx`(`matched_user_id`, `record_time`),
    INDEX `event_biometric_punch_imported_by_time_idx`(`imported_by`, `imported_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_biometric_punch`
    ADD CONSTRAINT `event_biometric_punch_event_mgt_id_fkey`
    FOREIGN KEY (`event_mgt_id`) REFERENCES `event_mgt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `event_biometric_punch`
    ADD CONSTRAINT `event_biometric_punch_matched_user_id_fkey`
    FOREIGN KEY (`matched_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `event_biometric_punch`
    ADD CONSTRAINT `event_biometric_punch_imported_by_fkey`
    FOREIGN KEY (`imported_by`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
