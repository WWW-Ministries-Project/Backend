-- Inline grading comments left on a submission during full grading:
-- [{ id, text, quote?, kind?: "praise" | "improve" }]. Nullable/additive.
ALTER TABLE `assignment_submission` ADD COLUMN `inline_comments` JSON NULL;
