/*
  Assets redesign.

  - asset_status gains NEEDS_REPAIR (reported faulty, repair not yet started).
  - assets gains category, status_since, status_note, lost_confirmed_at,
    last_counted_at and repair_request_id (the repair requisition raised for
    it; set null if that requisition is deleted).
  - asset_history is now linked to an asset and carries a tone for the
    timeline. status_update becomes optional (edits have no status).
  - New stock-check (reconciliation) tables: asset_stock_check, its items,
    unregistered extras and per-department sign-off.

  Backfill: status_since from the assignment date, else the purchase date,
  else created_at. Forward-only.
*/

-- AlterTable
ALTER TABLE `assets` ADD COLUMN `category` VARCHAR(32) NULL,
    ADD COLUMN `last_counted_at` DATETIME(3) NULL,
    ADD COLUMN `lost_confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `repair_request_id` INTEGER NULL,
    ADD COLUMN `status_note` TEXT NULL,
    ADD COLUMN `status_since` DATETIME(3) NULL,
    MODIFY `status` ENUM('ASSIGNED', 'UNASSIGNED', 'NOT_FIXABLE', 'OUT_OF_REPAIRS', 'LOST_OR_STOLEN', 'NEEDS_REPAIR') NULL;

-- AlterTable
ALTER TABLE `asset_history` ADD COLUMN `asset_id` INTEGER NULL,
    ADD COLUMN `tone` VARCHAR(16) NULL,
    MODIFY `status_update` ENUM('ASSIGNED', 'UNASSIGNED', 'NOT_FIXABLE', 'OUT_OF_REPAIRS', 'LOST_OR_STOLEN', 'NEEDS_REPAIR') NULL;

-- CreateTable
CREATE TABLE `asset_stock_check` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `scope_department_id` INTEGER NULL,
    `scope_store_only` BOOLEAN NOT NULL DEFAULT false,
    `scope_category` VARCHAR(32) NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `due_date` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `closed_by` INTEGER NULL,
    `branch_id` INTEGER NULL,

    INDEX `asset_stock_check_status_idx`(`status`),
    INDEX `asset_stock_check_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_stock_check_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `check_id` INTEGER NOT NULL,
    `asset_id` INTEGER NOT NULL,
    `expected_department_id` INTEGER NULL,
    `result` VARCHAR(16) NULL,
    `found_department_id` INTEGER NULL,
    `found_in_store` BOOLEAN NOT NULL DEFAULT false,
    `fix` VARCHAR(16) NULL,
    `counted_at` DATETIME(3) NULL,
    `counted_by` INTEGER NULL,
    `counted_by_name` VARCHAR(191) NULL,

    INDEX `asset_stock_check_item_asset_id_idx`(`asset_id`),
    UNIQUE INDEX `asset_stock_check_item_check_id_asset_id_key`(`check_id`, `asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_stock_check_extra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `check_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(32) NULL,
    `found_department_id` INTEGER NULL,
    `found_in_store` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `fix` VARCHAR(16) NOT NULL DEFAULT 'add',
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recorded_by` INTEGER NULL,
    `recorded_by_name` VARCHAR(191) NULL,
    `created_asset_id` INTEGER NULL,

    INDEX `asset_stock_check_extra_check_id_idx`(`check_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_stock_check_department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `check_id` INTEGER NOT NULL,
    `department_key` INTEGER NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `submitted_by` INTEGER NULL,
    `submitted_by_name` VARCHAR(191) NULL,
    `reminded_at` DATETIME(3) NULL,

    UNIQUE INDEX `asset_stock_check_department_check_id_department_key_key`(`check_id`, `department_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `assets_repair_request_id_idx` ON `assets`(`repair_request_id`);

-- CreateIndex
CREATE INDEX `asset_history_asset_id_update_date_idx` ON `asset_history`(`asset_id`, `update_date`);

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_repair_request_id_fkey` FOREIGN KEY (`repair_request_id`) REFERENCES `request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_history` ADD CONSTRAINT `asset_history_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_stock_check_item` ADD CONSTRAINT `asset_stock_check_item_check_id_fkey` FOREIGN KEY (`check_id`) REFERENCES `asset_stock_check`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_stock_check_item` ADD CONSTRAINT `asset_stock_check_item_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_stock_check_extra` ADD CONSTRAINT `asset_stock_check_extra_check_id_fkey` FOREIGN KEY (`check_id`) REFERENCES `asset_stock_check`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_stock_check_department` ADD CONSTRAINT `asset_stock_check_department_check_id_fkey` FOREIGN KEY (`check_id`) REFERENCES `asset_stock_check`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill
UPDATE `assets` SET `status_since` = COALESCE(`date_assigned`, `date_purchased`, `created_at`) WHERE `status_since` IS NULL;
