/*
  School of Ministry LMS, phases 3 and 4: teaching operations, enrollment review,
  instructor roster and content library.

  Additive only (new tables and one nullable column):
  - lms_session / lms_attendance: sessions per cohort or class and per-learner
    attendance (PRESENT, LATE, ABSENT, EXCUSED). Attendance feeds the gradebook.
  - lms_announcement: cohort/class/at-risk announcements. Delivery goes through the
    existing messaging outbox (message_dispatch), referenced by dispatch_id without
    a FK because the outbox is pruned independently.
  - lms_application: applicants held back by eligibility rules or a full class,
    waiting for an admin to enroll anyway or decline.
  - program_instructor: instructors attached to a program with grade, attendance,
    message and curriculum permissions.
  - lms_library_item + LearningUnit.libraryItemId (SET NULL on delete): shared
    content; URL edits propagate to units created from the item.
*/

-- AlterTable
ALTER TABLE `LearningUnit` ADD COLUMN `libraryItemId` INTEGER NULL;

-- CreateTable
CREATE TABLE `lms_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cohortId` INTEGER NOT NULL,
    `courseId` INTEGER NULL,
    `title` VARCHAR(191) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NULL,
    `mode` VARCHAR(20) NOT NULL,
    `location` VARCHAR(191) NULL,
    `meeting_link` TEXT NULL,
    `week` INTEGER NULL,
    `cancelled` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `created_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lms_session_cohortId_starts_at_idx`(`cohortId`, `starts_at`),
    INDEX `lms_session_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_attendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `enrollmentId` INTEGER NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `note` VARCHAR(191) NULL,
    `recorded_by` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lms_attendance_enrollmentId_idx`(`enrollmentId`),
    UNIQUE INDEX `lms_attendance_sessionId_enrollmentId_key`(`sessionId`, `enrollmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cohortId` INTEGER NOT NULL,
    `courseId` INTEGER NULL,
    `audience` VARCHAR(20) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `channels` JSON NOT NULL,
    `recipient_count` INTEGER NOT NULL DEFAULT 0,
    `dispatch_id` INTEGER NULL,
    `scheduled_for` DATETIME(3) NULL,
    `sent_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lms_announcement_cohortId_idx`(`cohortId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_application` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `programId` INTEGER NOT NULL,
    `cohortId` INTEGER NULL,
    `courseId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `reasons` JSON NULL,
    `note` TEXT NULL,
    `decided_by` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `enrollmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lms_application_status_idx`(`status`),
    INDEX `lms_application_programId_idx`(`programId`),
    INDEX `lms_application_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `program_instructor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `programId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `can_grade` BOOLEAN NOT NULL DEFAULT true,
    `can_attendance` BOOLEAN NOT NULL DEFAULT true,
    `can_message` BOOLEAN NOT NULL DEFAULT true,
    `can_edit_curriculum` BOOLEAN NOT NULL DEFAULT false,
    `added_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `program_instructor_userId_idx`(`userId`),
    UNIQUE INDEX `program_instructor_programId_userId_key`(`programId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lms_library_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `url` TEXT NOT NULL,
    `size_bytes` INTEGER NULL,
    `duration_minutes` INTEGER NULL,
    `pages` INTEGER NULL,
    `tags` JSON NULL,
    `created_by` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LearningUnit_libraryItemId_idx` ON `LearningUnit`(`libraryItemId`);

-- AddForeignKey
ALTER TABLE `LearningUnit` ADD CONSTRAINT `LearningUnit_libraryItemId_fkey` FOREIGN KEY (`libraryItemId`) REFERENCES `lms_library_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_session` ADD CONSTRAINT `lms_session_cohortId_fkey` FOREIGN KEY (`cohortId`) REFERENCES `cohort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_session` ADD CONSTRAINT `lms_session_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `course`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_attendance` ADD CONSTRAINT `lms_attendance_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `lms_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_attendance` ADD CONSTRAINT `lms_attendance_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_announcement` ADD CONSTRAINT `lms_announcement_cohortId_fkey` FOREIGN KEY (`cohortId`) REFERENCES `cohort`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_announcement` ADD CONSTRAINT `lms_announcement_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `course`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_application` ADD CONSTRAINT `lms_application_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_application` ADD CONSTRAINT `lms_application_cohortId_fkey` FOREIGN KEY (`cohortId`) REFERENCES `cohort`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_application` ADD CONSTRAINT `lms_application_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `course`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lms_application` ADD CONSTRAINT `lms_application_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `program_instructor` ADD CONSTRAINT `program_instructor_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `program_instructor` ADD CONSTRAINT `program_instructor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

