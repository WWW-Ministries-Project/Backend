/*
  School of Ministry LMS, phase 1: curriculum modules, grading model and due-date rules.

  Additive only (new nullable/defaulted columns and new tables):
  - program_module: groups a program's topics into ordered modules. topic.moduleId
    is nullable and SET NULL on module delete, so existing topics stay unassigned.
  - program.grading_mode / pass_mark / grading_weights / completion_rules /
    auto_certificate: per-program grading model. Defaults keep today's pass/fail
    behaviour.
  - LearningUnit.due_rule / grading_category: week-based due rule from which each
    cohort's due date is derived; category used for weighted grading.
  - assignment_extension: per-learner due-date extension, honoured at submit time.
*/

-- AlterTable
ALTER TABLE `program` ADD COLUMN `auto_certificate` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `completion_rules` JSON NULL,
    ADD COLUMN `grading_mode` VARCHAR(20) NOT NULL DEFAULT 'PASS_FAIL',
    ADD COLUMN `grading_weights` JSON NULL,
    ADD COLUMN `pass_mark` INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE `topic` ADD COLUMN `moduleId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LearningUnit` ADD COLUMN `due_rule` JSON NULL,
    ADD COLUMN `grading_category` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `program_module` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `programId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `order_number` INTEGER NOT NULL DEFAULT 0,
    `weeks` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `program_module_programId_idx`(`programId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_extension` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cohortId` INTEGER NOT NULL,
    `learningUnitId` INTEGER NOT NULL,
    `enrollmentId` INTEGER NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `reason` TEXT NULL,
    `grantedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assignment_extension_cohortId_idx`(`cohortId`),
    INDEX `assignment_extension_enrollmentId_idx`(`enrollmentId`),
    UNIQUE INDEX `assignment_extension_learningUnitId_enrollmentId_key`(`learningUnitId`, `enrollmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `topic_moduleId_idx` ON `topic`(`moduleId`);

-- AddForeignKey
ALTER TABLE `topic` ADD CONSTRAINT `topic_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `program_module`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `program_module` ADD CONSTRAINT `program_module_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_extension` ADD CONSTRAINT `assignment_extension_cohortId_fkey` FOREIGN KEY (`cohortId`) REFERENCES `cohort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_extension` ADD CONSTRAINT `assignment_extension_learningUnitId_fkey` FOREIGN KEY (`learningUnitId`) REFERENCES `LearningUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_extension` ADD CONSTRAINT `assignment_extension_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
