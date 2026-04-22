ALTER TABLE `branch`
  ADD COLUMN `location` VARCHAR(191) NULL,
  ADD COLUMN `pastor_in_charge_id` INTEGER NULL;

CREATE INDEX `branch_pastor_in_charge_id_idx` ON `branch`(`pastor_in_charge_id`);

ALTER TABLE `branch`
  ADD CONSTRAINT `branch_pastor_in_charge_id_fkey`
  FOREIGN KEY (`pastor_in_charge_id`) REFERENCES `user`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
