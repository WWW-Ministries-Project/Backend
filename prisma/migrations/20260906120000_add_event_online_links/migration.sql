/*
  Adds `event_online_link` — one row per streaming platform per event, holding
  the Zoom / YouTube URL members join through. A table rather than two columns
  on `event_mgt` because more platforms are expected; `platform` is a plain
  string validated in application code (see src/modules/events/onlineLinks.ts)
  so a new platform needs no migration.
*/

-- CreateTable
CREATE TABLE `event_online_link` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `platform` VARCHAR(32) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NULL,

    UNIQUE INDEX `event_online_link_event_id_platform_key`(`event_id`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_online_link` ADD CONSTRAINT `event_online_link_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event_mgt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
