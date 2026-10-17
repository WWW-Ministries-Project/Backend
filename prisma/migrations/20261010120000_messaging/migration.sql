/*
  Admin Messaging: Welcome, Birthday and General messages.

  - message_template: four admin-editable automatic templates, seeded disabled
    so nothing sends until an admin turns one on.
  - message_settings: singleton with app store links and birthday send time.
  - message_dispatch / message_recipient: the outbox. Recipient rows snapshot
    name, address and rendered text and carry no FK to user/visitor, so
    history survives deletions.
  - Access levels that hold Super_Admin on Access_rights get Super_Admin on
    the new Messaging domain; every other level starts without it.
*/

-- CreateTable
CREATE TABLE `message_template` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` ENUM('WELCOME_MEMBER', 'WELCOME_GUEST', 'WELCOME_VISITOR', 'BIRTHDAY') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `channels` JSON NOT NULL,
    `email_subject` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `include_app_link` BOOLEAN NOT NULL DEFAULT false,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `message_template_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `app_store_url` VARCHAR(191) NULL,
    `play_store_url` VARCHAR(191) NULL,
    `birthday_send_time` VARCHAR(191) NOT NULL DEFAULT '07:00',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Accra',
    `last_birthday_run_date` VARCHAR(191) NULL,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_dispatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('WELCOME', 'BIRTHDAY', 'GENERAL') NOT NULL,
    `template_key` ENUM('WELCOME_MEMBER', 'WELCOME_GUEST', 'WELCOME_VISITOR', 'BIRTHDAY') NULL,
    `dedupe_key` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `email_subject` VARCHAR(191) NULL,
    `channels` JSON NOT NULL,
    `audience` JSON NULL,
    `status` ENUM('SCHEDULED', 'QUEUED', 'SENT', 'CANCELLED', 'FAILED') NOT NULL,
    `scheduled_for` DATETIME(3) NULL,
    `error` TEXT NULL,
    `created_by` INTEGER NULL,
    `counts` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `message_dispatch_dedupe_key_key`(`dedupe_key`),
    INDEX `message_dispatch_status_scheduled_for_idx`(`status`, `scheduled_for`),
    INDEX `message_dispatch_kind_created_at_idx`(`kind`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_recipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dispatch_id` INTEGER NOT NULL,
    `channel` ENUM('SMS', 'EMAIL', 'IN_APP') NOT NULL,
    `recipient_key` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NULL,
    `visitor_id` INTEGER NULL,
    `recipient_name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `rendered_subject` VARCHAR(191) NULL,
    `rendered_body` TEXT NOT NULL,
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NULL,
    `claimed_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_recipient_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `message_recipient_user_id_idx`(`user_id`),
    UNIQUE INDEX `message_recipient_dispatch_id_channel_recipient_key_key`(`dispatch_id`, `channel`, `recipient_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `message_recipient` ADD CONSTRAINT `message_recipient_dispatch_id_fkey` FOREIGN KEY (`dispatch_id`) REFERENCES `message_dispatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed templates (disabled)
INSERT INTO `message_template` (`key`, `enabled`, `channels`, `email_subject`, `body`, `include_app_link`, `updated_at`) VALUES
('WELCOME_MEMBER', false, '{"sms":true,"email":false,"inApp":true}', 'Welcome to {church_name}',
 'Hi {first_name}, welcome to {church_name}! We are glad you have joined our church family. Open the app any time for sermons, events and giving.', false, CURRENT_TIMESTAMP(3)),
('WELCOME_GUEST', false, '{"sms":true,"email":false,"inApp":true}', 'Welcome to {church_name}',
 'Hi {first_name}, thank you for joining {church_name} as a guest. We would love to see you again. Check the app for service times and events.', false, CURRENT_TIMESTAMP(3)),
('WELCOME_VISITOR', false, '{"sms":true,"email":true,"inApp":false}', 'Thank you for visiting {church_name}',
 'Hi {first_name}, thank you for worshipping with us at {church_name}. We would love to stay in touch.', true, CURRENT_TIMESTAMP(3)),
('BIRTHDAY', false, '{"sms":true,"email":false,"inApp":true}', 'Happy birthday, {first_name}!',
 'Happy birthday, {first_name}! Everyone at {church_name} is celebrating you today. May this new year be full of God''s blessings.', false, CURRENT_TIMESTAMP(3));

-- Settings singleton
INSERT INTO `message_settings` (`id`, `birthday_send_time`, `timezone`, `updated_at`)
VALUES (1, '07:00', 'Africa/Accra', CURRENT_TIMESTAMP(3));

-- Messaging permission for full admins only
UPDATE `access_level`
SET `permissions` = JSON_SET(`permissions`, '$.Messaging', 'Super_Admin')
WHERE CASE
    WHEN `permissions` IS NOT NULL AND JSON_VALID(`permissions`) THEN
        JSON_TYPE(`permissions`) = 'OBJECT'
        AND JSON_UNQUOTE(JSON_EXTRACT(`permissions`, '$.Access_rights')) = 'Super_Admin'
        AND NOT JSON_CONTAINS_PATH(`permissions`, 'one', '$.Messaging')
    ELSE false
END;
