-- Grade release (opt-in hold). grade_released defaults true so existing graded
-- submissions and the mobile app keep showing scores; new grades are created
-- with false only when the program's hold_grades toggle is on, then flipped to
-- true (with released_at) by the "release grades" action.
ALTER TABLE `assignment_submission` ADD COLUMN `grade_released` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `assignment_submission` ADD COLUMN `released_at` DATETIME(3) NULL;
