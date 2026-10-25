-- Requisitions: an approved request can be marked disbursed (paid out / items handed over).
ALTER TABLE `request`
    MODIFY `request_approval_status` ENUM('Draft', 'Awaiting_HOD_Approval', 'Awaiting_Executive_Pastor_Approval', 'APPROVED', 'REJECTED', 'DISBURSED') NOT NULL,
    ADD COLUMN `disbursed_by_user_id` INTEGER NULL,
    ADD COLUMN `disbursed_at` DATETIME(3) NULL;

-- Marketplace: who marked an order paid by hand, and when.
ALTER TABLE `orders`
    ADD COLUMN `marked_paid_by_user_id` INTEGER NULL,
    ADD COLUMN `marked_paid_at` DATETIME(3) NULL;
