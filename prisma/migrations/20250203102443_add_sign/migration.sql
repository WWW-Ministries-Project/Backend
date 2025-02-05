-- AlterTable
ALTER TABLE `request` MODIFY `comment` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `request_approvals` ADD COLUMN `hod_sign` VARCHAR(191) NULL,
    ADD COLUMN `ps_sign` VARCHAR(191) NULL;
