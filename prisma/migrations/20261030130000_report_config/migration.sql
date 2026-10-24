-- Report configuration (Settings › General configuration › Reports): one row.
-- CreateTable
CREATE TABLE `report_config` (
    `id` INTEGER NOT NULL,
    `owners` JSON NULL,
    `dept_attendance_due_day` INTEGER NOT NULL DEFAULT 5,
    `dept_attendance_disabled_department_ids` JSON NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
