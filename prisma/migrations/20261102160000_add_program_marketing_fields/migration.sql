-- Marketing/details content for the learner program page. All nullable/additive.
ALTER TABLE `program` ADD COLUMN `learning_outcomes` JSON NULL;
ALTER TABLE `program` ADD COLUMN `eligibility_summary` TEXT NULL;
ALTER TABLE `program` ADD COLUMN `lead_instructor_id` INT NULL;
ALTER TABLE `program` ADD COLUMN `lead_instructor_bio` TEXT NULL;
