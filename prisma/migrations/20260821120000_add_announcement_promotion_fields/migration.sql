-- AlterTable
ALTER TABLE `announcement`
    ADD COLUMN `image_url` VARCHAR(191) NULL,
    ADD COLUMN `cta_label` VARCHAR(191) NULL,
    ADD COLUMN `deep_link` VARCHAR(191) NULL,
    ADD COLUMN `sort_order` INTEGER NULL,
    ADD COLUMN `is_promoted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `start_date` DATETIME(3) NULL,
    ADD COLUMN `end_date` DATETIME(3) NULL;
