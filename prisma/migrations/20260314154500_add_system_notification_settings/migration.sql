CREATE TABLE `system_notification_settings` (
    `id` INTEGER NOT NULL,
    `system_failure_recipient_user_id` INTEGER NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `system_notification_settings_recipient_idx`(`system_failure_recipient_user_id`),
    INDEX `system_notification_settings_updated_by_idx`(`updated_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `system_notification_settings`
    ADD CONSTRAINT `sys_notif_settings_recipient_fk`
    FOREIGN KEY (`system_failure_recipient_user_id`) REFERENCES `user`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `system_notification_settings`
    ADD CONSTRAINT `sys_notif_settings_updated_by_fk`
    FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
