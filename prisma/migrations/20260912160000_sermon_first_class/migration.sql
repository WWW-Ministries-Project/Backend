/*
  Promotes `sermon` from a child row of `sermon_series` to a record in its own
  right.

  New columns are added nullable, backfilled from the parent series, and only
  then tightened to NOT NULL, so the statement order below matters. `series_id`
  becomes nullable and its foreign key switches from ON DELETE CASCADE to
  ON DELETE SET NULL — deleting a series must no longer destroy its sermons.
  The constraint is dropped *before* `series_id` is widened to NULL: InnoDB
  refuses ALTER TABLE on a column that is still part of a foreign key
  (ER_FK_COLUMN_CANNOT_CHANGE), so drop → modify → re-add is the only ordering
  guaranteed to apply.

  `thumbnail_url` is derived from the already-stored `video_id` rather than
  uploaded. It is a stored column, not a computed one, so a non-YouTube source
  or a manual override needs no further migration.

  `sermon_tag.slug` is the deduplication key: lowercased, trimmed, inner
  whitespace collapsed. The unique index makes duplicate tags impossible even
  under concurrent writes.

  Forward-only. No column is dropped and no row is deleted, so this is safe to
  apply ahead of the clients that use the new columns.
*/

-- AlterTable: add the new columns, nullable for now
ALTER TABLE `sermon`
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `thumbnail_url` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `branch_id` INTEGER NULL,
    ADD COLUMN `created_by` INTEGER NULL,
    ADD COLUMN `published_at` DATETIME(3) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- Backfill from the parent series before anything becomes NOT NULL
UPDATE `sermon` AS s
    JOIN `sermon_series` AS ss ON ss.`id` = s.`series_id`
SET s.`created_by`   = ss.`created_by`,
    s.`branch_id`    = ss.`branch_id`,
    s.`status`       = ss.`status`,
    s.`published_at` = ss.`published_at`,
    s.`updated_at`   = s.`created_at`,
    s.`thumbnail_url` = CASE
        WHEN s.`video_id` IS NOT NULL AND s.`video_id` <> ''
        THEN CONCAT('https://i.ytimg.com/vi/', s.`video_id`, '/hqdefault.jpg')
        ELSE NULL
    END;

-- Any row the join missed still needs a non-null updated_at
UPDATE `sermon` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;

-- Tighten the backfilled columns
ALTER TABLE `sermon`
    MODIFY `created_by` INTEGER NOT NULL,
    MODIFY `updated_at` DATETIME(3) NOT NULL;

-- Replace the cascading series foreign key with SET NULL. The constraint has
-- to go before `series_id` can be made nullable.
ALTER TABLE `sermon` DROP FOREIGN KEY `sermon_series_id_fkey`;
ALTER TABLE `sermon` MODIFY `series_id` INTEGER NULL;
ALTER TABLE `sermon`
    ADD CONSTRAINT `sermon_series_id_fkey`
    FOREIGN KEY (`series_id`) REFERENCES `sermon_series`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- New foreign keys
ALTER TABLE `sermon`
    ADD CONSTRAINT `sermon_branch_id_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sermon`
    ADD CONSTRAINT `sermon_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes. branch_id leads the composite, so the branch foreign key is still
-- covered; a standalone index on a two-value status enum would earn little.
-- `sermon_series_id_idx` already exists from 20260726130000_add_sermons.
CREATE INDEX `sermon_branch_id_status_idx` ON `sermon`(`branch_id`, `status`);
CREATE INDEX `sermon_created_by_idx` ON `sermon`(`created_by`);

-- CreateTable
CREATE TABLE `sermon_tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sermon_tag_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sermon_tag_assignment` (
    `sermon_id` INTEGER NOT NULL,
    `tag_id` INTEGER NOT NULL,

    INDEX `sermon_tag_assignment_tag_id_idx`(`tag_id`),
    PRIMARY KEY (`sermon_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sermon_tag_assignment`
    ADD CONSTRAINT `sermon_tag_assignment_sermon_id_fkey`
    FOREIGN KEY (`sermon_id`) REFERENCES `sermon`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sermon_tag_assignment`
    ADD CONSTRAINT `sermon_tag_assignment_tag_id_fkey`
    FOREIGN KEY (`tag_id`) REFERENCES `sermon_tag`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
