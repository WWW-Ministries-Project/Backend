-- Data migration: materialize the legacy scalar `user.parent_id` links as
-- bidirectional rows in `family_relation` (the single source of truth for
-- parent<->child relationships) BEFORE the next migration drops the column.
--
-- INSERT IGNORE skips pairs that already exist (unique on user_id, family_id)
-- and any row whose parent no longer exists, so this is safe and idempotent.
-- Runs automatically, in order, ahead of 20261105010000_drop_user_parent_id.

-- parent -> child : CHILD
INSERT IGNORE INTO `family_relation` (`user_id`, `family_id`, `relation`)
SELECT u.`parent_id`, u.`id`, 'CHILD'
FROM `user` u
WHERE u.`parent_id` IS NOT NULL
  AND u.`parent_id` <> u.`id`;

-- child -> parent : PARENT (reciprocal)
INSERT IGNORE INTO `family_relation` (`user_id`, `family_id`, `relation`)
SELECT u.`id`, u.`parent_id`, 'PARENT'
FROM `user` u
WHERE u.`parent_id` IS NOT NULL
  AND u.`parent_id` <> u.`id`;
