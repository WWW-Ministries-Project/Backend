-- AlterTable
ALTER TABLE `community_post` ADD COLUMN `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `comments_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `community_moderation_log` MODIFY `action` ENUM('VIEW_ANON_AUTHOR', 'REMOVE', 'RESTORE', 'WARN', 'PIN', 'UNPIN', 'POST_MESSAGE') NOT NULL;

-- Important posts used to pin themselves for a week; carry over the ones
-- still inside that window so the feed looks the same after deploy.
UPDATE `community_post` SET `is_pinned` = true
WHERE `is_important` = true AND `created_at` >= DATE_SUB(NOW(), INTERVAL 7 DAY);

-- CreateIndex
CREATE INDEX `community_post_is_pinned_idx` ON `community_post`(`is_pinned`);
