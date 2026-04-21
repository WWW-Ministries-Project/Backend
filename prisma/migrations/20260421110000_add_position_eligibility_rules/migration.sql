CREATE TABLE `position_eligibility_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `position_id` INTEGER NOT NULL,
    `program_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `position_eligibility_rules_position_id_program_id_key`(`position_id`, `program_id`),
    INDEX `position_eligibility_rules_position_id_idx`(`position_id`),
    INDEX `position_eligibility_rules_program_id_idx`(`program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `position_eligibility_rules`
ADD CONSTRAINT `position_eligibility_rules_position_id_fkey`
FOREIGN KEY (`position_id`) REFERENCES `position`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `position_eligibility_rules`
ADD CONSTRAINT `position_eligibility_rules_program_id_fkey`
FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
