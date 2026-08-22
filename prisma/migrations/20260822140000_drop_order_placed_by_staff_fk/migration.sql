-- Drop the FK on orders.placed_by_staff_id added in the previous migration.
-- This repo's established convention for audit-pointer columns
-- (created_by_id elsewhere in this schema) is a plain indexed nullable
-- scalar with no DB-level FK — that avoids the permanent `prisma migrate
-- diff` drift a raw (unmodeled-in-Prisma) FK constraint causes. The index
-- stays; only the constraint goes.
ALTER TABLE `orders` DROP FOREIGN KEY `orders_placed_by_staff_id_fkey`;
