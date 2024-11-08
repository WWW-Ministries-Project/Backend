/*
  Warnings:

  - Added the required column `currency` to the `request` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantity` to the `requested_product_item` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `request` ADD COLUMN `currency` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `requested_product_item` ADD COLUMN `quantity` INTEGER NOT NULL;
