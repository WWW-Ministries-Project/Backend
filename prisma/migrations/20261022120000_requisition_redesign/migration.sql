/*
  Requisition redesign.

  - request gains needed_by, purpose ("why it's needed"), created_at,
    submitted_at, last_reminder_at, revised_from_id and a server-written JSON
    history for events that have no other record (reminders, revisions).
  - requisition_approval_instances gains the approver's typed signature.
  - requisition_approval_configs gains approval_reply_days: how long an
    approver has before a requisition is overdue and chased.

  Backfill: created_at from requisition_date; submitted_at from the first
  approval instance (instances are created on submit), or requisition_date for
  legacy non-draft rows. last_reminder_at is set on rows already waiting so the
  first automatic-reminder run doesn't chase every old requisition at once.
  Forward-only.
*/

-- AlterTable
ALTER TABLE `request` ADD COLUMN `needed_by` DATETIME(3) NULL,
    ADD COLUMN `purpose` TEXT NULL,
    ADD COLUMN `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `submitted_at` DATETIME(3) NULL,
    ADD COLUMN `last_reminder_at` DATETIME(3) NULL,
    ADD COLUMN `revised_from_id` INTEGER NULL,
    ADD COLUMN `history` JSON NULL;

-- CreateIndex
CREATE INDEX `request_revised_from_id_idx` ON `request`(`revised_from_id`);

-- AlterTable
ALTER TABLE `requisition_approval_instances` ADD COLUMN `signature` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `requisition_approval_configs` ADD COLUMN `approval_reply_days` INTEGER NOT NULL DEFAULT 3;

-- Backfill
UPDATE `request` SET `created_at` = `requisition_date`;

UPDATE `request` r
  JOIN (
    SELECT `request_id`, MIN(`created_at`) AS `first_at`
    FROM `requisition_approval_instances`
    GROUP BY `request_id`
  ) i ON i.`request_id` = r.`id`
SET r.`submitted_at` = i.`first_at`;

UPDATE `request`
SET `submitted_at` = `requisition_date`
WHERE `submitted_at` IS NULL AND `request_approval_status` <> 'Draft';

UPDATE `request`
SET `last_reminder_at` = CURRENT_TIMESTAMP(3)
WHERE `request_approval_status` NOT IN ('Draft', 'APPROVED', 'REJECTED');
