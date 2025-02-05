-- DropForeignKey
ALTER TABLE `request_comments` DROP FOREIGN KEY `request_comments_request_id_fkey`;

-- DropForeignKey
ALTER TABLE `request_comments` DROP FOREIGN KEY `request_comments_user_id_fkey`;

-- AlterTable
ALTER TABLE `request_comments` MODIFY `request_id` INTEGER NULL,
    MODIFY `user_id` INTEGER NULL,
    MODIFY `comment` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `request_comments` ADD CONSTRAINT `request_comments_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_comments` ADD CONSTRAINT `request_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
