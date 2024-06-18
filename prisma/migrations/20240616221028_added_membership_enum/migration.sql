/*
  Warnings:

  - You are about to drop the column `is_visitor` on the `user` table. All the data in the column will be lost.
  - You are about to alter the column `membership_type` on the `user` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(0))`.

*/
-- AlterTable
ALTER TABLE `user` DROP COLUMN `is_visitor`,
    MODIFY `membership_type` ENUM('MEMBER', 'VISITOR') NULL;
