-- CreateTable
CREATE TABLE `pledge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branch_id` INTEGER NULL,
    `event_id` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `target_amount` DECIMAL(15, 2) NULL,
    `deadline` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pledge_branch_id_idx`(`branch_id`),
    INDEX `pledge_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pledge_group` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pledge_id` INTEGER NOT NULL,
    `called_amount` DECIMAL(15, 2) NOT NULL,
    `label` VARCHAR(191) NULL,

    INDEX `pledge_group_pledge_id_idx`(`pledge_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pledge_caller` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pledge_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `guest_name` VARCHAR(191) NULL,
    `guest_phone` VARCHAR(191) NULL,

    INDEX `pledge_caller_pledge_id_idx`(`pledge_id`),
    INDEX `pledge_caller_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `guest_name` VARCHAR(191) NULL,
    `guest_phone` VARCHAR(191) NULL,
    `pledged_amount` DECIMAL(15, 2) NOT NULL,

    INDEX `pledger_group_id_idx`(`group_id`),
    INDEX `pledger_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pledge_redemption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pledger_id` INTEGER NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `image_url` VARCHAR(191) NULL,
    `recorded_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pledge_redemption_pledger_id_idx`(`pledger_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pledge` ADD CONSTRAINT `pledge_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge` ADD CONSTRAINT `pledge_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge` ADD CONSTRAINT `pledge_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_group` ADD CONSTRAINT `pledge_group_pledge_id_fkey` FOREIGN KEY (`pledge_id`) REFERENCES `pledge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_caller` ADD CONSTRAINT `pledge_caller_pledge_id_fkey` FOREIGN KEY (`pledge_id`) REFERENCES `pledge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_caller` ADD CONSTRAINT `pledge_caller_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledger` ADD CONSTRAINT `pledger_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `pledge_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledger` ADD CONSTRAINT `pledger_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_redemption` ADD CONSTRAINT `pledge_redemption_pledger_id_fkey` FOREIGN KEY (`pledger_id`) REFERENCES `pledger`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

