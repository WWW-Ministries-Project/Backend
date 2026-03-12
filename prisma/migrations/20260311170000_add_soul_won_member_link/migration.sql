ALTER TABLE `soul_won`
ADD COLUMN `memberId` INTEGER NULL;

CREATE UNIQUE INDEX `soul_won_memberId_key` ON `soul_won`(`memberId`);

ALTER TABLE `soul_won`
ADD CONSTRAINT `soulwon_member_fkey`
FOREIGN KEY (`memberId`) REFERENCES `user`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;
