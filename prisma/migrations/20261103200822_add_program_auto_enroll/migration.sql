-- Program-level enrolment toggle. When true (the existing behaviour), applicants
-- who pass every eligibility rule are enrolled immediately and the rest are
-- queued for review. When false, every applicant is queued for staff review.
-- Defaulted true so existing programs keep their current behaviour.
ALTER TABLE `program` ADD COLUMN `auto_enroll` BOOLEAN NOT NULL DEFAULT true;
