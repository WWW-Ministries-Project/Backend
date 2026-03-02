-- CreateTable
CREATE TABLE `requisition_approval_config_notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,

    INDEX `requisition_approval_config_notifications_user_id_idx`(`user_id`),
    INDEX `requisition_approval_config_notifications_config_id_idx`(`config_id`),
    UNIQUE INDEX `requisition_approval_config_notifications_config_id_user_id_key`(`config_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requisition_notification_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `requisition_id` INTEGER NOT NULL,
    `actor_user_id` INTEGER NULL,
    `decision` VARCHAR(191) NULL,
    `recipient_user_ids` LONGTEXT NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED_NO_RECIPIENTS') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` LONGTEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `requisition_notification_events_idempotency_key_key`(`idempotency_key`),
    INDEX `requisition_notification_events_status_created_at_idx`(`status`, `created_at`),
    INDEX `requisition_notification_events_requisition_id_idx`(`requisition_id`),
    INDEX `requisition_notification_events_event_type_idx`(`event_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `requisition_approval_config_notifications` ADD CONSTRAINT `requisition_approval_config_notifications_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `requisition_approval_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requisition_notification_events` ADD CONSTRAINT `requisition_notification_events_requisition_id_fkey` FOREIGN KEY (`requisition_id`) REFERENCES `request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
