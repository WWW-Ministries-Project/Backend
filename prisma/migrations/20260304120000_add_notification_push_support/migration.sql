-- CreateTable
CREATE TABLE `notification_push_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `p256dh` VARCHAR(512) NOT NULL,
    `auth` VARCHAR(512) NOT NULL,
    `expiration_time` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `user_agent` VARCHAR(512) NULL,
    `platform` VARCHAR(191) NULL,
    `language` VARCHAR(32) NULL,
    `timezone` VARCHAR(191) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` VARCHAR(1024) NULL,
    `last_error_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `notification_push_subscriptions_user_active_idx`(`user_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_push_delivery_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `notification_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SENT', 'DEAD') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` VARCHAR(1024) NULL,
    `last_error_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_push_delivery_jobs_notification_subscription_key`(`notification_id`, `subscription_id`),
    INDEX `notification_push_delivery_jobs_status_next_attempt_idx`(`status`, `next_attempt_at`),
    INDEX `notification_push_delivery_jobs_subscription_idx`(`subscription_id`),
    INDEX `notification_push_delivery_jobs_notification_idx`(`notification_id`),
    INDEX `notification_push_delivery_jobs_user_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_push_subscriptions` ADD CONSTRAINT `notification_push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_push_delivery_jobs` ADD CONSTRAINT `notification_push_delivery_jobs_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `in_app_notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_push_delivery_jobs` ADD CONSTRAINT `notification_push_delivery_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_push_delivery_jobs` ADD CONSTRAINT `notification_push_delivery_jobs_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `notification_push_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
