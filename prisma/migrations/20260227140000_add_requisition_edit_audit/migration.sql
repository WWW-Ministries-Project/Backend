-- Add audit columns to request
ALTER TABLE `request`
    ADD COLUMN `updated_by_user_id` INTEGER NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

CREATE INDEX `request_updated_by_user_id_idx` ON `request`(`updated_by_user_id`);

-- Create requisition edit logs table
CREATE TABLE `requisition_edit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requisition_id` INTEGER NOT NULL,
    `editor_user_id` INTEGER NOT NULL,
    `edited_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changed_fields` LONGTEXT NULL,

    INDEX `requisition_edit_logs_requisition_id_idx`(`requisition_id`),
    INDEX `requisition_edit_logs_editor_user_id_idx`(`editor_user_id`),
    INDEX `requisition_edit_logs_edited_at_idx`(`edited_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign keys
ALTER TABLE `request`
    ADD CONSTRAINT `request_updated_by_user_id_fkey`
    FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `requisition_edit_logs`
    ADD CONSTRAINT `requisition_edit_logs_requisition_id_fkey`
    FOREIGN KEY (`requisition_id`) REFERENCES `request`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `requisition_edit_logs`
    ADD CONSTRAINT `requisition_edit_logs_editor_user_id_fkey`
    FOREIGN KEY (`editor_user_id`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
