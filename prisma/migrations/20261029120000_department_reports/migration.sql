-- Department report workflow (commentary, sign-off, comments, requests to leadership)
-- and event report sign-off (comments, activity trail).
-- CreateTable
CREATE TABLE `event_report_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_report_id` INTEGER NOT NULL,
    `author_user_id` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_report_comments_event_report_id_idx`(`event_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_report_id` INTEGER NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `actor_user_id` INTEGER NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_report_activity_event_report_id_idx`(`event_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_key` VARCHAR(32) NOT NULL,
    `period_type` VARCHAR(16) NOT NULL,
    `period_key` VARCHAR(32) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `branch_key` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `wins` TEXT NULL,
    `challenges` TEXT NULL,
    `plans` TEXT NULL,
    `testimonies` TEXT NULL,
    `prepared_by_user_id` INTEGER NULL,
    `submitted_by_user_id` INTEGER NULL,
    `submitted_at` DATETIME(3) NULL,
    `acted_by_user_id` INTEGER NULL,
    `approved_at` DATETIME(3) NULL,
    `returned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_reports_period_type_period_key_idx`(`period_type`, `period_key`),
    INDEX `department_reports_status_idx`(`status`),
    UNIQUE INDEX `dept_report_period_uk`(`report_key`, `period_type`, `period_key`, `branch_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_report_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `author_user_id` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_report_comments_report_id_idx`(`report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_report_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `actor_user_id` INTEGER NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_report_activity_report_id_idx`(`report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_report_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `body` TEXT NOT NULL,
    `needs_decision` BOOLEAN NOT NULL DEFAULT true,
    `outcome` ENUM('APPROVED', 'RESPONDED') NULL,
    `response` TEXT NULL,
    `decided_by_user_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_report_requests_report_id_idx`(`report_id`),
    INDEX `department_report_requests_needs_decision_outcome_idx`(`needs_decision`, `outcome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_report_comments` ADD CONSTRAINT `event_report_comments_event_report_id_fkey` FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_activity` ADD CONSTRAINT `event_report_activity_event_report_id_fkey` FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_comments` ADD CONSTRAINT `department_report_comments_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `department_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_activity` ADD CONSTRAINT `department_report_activity_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `department_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_requests` ADD CONSTRAINT `department_report_requests_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `department_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

