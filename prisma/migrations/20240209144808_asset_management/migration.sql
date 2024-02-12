-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('ASSIGNED', 'UNASSIGNED', 'BROKEN', 'IN_MAINTENANCE');

-- CreateTable
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "asset_categoryId" INTEGER,
    "userId" INTEGER,
    "date_assigned" TIMESTAMP(3),
    "date_purchased" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "description" TEXT,
    "status" "asset_status" NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "asset_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status_update" "asset_status" NOT NULL,
    "update_date" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_categoryId_fkey" FOREIGN KEY ("asset_categoryId") REFERENCES "asset_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
