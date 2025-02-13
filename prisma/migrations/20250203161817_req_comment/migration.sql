/*
  Warnings:

  - You are about to drop the column `comment` on the `request` table. All the data in the column will be lost.
  - You are about to drop the column `hod_comment` on the `request_approvals` table. All the data in the column will be lost.
  - You are about to drop the column `ps_comment` on the `request_approvals` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `request` DROP COLUMN `comment`;

-- AlterTable
ALTER TABLE `request_approvals` DROP COLUMN `hod_comment`,
    DROP COLUMN `ps_comment`;

-- CreateTable
CREATE TABLE `request_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `comment` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_comments_request_id_fkey`(`request_id`),
    INDEX `request_comments_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `request_comments` ADD CONSTRAINT `request_comments_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_comments` ADD CONSTRAINT `request_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
