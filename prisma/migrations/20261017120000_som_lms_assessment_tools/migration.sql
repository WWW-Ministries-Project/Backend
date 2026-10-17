/*
  School of Ministry LMS, phase 2: question bank, rubrics, gradebook overrides.

  Additive only:
  - lms_question: shared question bank. Questions are copied into a quiz unit's
    data when added, so editing the bank never changes a live quiz.
  - lms_rubric + LearningUnit.rubricId (SET NULL on delete) + assignment_submission
    .rubric_scores: rubric grading for essays. The computed percentage still goes
    through the existing grade path (submission.score, progress.score/status).
  - lms_grade_override: per-learner set score or excusal for a unit, used by the
    gradebook (e.g. "set missing to 0") without fabricating submissions.
*/

-- AlterTable
ALTER TABLE `LearningUnit` ADD COLUMN `rubricId` INTEGER NULL;

-- AlterTable
ALTER TABLE `assignment_submission` ADD COLUMN `rubric_scores` JSON NULL;

-- CreateTable
CREATE TABLE `lms_question` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(20) NOT NULL,
    `prompt` TEXT NOT NULL,
    `options` JSON NULL,
    `correct_option_id` VARCHAR(64) NULL,
    `tags` JSON NULL,
    `difficulty` VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    `created_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_rubric` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `criteria` JSON NOT NULL,
    `levels` JSON NOT NULL,
    `created_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_grade_override` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `learningUnitId` INTEGER NOT NULL,
    `score` INTEGER NULL,
    `excused` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `updated_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lms_grade_override_learningUnitId_idx`(`learningUnitId`),
    UNIQUE INDEX `lms_grade_override_enrollmentId_learningUnitId_key`(`enrollmentId`, `learningUnitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LearningUnit_rubricId_idx` ON `LearningUnit`(`rubricId`);

-- AddForeignKey
ALTER TABLE `LearningUnit` ADD CONSTRAINT `LearningUnit_rubricId_fkey` FOREIGN KEY (`rubricId`) REFERENCES `lms_rubric`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_grade_override` ADD CONSTRAINT `lms_grade_override_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_grade_override` ADD CONSTRAINT `lms_grade_override_learningUnitId_fkey` FOREIGN KEY (`learningUnitId`) REFERENCES `LearningUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

