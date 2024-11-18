-- AlterTable
ALTER TABLE `request` MODIFY `request_approval_status` ENUM('Draft', 'Awaiting_HOD_Approval', 'Awaiting_Executive_Pastor_Approval', 'APPROVED', 'REJECTED') NOT NULL;

-- CreateTable
CREATE TABLE `request_approvals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NULL,
    `hod_user_id` INTEGER NULL,
    `hod_approved` BOOLEAN NOT NULL DEFAULT false,
    `hod_approval_date` DATETIME(3) NULL,
    `ps_user_id` INTEGER NULL,
    `ps_approved` BOOLEAN NOT NULL DEFAULT false,
    `ps_approval_date` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
