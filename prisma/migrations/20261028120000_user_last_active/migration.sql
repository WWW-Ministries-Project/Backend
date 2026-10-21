-- When the user last signed in or opened the app. Shown on Settings > Users.
ALTER TABLE `user` ADD COLUMN `last_active_at` DATETIME(3) NULL;
