/*
  Attendance timing rules become versioned so that a change can apply either
  to new attendance only or back to a chosen month. The current rules are
  seeded as the first version with an epoch `effective_from`, so every
  existing attendance record keeps classifying against the rules that were
  saved before this migration (or the 15-minute defaults when none were).

  `event_report_exclusion` lists members hidden from event reports.

  Forward-only. Nothing is dropped or rewritten.
*/

-- CreateTable
CREATE TABLE `attendance_timing_rule_version` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `early_value` INTEGER NOT NULL,
    `early_unit` ENUM('MINUTES', 'HOURS') NOT NULL,
    `on_time_value` INTEGER NOT NULL,
    `on_time_unit` ENUM('MINUTES', 'HOURS') NOT NULL,
    `late_value` INTEGER NOT NULL,
    `late_unit` ENUM('MINUTES', 'HOURS') NOT NULL,
    `effective_from` DATETIME(3) NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_timing_rule_version_effective_from_idx`(`effective_from`),
    INDEX `attendance_timing_rule_version_created_by_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_exclusion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_report_exclusion_user_id_key`(`user_id`),
    INDEX `event_report_exclusion_created_by_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendance_timing_rule_version`
ADD CONSTRAINT `attendance_timing_rule_version_created_by_fk`
FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_exclusion`
ADD CONSTRAINT `event_report_exclusion_user_fk`
FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_exclusion`
ADD CONSTRAINT `event_report_exclusion_created_by_fk`
FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Seed the baseline version from the saved rules
INSERT INTO `attendance_timing_rule_version`
    (`early_value`, `early_unit`, `on_time_value`, `on_time_unit`, `late_value`, `late_unit`, `effective_from`, `created_by_user_id`, `created_at`)
SELECT `early_value`, `early_unit`, `on_time_value`, `on_time_unit`, `late_value`, `late_unit`, '1970-01-01 00:00:00.000', `updated_by_user_id`, `updated_at`
FROM `attendance_timing_settings`
WHERE `id` = 1;

INSERT INTO `attendance_timing_rule_version`
    (`early_value`, `early_unit`, `on_time_value`, `on_time_unit`, `late_value`, `late_unit`, `effective_from`)
SELECT 15, 'MINUTES', 15, 'MINUTES', 15, 'MINUTES', '1970-01-01 00:00:00.000'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `attendance_timing_rule_version`);
