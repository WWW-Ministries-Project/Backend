-- Idempotent-ingest key: the YouTube-ingest webhook upserts sermons on
-- `video_id`, so it must be unique. MySQL allows multiple NULLs under a
-- unique index, so unpublished rows without a `video_id` are unaffected.

-- CreateIndex
CREATE UNIQUE INDEX `sermon_video_id_key` ON `sermon`(`video_id`);
