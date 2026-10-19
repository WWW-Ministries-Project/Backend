-- AlterTable
ALTER TABLE `sermon` ADD COLUMN `preached_at` DATE NULL;

-- Backfill: until now the only date an admin could see was when the sermon
-- was published (or added), so use that as the preached date.
UPDATE `sermon` SET `preached_at` = DATE(COALESCE(`published_at`, `created_at`)) WHERE `preached_at` IS NULL;

-- CreateIndex
CREATE INDEX `sermon_preached_at_idx` ON `sermon`(`preached_at`);
