-- Add branch scoping to positions
ALTER TABLE `position` ADD COLUMN `branch_id` INT NULL;

CREATE INDEX `position_branch_id_idx` ON `position`(`branch_id`);

-- Ensure a default branch exists (id 1 in existing deployments)
INSERT INTO `branch` (`name`, `description`, `is_default`)
SELECT 'Main branch', NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM `branch` WHERE `is_default` = true OR `name` = 'Main branch'
);

SET @main_branch_id := (
  SELECT `id`
  FROM `branch`
  WHERE `is_default` = true
  ORDER BY `id` ASC
  LIMIT 1
);

-- Backfill existing positions that have no branch to the default (Main) branch
UPDATE `position` SET `branch_id` = @main_branch_id WHERE `branch_id` IS NULL;

ALTER TABLE `position`
  ADD CONSTRAINT `position_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
