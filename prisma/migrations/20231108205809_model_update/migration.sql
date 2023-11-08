/*
  Warnings:

  - A unique constraint covering the columns `[user_id]` on the table `user_info` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_info_user_id_key" ON "user_info"("user_id");
