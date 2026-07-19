-- AlterTable
ALTER TABLE `department` ADD COLUMN `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE `department_join_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `department_id` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `position_id` INTEGER NULL,
    `start_date` DATETIME(3) NULL,
    `instructions` VARCHAR(191) NULL,
    `decline_reason` VARCHAR(191) NULL,
    `decided_by` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `branch_id` INTEGER NULL,

    INDEX `department_join_request_user_id_idx`(`user_id`),
    INDEX `department_join_request_department_id_idx`(`department_id`),
    INDEX `department_join_request_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `department_join_request` ADD CONSTRAINT `department_join_request_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_join_request` ADD CONSTRAINT `department_join_request_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_join_request` ADD CONSTRAINT `department_join_request_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
