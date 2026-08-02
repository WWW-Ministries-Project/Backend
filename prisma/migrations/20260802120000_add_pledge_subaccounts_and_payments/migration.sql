-- AlterTable: settlement account for a pledge, mirroring givingOption.
-- Every column is nullable or defaulted: pledges created before online
-- redemption existed have no settlement account and must keep working.
ALTER TABLE `pledge`
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    ADD COLUMN `account_type` VARCHAR(191) NOT NULL DEFAULT 'ghipss',
    ADD COLUMN `settlement_bank` VARCHAR(191) NULL,
    ADD COLUMN `bank_name` VARCHAR(191) NULL,
    ADD COLUMN `account_number` VARCHAR(191) NULL,
    ADD COLUMN `account_name` VARCHAR(191) NULL,
    ADD COLUMN `subaccount_code` VARCHAR(191) NULL,
    ADD COLUMN `percentage_charge` DOUBLE NOT NULL DEFAULT 100,
    ADD COLUMN `bearer` VARCHAR(191) NOT NULL DEFAULT 'subaccount',
    ADD COLUMN `paystack_synced_at` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `pledge_subaccount_code_key` ON `pledge`(`subaccount_code`);

-- CreateTable
CREATE TABLE `pledge_payment` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `pledge_id` INTEGER NOT NULL,
    `pledger_id` INTEGER NULL,
    `pledge_title` VARCHAR(191) NOT NULL,
    `payer_name` VARCHAR(191) NOT NULL,
    `payer_email` VARCHAR(191) NOT NULL,
    `subaccount_code` VARCHAR(191) NULL,
    `user_id` INTEGER NULL,
    `amount` INTEGER NOT NULL,
    `fee` INTEGER NOT NULL DEFAULT 0,
    `amount_charged` INTEGER NULL,
    `amount_paid` INTEGER NULL,
    `fee_actual` INTEGER NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `channel` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NULL,
    `paystack_response` LONGTEXT NULL,
    `receipt_sent_at` DATETIME(3) NULL,
    `redemption_id` INTEGER NULL,
    `branch_id` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pledge_payment_reference_key`(`reference`),
    UNIQUE INDEX `pledge_payment_redemption_id_key`(`redemption_id`),
    INDEX `pledge_payment_pledge_id_idx`(`pledge_id`),
    INDEX `pledge_payment_pledger_id_idx`(`pledger_id`),
    INDEX `pledge_payment_user_id_idx`(`user_id`),
    INDEX `pledge_payment_status_idx`(`status`),
    INDEX `pledge_payment_branch_id_idx`(`branch_id`),
    INDEX `pledge_payment_created_at_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pledge_payment` ADD CONSTRAINT `pledge_payment_pledge_id_fkey` FOREIGN KEY (`pledge_id`) REFERENCES `pledge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_payment` ADD CONSTRAINT `pledge_payment_pledger_id_fkey` FOREIGN KEY (`pledger_id`) REFERENCES `pledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_payment` ADD CONSTRAINT `pledge_payment_redemption_id_fkey` FOREIGN KEY (`redemption_id`) REFERENCES `pledge_redemption`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pledge_payment` ADD CONSTRAINT `pledge_payment_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
