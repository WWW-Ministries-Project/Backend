CREATE TABLE `attendance_timing_settings` (
    `id` INTEGER NOT NULL,
    `early_value` INTEGER NOT NULL DEFAULT 15,
    `early_unit` ENUM('MINUTES', 'HOURS') NOT NULL DEFAULT 'MINUTES',
    `on_time_value` INTEGER NOT NULL DEFAULT 15,
    `on_time_unit` ENUM('MINUTES', 'HOURS') NOT NULL DEFAULT 'MINUTES',
    `late_value` INTEGER NOT NULL DEFAULT 15,
    `late_unit` ENUM('MINUTES', 'HOURS') NOT NULL DEFAULT 'MINUTES',
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_timing_settings_updated_by_idx`(`updated_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_timing_settings`
ADD CONSTRAINT `attendance_timing_settings_updated_by_fk`
FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;
