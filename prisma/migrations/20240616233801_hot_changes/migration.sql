/*
  Warnings:

  - You are about to drop the column `Position` on the `user_work_info` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[user_id]` on the table `user_departments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `position` to the `user_work_info` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `user_work_info` DROP COLUMN `Position`,
    ADD COLUMN `position` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `user_departments_user_id_key` ON `user_departments`(`user_id`);
