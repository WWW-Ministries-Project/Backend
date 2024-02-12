/*
  Warnings:

  - A unique constraint covering the columns `[asset_code]` on the table `assets` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "asset_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_code_key" ON "assets"("asset_code");
