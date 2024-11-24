/*
  Warnings:

  - The values [BROKEN,IN_MAINTENANCE] on the enum `asset_history_status_update` will be removed. If these variants are still used in the database, this will fail.
  - The values [BROKEN,IN_MAINTENANCE] on the enum `asset_history_status_update` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `asset_history` MODIFY `status_update` ENUM('ASSIGNED', 'UNASSIGNED', 'NOT_FIXABLE', 'OUT_OF_REPAIRS', 'LOST_OR_STOLEN') NOT NULL;

-- AlterTable
ALTER TABLE `assets` MODIFY `status` ENUM('ASSIGNED', 'UNASSIGNED', 'NOT_FIXABLE', 'OUT_OF_REPAIRS', 'LOST_OR_STOLEN') NULL;

-- CreateTable
CREATE TABLE `requisition_summary` (
    `requisition_id` INTEGER NOT NULL,
    `generated_id` VARCHAR(191) NOT NULL,
    `product_names` JSON NOT NULL,
    `date_created` DATETIME(3) NOT NULL,
    `approval_status` VARCHAR(191) NOT NULL,
    `total_amount` DOUBLE NOT NULL,

    UNIQUE INDEX `requisition_summary_requisition_id_key`(`requisition_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
