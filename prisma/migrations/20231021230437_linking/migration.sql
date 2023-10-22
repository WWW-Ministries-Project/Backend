-- AlterTable
ALTER TABLE "department" ALTER COLUMN "department_head" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_department_head_fkey" FOREIGN KEY ("department_head") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
