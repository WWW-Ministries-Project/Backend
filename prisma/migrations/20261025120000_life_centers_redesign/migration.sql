/*
  Life centers redesign.

  - life_center gains createdAt (scheduled meetings are counted from this day)
    and lastRemindedAt (remind-leader cooldown).
  - New life_center_meeting_member: members who came to a meeting. Cascades
    with the meeting (and the user).
  - Built-in roles Leader, Assistant leader and Member are inserted when no
    role with that name exists (matched case-insensitively, "_" = space, so an
    existing "LEADER" or "ASSISTANT_LEADER" counts).

  Backfill: life_center.createdAt = earliest of the center's first meeting date
  and first soul-won date, else the migration time. Forward-only.
*/

-- AlterTable
ALTER TABLE `life_center` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `lastRemindedAt` DATETIME(3) NULL;

-- Backfill createdAt (LEAST returns NULL if either side is NULL, hence the COALESCE chain)
UPDATE `life_center` lc
    LEFT JOIN (
        SELECT `lifeCenterId`, MIN(`date`) AS `first_date`
        FROM `life_center_meeting`
        GROUP BY `lifeCenterId`
    ) m ON m.`lifeCenterId` = lc.`id`
    LEFT JOIN (
        SELECT `lifeCenterId`, MIN(`date_won`) AS `first_date`
        FROM `soul_won`
        GROUP BY `lifeCenterId`
    ) s ON s.`lifeCenterId` = lc.`id`
SET lc.`createdAt` = COALESCE(
    LEAST(m.`first_date`, s.`first_date`),
    m.`first_date`,
    s.`first_date`,
    lc.`createdAt`
);

-- CreateTable
CREATE TABLE `life_center_meeting_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `meetingId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `life_center_meeting_member_userId_idx`(`userId`),
    UNIQUE INDEX `life_center_meeting_member_meetingId_userId_key`(`meetingId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `life_center_meeting_member` ADD CONSTRAINT `life_center_meeting_member_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `life_center_meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `life_center_meeting_member` ADD CONSTRAINT `life_center_meeting_member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Built-in roles
INSERT INTO `life_center_role` (`name`)
SELECT 'Leader' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `life_center_role`
    WHERE LOWER(TRIM(REPLACE(REPLACE(`name`, '_', ' '), '-', ' '))) = 'leader'
);

INSERT INTO `life_center_role` (`name`)
SELECT 'Assistant leader' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `life_center_role`
    WHERE LOWER(TRIM(REPLACE(REPLACE(`name`, '_', ' '), '-', ' '))) = 'assistant leader'
);

INSERT INTO `life_center_role` (`name`)
SELECT 'Member' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `life_center_role`
    WHERE LOWER(TRIM(REPLACE(REPLACE(`name`, '_', ' '), '-', ' '))) = 'member'
);
