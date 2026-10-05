/*
  YouTube live detection for the mobile app.

  `live_stream_state` is a singleton row (id = 1) the live-stream cron keeps
  current: whether the church channel is LIVE, has an UPCOMING broadcast, or
  is OFFLINE, plus the broadcast's video id, title and times. The mobile app
  reads it from `GET /live-stream/status` instead of calling YouTube itself.

  `notified_video_id` records the broadcast members were last pushed about,
  so a "we're live" notification goes out once per broadcast.

  Forward-only. The row is created by the first cron run.
*/

-- CreateTable
CREATE TABLE `live_stream_state` (
    `id` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
    `video_id` VARCHAR(32) NULL,
    `title` VARCHAR(255) NULL,
    `thumbnail_url` VARCHAR(512) NULL,
    `scheduled_start_at` DATETIME(3) NULL,
    `actual_start_at` DATETIME(3) NULL,
    `checked_at` DATETIME(3) NULL,
    `next_check_at` DATETIME(3) NULL,
    `last_error` VARCHAR(1024) NULL,
    `notified_video_id` VARCHAR(32) NULL,
    `notified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
