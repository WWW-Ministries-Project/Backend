-- AlterTable
ALTER TABLE `requisition_approval_configs`
  MODIFY `module` ENUM('REQUISITION', 'EVENT_REPORT') NOT NULL;

-- CreateTable
CREATE TABLE `event_reports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_id` INTEGER NOT NULL,
  `event_date` DATETIME(3) NOT NULL,
  `status` ENUM('DRAFT', 'PENDING_FINAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
  `final_approver_user_id` INTEGER NULL,
  `final_acted_by_user_id` INTEGER NULL,
  `final_acted_at` DATETIME(3) NULL,
  `created_by` INTEGER NOT NULL,
  `updated_by` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `event_reports_event_id_event_date_key`(`event_id`, `event_date`),
  INDEX `event_reports_event_id_idx`(`event_id`),
  INDEX `event_reports_status_idx`(`status`),
  INDEX `event_reports_final_approver_user_id_idx`(`final_approver_user_id`),
  INDEX `event_reports_created_by_idx`(`created_by`),
  INDEX `event_reports_updated_by_idx`(`updated_by`),
  INDEX `event_reports_final_acted_by_user_id_idx`(`final_acted_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_department_approvals` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `department_id` INTEGER NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `approved_by_user_id` INTEGER NULL,
  `approved_at` DATETIME(3) NULL,

  UNIQUE INDEX `event_report_department_approvals_event_report_id_department_id_key`(`event_report_id`, `department_id`),
  INDEX `event_report_department_approvals_department_id_idx`(`department_id`),
  INDEX `event_report_department_approvals_approved_by_user_id_idx`(`approved_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_attendance_approval` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `approved_by_user_id` INTEGER NULL,
  `approved_at` DATETIME(3) NULL,

  UNIQUE INDEX `event_report_attendance_approval_event_report_id_key`(`event_report_id`),
  INDEX `event_report_attendance_approval_approved_by_user_id_idx`(`approved_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_finance` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `income_json` LONGTEXT NOT NULL,
  `expense_json` LONGTEXT NOT NULL,
  `total_income` DOUBLE NOT NULL DEFAULT 0,
  `total_expense` DOUBLE NOT NULL DEFAULT 0,
  `surplus` DOUBLE NOT NULL DEFAULT 0,
  `updated_by_user_id` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `event_report_finance_event_report_id_key`(`event_report_id`),
  INDEX `event_report_finance_updated_by_user_id_idx`(`updated_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_finance_approvals` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `role` ENUM('COUNTING_LEADER', 'FINANCE_REP') NOT NULL,
  `role_owner_user_id` INTEGER NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `approved_by_user_id` INTEGER NULL,
  `approved_at` DATETIME(3) NULL,

  UNIQUE INDEX `event_report_finance_approvals_event_report_id_role_key`(`event_report_id`, `role`),
  INDEX `event_report_finance_approvals_role_owner_user_id_idx`(`role_owner_user_id`),
  INDEX `event_report_finance_approvals_approved_by_user_id_idx`(`approved_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_viewers` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,

  UNIQUE INDEX `event_report_viewers_event_report_id_user_id_key`(`event_report_id`, `user_id`),
  INDEX `event_report_viewers_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_final_approval_instances` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_report_id` INTEGER NOT NULL,
  `config_id` INTEGER NOT NULL,
  `step_order` INTEGER NOT NULL,
  `step_type` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NOT NULL,
  `approver_user_id` INTEGER NOT NULL,
  `position_id` INTEGER NULL,
  `configured_user_id` INTEGER NULL,
  `status` ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'WAITING',
  `acted_by_user_id` INTEGER NULL,
  `acted_at` DATETIME(3) NULL,
  `comment` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `event_report_final_approval_instances_event_report_id_step_order_key`(`event_report_id`, `step_order`),
  INDEX `event_report_final_approval_instances_approver_user_id_idx`(`approver_user_id`),
  INDEX `event_report_final_approval_instances_status_idx`(`status`),
  INDEX `event_report_final_approval_instances_config_id_idx`(`config_id`),
  INDEX `event_report_final_approval_instances_acted_by_user_id_idx`(`acted_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_report_notification_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `event_type` VARCHAR(191) NOT NULL,
  `event_report_id` INTEGER NOT NULL,
  `actor_user_id` INTEGER NULL,
  `decision` VARCHAR(191) NULL,
  `recipient_user_ids` LONGTEXT NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED_NO_RECIPIENTS') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `last_error` LONGTEXT NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `event_report_notification_events_idempotency_key_key`(`idempotency_key`),
  INDEX `event_report_notification_events_status_created_at_idx`(`status`, `created_at`),
  INDEX `event_report_notification_events_event_report_id_idx`(`event_report_id`),
  INDEX `event_report_notification_events_event_type_idx`(`event_type`),
  INDEX `event_report_notification_events_actor_user_id_idx`(`actor_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_reports` ADD CONSTRAINT `event_reports_event_id_fkey`
  FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_reports` ADD CONSTRAINT `event_reports_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_reports` ADD CONSTRAINT `event_reports_updated_by_fkey`
  FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_reports` ADD CONSTRAINT `event_reports_final_acted_by_user_id_fkey`
  FOREIGN KEY (`final_acted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_department_approvals` ADD CONSTRAINT `event_report_department_approvals_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_department_approvals` ADD CONSTRAINT `event_report_department_approvals_department_id_fkey`
  FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_department_approvals` ADD CONSTRAINT `event_report_department_approvals_approved_by_user_id_fkey`
  FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_attendance_approval` ADD CONSTRAINT `event_report_attendance_approval_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_attendance_approval` ADD CONSTRAINT `event_report_attendance_approval_approved_by_user_id_fkey`
  FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_finance` ADD CONSTRAINT `event_report_finance_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_finance` ADD CONSTRAINT `event_report_finance_updated_by_user_id_fkey`
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_finance_approvals` ADD CONSTRAINT `event_report_finance_approvals_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_finance_approvals` ADD CONSTRAINT `event_report_finance_approvals_role_owner_user_id_fkey`
  FOREIGN KEY (`role_owner_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_finance_approvals` ADD CONSTRAINT `event_report_finance_approvals_approved_by_user_id_fkey`
  FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_viewers` ADD CONSTRAINT `event_report_viewers_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_viewers` ADD CONSTRAINT `event_report_viewers_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_final_approval_instances` ADD CONSTRAINT `event_report_final_approval_instances_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_final_approval_instances` ADD CONSTRAINT `event_report_final_approval_instances_config_id_fkey`
  FOREIGN KEY (`config_id`) REFERENCES `requisition_approval_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_final_approval_instances` ADD CONSTRAINT `event_report_final_approval_instances_approver_user_id_fkey`
  FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_final_approval_instances` ADD CONSTRAINT `event_report_final_approval_instances_acted_by_user_id_fkey`
  FOREIGN KEY (`acted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_notification_events` ADD CONSTRAINT `event_report_notification_events_event_report_id_fkey`
  FOREIGN KEY (`event_report_id`) REFERENCES `event_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_report_notification_events` ADD CONSTRAINT `event_report_notification_events_actor_user_id_fkey`
  FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
