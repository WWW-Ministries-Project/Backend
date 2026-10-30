-- Drop the legacy scalar parent link. `family_relation` is now the single
-- source of truth for parent<->child relationships.
--
-- The preceding migration (20261105000000_backfill_family_relations_from_parent_id)
-- already materialized every parent_id as family_relation CHILD/PARENT rows, so
-- `prisma migrate deploy` runs the backfill then this drop, in order. This
-- migration is irreversible (parent_id values are not recoverable afterwards).

-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `user_parent_id_fkey`;

-- DropIndex
DROP INDEX `user_parent_id_fkey` ON `user`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `parent_id`;
