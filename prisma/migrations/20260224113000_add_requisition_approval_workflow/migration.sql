-- CreateTable
CREATE TABLE `requisition_approval_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `module` ENUM('REQUISITION') NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `requisition_approval_configs_module_key`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requisition_approval_config_requesters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,

    INDEX `requisition_approval_config_requesters_user_id_idx`(`user_id`),
    UNIQUE INDEX `requisition_approval_config_requesters_config_id_user_id_key`(`config_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requisition_approval_config_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_id` INTEGER NOT NULL,
    `step_order` INTEGER NOT NULL,
    `step_type` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NOT NULL,
    `position_id` INTEGER NULL,
    `user_id` INTEGER NULL,

    INDEX `requisition_approval_config_steps_position_id_idx`(`position_id`),
    INDEX `requisition_approval_config_steps_user_id_idx`(`user_id`),
    UNIQUE INDEX `requisition_approval_config_steps_config_id_step_order_key`(`config_id`, `step_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requisition_approval_instances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `config_id` INTEGER NOT NULL,
    `step_order` INTEGER NOT NULL,
    `step_type` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NOT NULL,
    `approver_user_id` INTEGER NOT NULL,
    `position_id` INTEGER NULL,
    `configured_user_id` INTEGER NULL,
    `status` ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'WAITING',
    `acted_by_user_id` INTEGER NULL,
    `acted_at` DATETIME(3) NULL,
    `comment` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `requisition_approval_instances_approver_user_id_idx`(`approver_user_id`),
    INDEX `requisition_approval_instances_status_idx`(`status`),
    UNIQUE INDEX `requisition_approval_instances_request_id_step_order_key`(`request_id`, `step_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `requisition_approval_config_requesters` ADD CONSTRAINT `requisition_approval_config_requesters_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `requisition_approval_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requisition_approval_config_steps` ADD CONSTRAINT `requisition_approval_config_steps_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `requisition_approval_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requisition_approval_instances` ADD CONSTRAINT `requisition_approval_instances_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `requisition_approval_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requisition_approval_instances` ADD CONSTRAINT `requisition_approval_instances_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
