-- Program publish status (DRAFT / PUBLISHED) and the opt-in "hold grades until
-- released" toggle. Both defaulted so existing programs and the mobile app keep
-- their current behaviour (programs stay visible, grades stay released).
ALTER TABLE `program` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE `program` ADD COLUMN `hold_grades` BOOLEAN NOT NULL DEFAULT false;
