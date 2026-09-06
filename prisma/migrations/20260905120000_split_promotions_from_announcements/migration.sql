/*
  Splits the mobile Home-screen banner out of `announcement` into its own
  `promotion` table.

  Warnings:
  - The banner columns on `announcement` (`image_url`, `cta_label`,
    `deep_link`, `sort_order`, `is_promoted`, `start_date`, `end_date`) are
    dropped. Any data in them is lost — no backfill, by design.
*/

-- CreateTable
CREATE TABLE `promotion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` TEXT NULL,
    `image_url` VARCHAR(191) NULL,
    `cta_label` VARCHAR(191) NULL,
    `deep_link` VARCHAR(191) NULL,
    `sort_order` INTEGER NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `branch_id` INTEGER NULL,
    `created_by` INTEGER NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `promotion_branch_id_idx`(`branch_id`),
    INDEX `promotion_status_start_date_end_date_idx`(`status`, `start_date`, `end_date`),
    INDEX `promotion_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `promotion` ADD CONSTRAINT `promotion_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion` ADD CONSTRAINT `promotion_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `announcement`
    DROP COLUMN `image_url`,
    DROP COLUMN `cta_label`,
    DROP COLUMN `deep_link`,
    DROP COLUMN `sort_order`,
    DROP COLUMN `is_promoted`,
    DROP COLUMN `start_date`,
    DROP COLUMN `end_date`;
