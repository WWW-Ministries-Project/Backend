-- Expo push delivery receipts: one row per outstanding receipt id, so a
-- background job can poll Expo and deactivate tokens reported DeviceNotRegistered.
CREATE TABLE `notification_push_receipts` (
    `id` VARCHAR(191) NOT NULL,
    `receipt_id` VARCHAR(191) NOT NULL,
    `token_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notification_push_receipts_receipt_id_key`(`receipt_id`),
    INDEX `notification_push_receipts_created_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
