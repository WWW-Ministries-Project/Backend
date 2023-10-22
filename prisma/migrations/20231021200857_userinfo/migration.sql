/*
  Warnings:

  - You are about to drop the column `address` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `company` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `date_of_birth` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `gender` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `member_since` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `occupation` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `other_number` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `photo` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `primary_number` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `user` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user" DROP COLUMN "address",
DROP COLUMN "company",
DROP COLUMN "country",
DROP COLUMN "date_of_birth",
DROP COLUMN "email",
DROP COLUMN "gender",
DROP COLUMN "member_since",
DROP COLUMN "occupation",
DROP COLUMN "other_number",
DROP COLUMN "photo",
DROP COLUMN "primary_number",
DROP COLUMN "title";

-- CreateTable
CREATE TABLE "user_info" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "gender" TEXT NOT NULL,
    "primary_number" TEXT,
    "other_number" TEXT,
    "email" TEXT,
    "address" TEXT,
    "country" TEXT,
    "occupation" TEXT,
    "company" TEXT,
    "member_since" TIMESTAMP(3),
    "photo" TEXT,

    CONSTRAINT "user_info_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "user_info" ADD CONSTRAINT "user_info_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
