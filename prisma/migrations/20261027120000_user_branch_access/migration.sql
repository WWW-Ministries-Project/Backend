-- Per-branch access for admins: one role (access level) per branch.
-- An admin with no rows has no admin access in any branch.
CREATE TABLE `user_branch_access` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `branch_id` INT NOT NULL,
  `access_level_id` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `user_branch_access_user_id_branch_id_key`(`user_id`, `branch_id`),
  INDEX `user_branch_access_branch_id_idx`(`branch_id`),
  INDEX `user_branch_access_access_level_id_idx`(`access_level_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_branch_access`
  ADD CONSTRAINT `user_branch_access_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_branch_access`
  ADD CONSTRAINT `user_branch_access_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_branch_access`
  ADD CONSTRAINT `user_branch_access_access_level_id_fkey`
  FOREIGN KEY (`access_level_id`) REFERENCES `access_level`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every current admin keeps their role in every existing branch,
-- which is what they could reach before branch access existed.
INSERT INTO `user_branch_access` (`user_id`, `branch_id`, `access_level_id`, `updated_at`)
SELECT u.`id`, b.`id`, u.`access_level_id`, CURRENT_TIMESTAMP(3)
FROM `user` u
JOIN `access_level` al ON al.`id` = u.`access_level_id` AND al.`deleted` = false
CROSS JOIN `branch` b
WHERE u.`is_user` = true;
