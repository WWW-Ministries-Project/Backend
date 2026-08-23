-- Add-a-Soul form and the meeting-attendee view both need gender, and
-- soul_won had no such column. Nullable so existing rows are unaffected;
-- new/edited souls populate it going forward.
ALTER TABLE `soul_won` ADD COLUMN `gender` VARCHAR(191) NULL;
