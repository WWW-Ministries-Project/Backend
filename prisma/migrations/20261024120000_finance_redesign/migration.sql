/*
  Finance redesign.

  - financials: one record per week per branch. periodDate becomes the week's
    first day (YYYY-MM-DD); the global unique index on periodDate is replaced
    by (branch_id, periodDate). Existing month keys (YYYY-MM) stay as they are.
  - financials gains returned_by_user_id, returned_at and return_note for
    records the finance approver sends back.
  - finance_approval_config gains tithe_percentage (default 10).
  - pledger gains reminded_at (last balance reminder).

  Forward-only.
*/

-- DropIndex
DROP INDEX `financials_periodDate_key` ON `financials`;

-- AlterTable
ALTER TABLE `financials` ADD COLUMN `return_note` TEXT NULL,
    ADD COLUMN `returned_at` DATETIME(3) NULL,
    ADD COLUMN `returned_by_user_id` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `financials_branch_id_periodDate_key` ON `financials`(`branch_id`, `periodDate`);

-- AlterTable
ALTER TABLE `finance_approval_config` ADD COLUMN `tithe_percentage` DECIMAL(5, 2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE `pledger` ADD COLUMN `reminded_at` DATETIME(3) NULL;
