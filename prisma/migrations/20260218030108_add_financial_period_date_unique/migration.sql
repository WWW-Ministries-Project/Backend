-- AlterTable
ALTER TABLE `financials`
    ADD COLUMN `periodDate` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `financials_periodDate_key` ON `financials`(`periodDate`);
