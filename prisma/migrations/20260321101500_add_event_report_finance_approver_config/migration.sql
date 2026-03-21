ALTER TABLE `requisition_approval_configs`
  ADD COLUMN `finance_approver_type` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NULL,
  ADD COLUMN `finance_position_id` INTEGER NULL,
  ADD COLUMN `finance_user_id` INTEGER NULL;

CREATE INDEX `requisition_approval_configs_finance_position_id_idx`
  ON `requisition_approval_configs`(`finance_position_id`);

CREATE INDEX `requisition_approval_configs_finance_user_id_idx`
  ON `requisition_approval_configs`(`finance_user_id`);
