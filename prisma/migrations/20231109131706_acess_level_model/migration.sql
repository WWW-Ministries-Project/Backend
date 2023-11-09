/*
  Warnings:

  - You are about to drop the `permissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "user" ADD COLUMN     "access_level_id" INTEGER;

-- DropTable
DROP TABLE "permissions";

-- CreateTable
CREATE TABLE "access_level" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "access_level_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_level_name_key" ON "access_level"("name");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_access_level_id_fkey" FOREIGN KEY ("access_level_id") REFERENCES "access_level"("id") ON DELETE SET NULL ON UPDATE CASCADE;
