CREATE TABLE `role_eligibility_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role_key` VARCHAR(64) NOT NULL,
    `program_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `role_eligibility_rules_role_key_program_id_key`(`role_key`, `program_id`),
    INDEX `role_eligibility_rules_program_id_idx`(`program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `role_eligibility_rules`
ADD CONSTRAINT `role_eligibility_rules_program_id_fkey`
FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
