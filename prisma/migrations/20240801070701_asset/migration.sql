/*
  Warnings:

  - You are about to drop the column `asset_categoryId` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `asset_code` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the `asset_category` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `assets` DROP FOREIGN KEY `assets_asset_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `assets` DROP FOREIGN KEY `assets_userId_fkey`;

-- DropIndex
DROP INDEX `assets_asset_code_key` ON `assets`;

-- AlterTable
ALTER TABLE `assets` DROP COLUMN `asset_categoryId`,
    DROP COLUMN `asset_code`,
    DROP COLUMN `userId`,
    ADD COLUMN `department_assigned` INTEGER NULL,
    MODIFY `status` ENUM('ASSIGNED', 'UNASSIGNED', 'BROKEN', 'IN_MAINTENANCE') NULL;

-- DropTable
DROP TABLE `asset_category`;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_department_assigned_fkey` FOREIGN KEY (`department_assigned`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
