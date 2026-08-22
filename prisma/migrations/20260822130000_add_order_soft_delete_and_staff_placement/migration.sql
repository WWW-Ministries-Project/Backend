-- Soft-delete marker + staff-placement audit trail for orders
ALTER TABLE `orders`
  ADD COLUMN `deleted_at` DATETIME(3) NULL,
  ADD COLUMN `placed_by_staff_id` INT NULL;

CREATE INDEX `orders_placed_by_staff_id_idx` ON `orders`(`placed_by_staff_id`);

-- NOTE: placed_by_staff_id is intentionally NOT modeled as a Prisma
-- relation (it's a plain scalar audit pointer to user.id). `prisma
-- migrate diff` will therefore report this FK as drift — that's
-- expected. Do not let a future `prisma migrate dev` generate a
-- migration that drops this constraint.
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_placed_by_staff_id_fkey`
  FOREIGN KEY (`placed_by_staff_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
