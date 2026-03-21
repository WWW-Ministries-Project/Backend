-- Add responsible members as an array of member/user ids
ALTER TABLE `visitor`
ADD COLUMN `responsibleMembers` JSON NULL;
