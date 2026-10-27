-- Series are sourced from YouTube playlists; key them on the playlist id so the
-- sync upserts idempotently. MySQL allows multiple NULLs under a unique index.

-- AlterTable
ALTER TABLE `sermon_series` ADD COLUMN `youtube_playlist_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `sermon_series_youtube_playlist_id_key` ON `sermon_series`(`youtube_playlist_id`);
