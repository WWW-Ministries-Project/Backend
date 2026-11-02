-- Track how a learner joined a class: AUTO (auto-enrolled on apply) or MANUAL
-- (staff-enrolled, or an application was approved). Defaulted so existing rows
-- and the mobile app remain valid without a backfill.
ALTER TABLE `enrollment` ADD COLUMN `enrolled_source` VARCHAR(10) NOT NULL DEFAULT 'AUTO';
