-- CreateTable
CREATE TABLE `assistant_preference` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `brief` BOOLEAN NOT NULL DEFAULT true,
    `nudges` BOOLEAN NOT NULL DEFAULT true,
    `quiet` BOOLEAN NOT NULL DEFAULT true,
    `email_copy` BOOLEAN NOT NULL DEFAULT false,
    `approval_after` VARCHAR(191) NOT NULL DEFAULT '24 hours',
    `report_lead` VARCHAR(191) NOT NULL DEFAULT '2 days before',
    `visitor_after` VARCHAR(191) NOT NULL DEFAULT '48 hours',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assistant_preference_user_id_key`(`user_id`),
    INDEX `assistant_preference_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assistant_preference`
ADD CONSTRAINT `assistant_preference_user_id_fk`
FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
ON DELETE CASCADE
ON UPDATE CASCADE;
