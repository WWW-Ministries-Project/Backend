/*
  Community — replaces Announcements.

  Members share posts (prayer requests, testimonies, discussions,
  celebrations, questions) with the whole church, one of their departments,
  selected members, or only themselves; others react and comment (one level
  of replies). A church announcement is now a community post with
  type MESSAGE + is_important, which only Community managers may create.

  `community_post.author_id` is always the real author, even for anonymous
  posts and comments. Member endpoints never return it; moderators see it,
  and every such view is written to `community_moderation_log`.

  Data migration (bottom of this file):
    (a) Every PUBLISHED announcement is copied into community_post as an
        important MESSAGE (legacy_announcement_id = announcement.id), keeping
        its author, branch and publish time. Body = title, a blank line, then
        the content with HTML stripped. Audiences map without ever widening:
          ALL_MEMBERS         -> CHURCH (same branch rule)
          SPECIFIC_DEPARTMENT -> DEPARTMENT (same department)
          MINISTRY_WORKERS / HEADS_OF_DEPARTMENT / SPECIFIC_POSITION
                              -> SELECTED, with the recipients computed the
                                 way announcementService.resolveRecipients did
    (b) Every access level holding an `Announcements` permission and no
        `Community` permission gets `Community` set to the same value.

  The `announcement` / `announcement_read_receipt` tables are NOT dropped:
  they stay as a frozen archive.

  Forward-only.
*/

-- CreateTable
CREATE TABLE `community_post` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('PRAYER', 'TESTIMONY', 'DISCUSSION', 'CELEBRATION', 'QUESTION', 'MESSAGE', 'GENERAL') NOT NULL,
    `body` LONGTEXT NOT NULL,
    `audience` ENUM('CHURCH', 'DEPARTMENT', 'SELECTED', 'ONLY_ME') NOT NULL,
    `department_id` INTEGER NULL,
    `author_id` INTEGER NOT NULL,
    `is_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `is_important` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `branch_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `legacy_announcement_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_post_legacy_announcement_id_key`(`legacy_announcement_id`),
    INDEX `community_post_status_deleted_at_created_at_idx`(`status`, `deleted_at`, `created_at`),
    INDEX `community_post_is_important_created_at_idx`(`is_important`, `created_at`),
    INDEX `community_post_audience_branch_id_idx`(`audience`, `branch_id`),
    INDEX `community_post_author_id_idx`(`author_id`),
    INDEX `community_post_department_id_idx`(`department_id`),
    INDEX `community_post_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_post_image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `url` VARCHAR(1024) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `community_post_image_post_id_idx`(`post_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_post_recipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,

    INDEX `community_post_recipient_user_id_idx`(`user_id`),
    UNIQUE INDEX `community_post_recipient_post_id_user_id_key`(`post_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_comment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NOT NULL,
    `parent_id` INTEGER NULL,
    `author_id` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `is_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `community_comment_post_id_created_at_idx`(`post_id`, `created_at`),
    INDEX `community_comment_parent_id_idx`(`parent_id`),
    INDEX `community_comment_author_id_idx`(`author_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_reaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `post_id` INTEGER NULL,
    `comment_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('PRAY', 'LOVE', 'PRAISE', 'CELEBRATE', 'SUPPORT') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_reaction_user_id_idx`(`user_id`),
    UNIQUE INDEX `community_reaction_post_id_user_id_type_key`(`post_id`, `user_id`, `type`),
    UNIQUE INDEX `community_reaction_comment_id_user_id_type_key`(`comment_id`, `user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_hidden` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `post_id` INTEGER NULL,
    `comment_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_hidden_post_id_idx`(`post_id`),
    INDEX `community_hidden_comment_id_idx`(`comment_id`),
    UNIQUE INDEX `community_hidden_user_id_post_id_key`(`user_id`, `post_id`),
    UNIQUE INDEX `community_hidden_user_id_comment_id_key`(`user_id`, `comment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_block` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `blocker_id` INTEGER NOT NULL,
    `blocked_id` INTEGER NOT NULL,
    `via_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_block_blocked_id_idx`(`blocked_id`),
    UNIQUE INDEX `community_block_blocker_id_blocked_id_key`(`blocker_id`, `blocked_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reporter_id` INTEGER NOT NULL,
    `post_id` INTEGER NULL,
    `comment_id` INTEGER NULL,
    `reason` ENUM('INAPPROPRIATE', 'HARASSMENT', 'SAFEGUARDING', 'SPAM', 'MISLEADING', 'OTHER') NOT NULL,
    `details` TEXT NULL,
    `status` ENUM('PENDING', 'REMOVED', 'RESTORED') NOT NULL DEFAULT 'PENDING',
    `warned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `community_report_status_created_at_idx`(`status`, `created_at`),
    INDEX `community_report_reporter_id_idx`(`reporter_id`),
    INDEX `community_report_post_id_idx`(`post_id`),
    INDEX `community_report_comment_id_idx`(`comment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_moderation_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_id` INTEGER NOT NULL,
    `action` ENUM('VIEW_ANON_AUTHOR', 'REMOVE', 'RESTORE', 'WARN') NOT NULL,
    `post_id` INTEGER NULL,
    `comment_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_moderation_log_created_at_idx`(`created_at`),
    INDEX `community_moderation_log_actor_id_idx`(`actor_id`),
    INDEX `community_moderation_log_post_id_idx`(`post_id`),
    INDEX `community_moderation_log_comment_id_idx`(`comment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `community_post` ADD CONSTRAINT `community_post_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_post` ADD CONSTRAINT `community_post_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_post` ADD CONSTRAINT `community_post_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_post_image` ADD CONSTRAINT `community_post_image_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_post_recipient` ADD CONSTRAINT `community_post_recipient_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_post_recipient` ADD CONSTRAINT `community_post_recipient_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_comment` ADD CONSTRAINT `community_comment_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_comment` ADD CONSTRAINT `community_comment_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `community_comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_comment` ADD CONSTRAINT `community_comment_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_reaction` ADD CONSTRAINT `community_reaction_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_reaction` ADD CONSTRAINT `community_reaction_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `community_comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_reaction` ADD CONSTRAINT `community_reaction_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_hidden` ADD CONSTRAINT `community_hidden_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_hidden` ADD CONSTRAINT `community_hidden_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_hidden` ADD CONSTRAINT `community_hidden_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `community_comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_block` ADD CONSTRAINT `community_block_blocker_id_fkey` FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_block` ADD CONSTRAINT `community_block_blocked_id_fkey` FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_report` ADD CONSTRAINT `community_report_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_report` ADD CONSTRAINT `community_report_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_report` ADD CONSTRAINT `community_report_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `community_comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_moderation_log` ADD CONSTRAINT `community_moderation_log_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_moderation_log` ADD CONSTRAINT `community_moderation_log_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_moderation_log` ADD CONSTRAINT `community_moderation_log_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `community_comment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;



-- Data: (a) published announcements -> important MESSAGE posts.
-- Body: <br>, </p>, </div>, </li>, </hN> become line breaks, every other tag is
-- dropped, the common entities are decoded (&amp; last, so "&amp;lt;" stays
-- "&lt;"), runs of 3+ line breaks collapse to one blank line, and the result
-- is trimmed. Line breaks are written as CHAR(10 USING utf8mb4) rather than
-- '\n' so the file does not depend on NO_BACKSLASH_ESCAPES (and a plain
-- CHAR(10) is binary, which REGEXP_REPLACE refuses to mix with utf8mb4).
INSERT INTO `community_post` (
    `type`, `body`, `audience`, `department_id`, `author_id`, `is_anonymous`,
    `is_important`, `status`, `branch_id`, `legacy_announcement_id`,
    `created_at`, `updated_at`
)
SELECT
    'MESSAGE',
    CASE
        WHEN src.`clean_content` = '' THEN src.`clean_title`
        WHEN src.`clean_title` = '' THEN src.`clean_content`
        ELSE CONCAT(src.`clean_title`, CHAR(10 USING utf8mb4), CHAR(10 USING utf8mb4), src.`clean_content`)
    END,
    CASE
        WHEN src.`audience_type` = 'ALL_MEMBERS' THEN 'CHURCH'
        WHEN src.`audience_type` = 'SPECIFIC_DEPARTMENT' AND src.`department_id` IS NOT NULL THEN 'DEPARTMENT'
        ELSE 'SELECTED'
    END,
    CASE
        WHEN src.`audience_type` = 'SPECIFIC_DEPARTMENT' THEN src.`department_id`
        ELSE NULL
    END,
    src.`created_by`,
    false,
    true,
    'ACTIVE',
    src.`branch_id`,
    src.`id`,
    COALESCE(src.`published_at`, src.`created_at`),
    CURRENT_TIMESTAMP(3)
FROM (
    SELECT
        a.`id`,
        a.`audience_type`,
        a.`department_id`,
        a.`branch_id`,
        a.`created_by`,
        a.`published_at`,
        a.`created_at`,
        TRIM(a.`title`) AS `clean_title`,
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(
                                REPLACE(a.`content`, CHAR(13 USING utf8mb4), ''),
                                '(?i)<br[^>]*>', CHAR(10 USING utf8mb4)
                            ),
                            '(?i)</(p|div|li|h[1-6])[[:space:]]*>', CHAR(10 USING utf8mb4)
                        ),
                        '<[^>]+>', ''
                    ),
                    '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&#039;', ''''), '&amp;', '&'),
                CONCAT(CHAR(10 USING utf8mb4), '[[:blank:]]*', CHAR(10 USING utf8mb4), '([[:blank:]]*', CHAR(10 USING utf8mb4), ')+'), CONCAT(CHAR(10 USING utf8mb4), CHAR(10 USING utf8mb4))
            ),
            '^[[:space:]]+|[[:space:]]+$', ''
        ) AS `clean_content`
    FROM `announcement` a
    WHERE a.`status` = 'PUBLISHED'
      AND NOT EXISTS (
          SELECT 1 FROM `community_post` cp WHERE cp.`legacy_announcement_id` = a.`id`
      )
) AS src;

-- SELECTED recipients, mirroring announcementService.resolveRecipients.
-- A branch-scoped announcement only ever reached users of that branch.

-- MINISTRY_WORKERS: users with is_user in the announcement's branch.
INSERT INTO `community_post_recipient` (`post_id`, `user_id`)
SELECT p.`id`, u.`id`
FROM `announcement` a
JOIN `community_post` p ON p.`legacy_announcement_id` = a.`id`
JOIN `user` u ON u.`is_user` = true
    AND (a.`branch_id` IS NULL OR u.`branch_id` = a.`branch_id`)
WHERE a.`audience_type` = 'MINISTRY_WORKERS';

-- HEADS_OF_DEPARTMENT: heads of the departments in the announcement's branch.
INSERT INTO `community_post_recipient` (`post_id`, `user_id`)
SELECT DISTINCT p.`id`, d.`department_head`
FROM `announcement` a
JOIN `community_post` p ON p.`legacy_announcement_id` = a.`id`
JOIN `department` d ON d.`department_head` IS NOT NULL
    AND (a.`branch_id` IS NULL OR d.`branch_id` = a.`branch_id`)
JOIN `user` u ON u.`id` = d.`department_head`
WHERE a.`audience_type` = 'HEADS_OF_DEPARTMENT';

-- SPECIFIC_POSITION: users holding the position directly or through a
-- department position, in the announcement's branch.
INSERT INTO `community_post_recipient` (`post_id`, `user_id`)
SELECT p.`id`, u.`id`
FROM `announcement` a
JOIN `community_post` p ON p.`legacy_announcement_id` = a.`id`
JOIN `user` u ON (a.`branch_id` IS NULL OR u.`branch_id` = a.`branch_id`)
    AND (
        u.`position_id` = a.`position_id`
        OR EXISTS (
            SELECT 1 FROM `department_positions` dp
            WHERE dp.`user_id` = u.`id` AND dp.`position_id` = a.`position_id`
        )
    )
WHERE a.`audience_type` = 'SPECIFIC_POSITION'
  AND a.`position_id` IS NOT NULL;

-- (A SPECIFIC_DEPARTMENT announcement without a department, or a
-- SPECIFIC_POSITION one without a position, reached nobody; it becomes a
-- SELECTED post with no recipients, visible to its author only.)

-- Data: (b) access levels — Community inherits the Announcements permission.
UPDATE `access_level`
SET `permissions` = JSON_SET(`permissions`, '$.Community', JSON_EXTRACT(`permissions`, '$.Announcements'))
WHERE CASE
    -- CASE, not AND: the JSON functions raise on invalid JSON, so they must
    -- only run once JSON_VALID has passed.
    WHEN `permissions` IS NOT NULL AND JSON_VALID(`permissions`) THEN
        JSON_TYPE(`permissions`) = 'OBJECT'
        AND JSON_CONTAINS_PATH(`permissions`, 'one', '$.Announcements')
        AND NOT JSON_CONTAINS_PATH(`permissions`, 'one', '$.Community')
    ELSE false
END;
