-- CreateTable
CREATE TABLE `givingOption` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `account_type` VARCHAR(191) NOT NULL DEFAULT 'ghipss',
    `settlement_bank` VARCHAR(191) NOT NULL,
    `bank_name` VARCHAR(191) NOT NULL,
    `account_number` VARCHAR(191) NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `subaccount_code` VARCHAR(191) NULL,
    `percentage_charge` DOUBLE NOT NULL DEFAULT 100,
    `bearer` VARCHAR(191) NOT NULL DEFAULT 'subaccount',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `archived_at` DATETIME(3) NULL,
    `paystack_synced_at` DATETIME(3) NULL,
    `branch_id` INTEGER NULL,
    `created_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `givingOption_subaccount_code_key`(`subaccount_code`),
    INDEX `giving_option_branch_id_idx`(`branch_id`),
    INDEX `giving_option_branch_id_name_idx`(`branch_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `givingOption` ADD CONSTRAINT `givingOption_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
