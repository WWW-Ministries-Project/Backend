-- AlterTable
ALTER TABLE `appointment`
    ADD COLUMN `requesterId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `appointment_requesterId_idx` ON `appointment`(`requesterId`);
