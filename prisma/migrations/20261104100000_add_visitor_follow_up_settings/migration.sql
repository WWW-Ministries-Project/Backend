-- CreateTable
CREATE TABLE `visitor_follow_up_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `follow_ups_per_month` INTEGER NOT NULL DEFAULT 2,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by_user_id` INTEGER NULL,

    INDEX `visitor_follow_up_settings_updated_by_idx`(`updated_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `visitor_follow_up_settings`
ADD CONSTRAINT `visitor_follow_up_settings_updated_by_fk`
FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;
