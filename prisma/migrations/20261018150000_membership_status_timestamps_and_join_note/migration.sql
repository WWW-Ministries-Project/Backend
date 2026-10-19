/*
  Membership redesign. Additive only (nullable columns, no backfill):
  - user.confirmed_at / user.functional_at: when the member reached CONFIRMED /
    MEMBER. Existing rows stay null; clients fall back to member_since.
  - department_join_request.note: optional note from the requesting member.
*/

-- AlterTable
ALTER TABLE `user` ADD COLUMN `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `functional_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `department_join_request` ADD COLUMN `note` TEXT NULL;
