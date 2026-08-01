-- CreateTable
CREATE TABLE `givingContribution` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `giving_option_id` VARCHAR(191) NOT NULL,
    `giving_option_name` VARCHAR(191) NOT NULL,
    `subaccount_code` VARCHAR(191) NULL,
    `user_id` INTEGER NULL,
    `donor_name` VARCHAR(191) NOT NULL,
    `donor_email` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `amount_paid` INTEGER NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `channel` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NULL,
    `paystack_response` LONGTEXT NULL,
    `receipt_sent_at` DATETIME(3) NULL,
    `branch_id` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `givingContribution_reference_key`(`reference`),
    INDEX `giving_contribution_option_id_idx`(`giving_option_id`),
    INDEX `giving_contribution_user_id_idx`(`user_id`),
    INDEX `giving_contribution_status_idx`(`status`),
    INDEX `giving_contribution_branch_id_idx`(`branch_id`),
    INDEX `giving_contribution_created_at_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `givingContribution` ADD CONSTRAINT `givingContribution_giving_option_id_fkey` FOREIGN KEY (`giving_option_id`) REFERENCES `givingOption`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `givingContribution` ADD CONSTRAINT `givingContribution_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
