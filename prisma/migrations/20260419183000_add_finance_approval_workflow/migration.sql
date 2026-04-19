ALTER TABLE `financials`
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `created_by_user_id` INTEGER NULL,
  ADD COLUMN `updated_by_user_id` INTEGER NULL,
  ADD COLUMN `submitted_by_user_id` INTEGER NULL,
  ADD COLUMN `submitted_at` DATETIME(3) NULL,
  ADD COLUMN `approved_by_user_id` INTEGER NULL,
  ADD COLUMN `approved_at` DATETIME(3) NULL;

CREATE INDEX `financials_status_idx` ON `financials`(`status`);
CREATE INDEX `financials_created_by_user_id_idx` ON `financials`(`created_by_user_id`);
CREATE INDEX `financials_updated_by_user_id_idx` ON `financials`(`updated_by_user_id`);
CREATE INDEX `financials_submitted_by_user_id_idx` ON `financials`(`submitted_by_user_id`);
CREATE INDEX `financials_approved_by_user_id_idx` ON `financials`(`approved_by_user_id`);

CREATE TABLE `finance_approval_config` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(191) NOT NULL DEFAULT 'FINANCE',
  `finance_approver_user_id` INTEGER NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by_user_id` INTEGER NULL,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `finance_approval_config_config_key_key`(`config_key`),
  INDEX `finance_approval_config_approver_user_id_idx`(`finance_approver_user_id`),
  INDEX `finance_approval_config_updated_by_user_id_idx`(`updated_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `finance_approval_config_notification` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `config_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `finance_approval_config_notification_config_id_user_id_key`(`config_id`, `user_id`),
  INDEX `finance_approval_config_notification_config_id_idx`(`config_id`),
  INDEX `finance_approval_config_notification_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `finance_approval_config_notification`
  ADD CONSTRAINT `finance_approval_config_notification_config_id_fkey`
  FOREIGN KEY (`config_id`) REFERENCES `finance_approval_config`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
