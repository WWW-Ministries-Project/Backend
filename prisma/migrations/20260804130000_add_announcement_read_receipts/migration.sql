-- CreateTable
CREATE TABLE `announcement_read_receipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `announcement_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `announcement_read_receipt_announcement_user_key`(`announcement_id`, `user_id`),
    INDEX `announcement_read_receipt_announcement_id_idx`(`announcement_id`),
    INDEX `announcement_read_receipt_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `announcement_read_receipt` ADD CONSTRAINT `announcement_read_receipt_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `announcement_read_receipt` ADD CONSTRAINT `announcement_read_receipt_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
