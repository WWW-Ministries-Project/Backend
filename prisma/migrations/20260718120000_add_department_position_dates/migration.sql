-- Add optional start/end dates to a member's department/position membership.
ALTER TABLE `department_positions`
  ADD COLUMN `start_date` DATETIME(3) NULL,
  ADD COLUMN `end_date` DATETIME(3) NULL;
