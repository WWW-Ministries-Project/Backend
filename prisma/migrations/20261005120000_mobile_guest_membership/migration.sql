/*
  Self-registration from the mobile app.

  `user.is_guest` marks an account created by someone who joined as a guest:
  they can sign in, but are not a member and stay out of the member lists
  and the membership confirmation queue. `user.registration_source` records
  where an account came from ("MOBILE_APP" for self-registration; null for
  every existing, dashboard-created record).

  `membership_request` holds a guest's request to become a member, decided on
  the dashboard under Membership management > Guest to membership.

  Forward-only. Existing rows keep `is_guest = false`.
*/

-- AlterTable
ALTER TABLE `user`
    ADD COLUMN `is_guest` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `registration_source` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `user_is_guest_idx` ON `user`(`is_guest`);

-- CreateTable
CREATE TABLE `membership_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `message` TEXT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decline_reason` TEXT NULL,
    `decided_by` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `branch_id` INTEGER NULL,

    INDEX `membership_request_user_id_idx`(`user_id`),
    INDEX `membership_request_status_idx`(`status`),
    INDEX `membership_request_decided_by_idx`(`decided_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `membership_request` ADD CONSTRAINT `membership_request_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_request` ADD CONSTRAINT `membership_request_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
