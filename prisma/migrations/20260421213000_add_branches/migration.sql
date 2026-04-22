CREATE TABLE `branch` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `is_default` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `branch_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `department` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `assets` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `event_mgt` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `request` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `event_reports` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `program` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `visitor` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `life_center` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `markets` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `AnnualTheme` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `receiptConfig` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `paymentConfig` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `bankAccountConfig` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `titheBreakdownConfig` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `financials` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `finance_approval_config` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `availability` ADD COLUMN `branch_id` INT NULL;
ALTER TABLE `appointment` ADD COLUMN `branch_id` INT NULL;

INSERT INTO `branch` (`name`, `description`, `is_default`)
SELECT 'Main branch', NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM `branch` WHERE `is_default` = true OR `name` = 'Main branch'
);

SET @main_branch_id := (
  SELECT `id`
  FROM `branch`
  WHERE `is_default` = true
  ORDER BY `id` ASC
  LIMIT 1
);

UPDATE `user` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `department` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `assets` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `event_mgt` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `request` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `event_reports` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `program` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `visitor` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `life_center` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `markets` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `AnnualTheme` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `receiptConfig` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `paymentConfig` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `bankAccountConfig` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `titheBreakdownConfig` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `financials` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `finance_approval_config` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `availability` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;
UPDATE `appointment` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;

CREATE INDEX `user_branch_id_idx` ON `user`(`branch_id`);
CREATE INDEX `department_branch_id_idx` ON `department`(`branch_id`);
CREATE INDEX `assets_branch_id_idx` ON `assets`(`branch_id`);
CREATE INDEX `event_mgt_branch_id_idx` ON `event_mgt`(`branch_id`);
CREATE INDEX `request_branch_id_idx` ON `request`(`branch_id`);
CREATE INDEX `event_reports_branch_id_idx` ON `event_reports`(`branch_id`);
CREATE INDEX `program_branch_id_idx` ON `program`(`branch_id`);
CREATE INDEX `visitor_branch_id_idx` ON `visitor`(`branch_id`);
CREATE INDEX `life_center_branch_id_idx` ON `life_center`(`branch_id`);
CREATE INDEX `markets_branch_id_idx` ON `markets`(`branch_id`);
CREATE INDEX `annual_theme_branch_id_idx` ON `AnnualTheme`(`branch_id`);
CREATE INDEX `receipt_config_branch_id_idx` ON `receiptConfig`(`branch_id`);
CREATE INDEX `payment_config_branch_id_idx` ON `paymentConfig`(`branch_id`);
CREATE INDEX `bank_account_config_branch_id_idx` ON `bankAccountConfig`(`branch_id`);
CREATE INDEX `tithe_breakdown_config_branch_id_idx` ON `titheBreakdownConfig`(`branch_id`);
CREATE INDEX `financials_branch_id_idx` ON `financials`(`branch_id`);
CREATE INDEX `finance_approval_config_branch_id_idx` ON `finance_approval_config`(`branch_id`);
CREATE INDEX `availability_branch_id_idx` ON `availability`(`branch_id`);
CREATE INDEX `appointment_branch_id_idx` ON `appointment`(`branch_id`);

ALTER TABLE `user`
  ADD CONSTRAINT `user_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `department`
  ADD CONSTRAINT `department_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `assets`
  ADD CONSTRAINT `assets_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `event_mgt`
  ADD CONSTRAINT `event_mgt_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `request`
  ADD CONSTRAINT `request_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `event_reports`
  ADD CONSTRAINT `event_reports_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `program`
  ADD CONSTRAINT `program_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `visitor`
  ADD CONSTRAINT `visitor_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `life_center`
  ADD CONSTRAINT `life_center_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `markets`
  ADD CONSTRAINT `markets_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AnnualTheme`
  ADD CONSTRAINT `AnnualTheme_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `receiptConfig`
  ADD CONSTRAINT `receiptConfig_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `paymentConfig`
  ADD CONSTRAINT `paymentConfig_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bankAccountConfig`
  ADD CONSTRAINT `bankAccountConfig_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `titheBreakdownConfig`
  ADD CONSTRAINT `titheBreakdownConfig_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `financials`
  ADD CONSTRAINT `financials_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `finance_approval_config`
  ADD CONSTRAINT `finance_approval_config_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `availability`
  ADD CONSTRAINT `availability_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `appointment`
  ADD CONSTRAINT `appointment_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
