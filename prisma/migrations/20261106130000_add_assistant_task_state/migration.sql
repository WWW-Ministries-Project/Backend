-- CreateTable
CREATE TABLE `assistant_task_state` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `task_key` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `snoozed_until` DATETIME(3) NULL,
    `label` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_task_state_user_id_idx`(`user_id`),
    UNIQUE INDEX `assistant_task_state_user_id_task_key_key`(`user_id`, `task_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assistant_task_state`
ADD CONSTRAINT `assistant_task_state_user_id_fk`
FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
ON DELETE CASCADE
ON UPDATE CASCADE;
