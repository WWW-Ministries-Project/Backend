ALTER TABLE `event_mgt`
  ADD COLUMN `public_registration_token` VARCHAR(191) NULL,
  ADD COLUMN `recurrence_end_date` DATETIME(3) NULL,
  ADD COLUMN `requires_registration` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `registration_end_date` DATETIME(3) NULL,
  ADD COLUMN `registration_capacity` INTEGER NULL,
  ADD COLUMN `registration_audience` ENUM('MEMBERS_ONLY', 'MEMBERS_AND_NON_MEMBERS') NOT NULL DEFAULT 'MEMBERS_AND_NON_MEMBERS';

UPDATE `event_mgt`
SET `public_registration_token` = UUID()
WHERE `public_registration_token` IS NULL OR `public_registration_token` = '';

ALTER TABLE `event_mgt`
  MODIFY `public_registration_token` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `event_mgt_public_registration_token_key`
  ON `event_mgt`(`public_registration_token`);

ALTER TABLE `event_registers`
  DROP FOREIGN KEY `event_registers_user_id_fkey`;

ALTER TABLE `event_registers`
  MODIFY `user_id` INTEGER NULL,
  ADD COLUMN `attendee_name` VARCHAR(191) NULL,
  ADD COLUMN `attendee_email` VARCHAR(191) NULL,
  ADD COLUMN `attendee_phone` VARCHAR(191) NULL,
  ADD COLUMN `attendee_location` VARCHAR(191) NULL,
  ADD COLUMN `is_member` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `member_id` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `event_registers_event_id_user_id_key`
  ON `event_registers`(`event_id`, `user_id`);

CREATE UNIQUE INDEX `event_registers_event_id_attendee_email_key`
  ON `event_registers`(`event_id`, `attendee_email`);

CREATE INDEX `event_registers_member_id_idx`
  ON `event_registers`(`member_id`);

ALTER TABLE `event_registers`
  ADD CONSTRAINT `event_registers_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
