/*
  Membership redesign (round 2): record where a member came from.
  Additive only (nullable columns, ON DELETE SET NULL):
  - user.source_visitor_id  -> visitor.id   (converted from a visitor)
  - user.source_soul_won_id -> soul_won.id  (converted from a soul-won record)

  Best-effort backfill (rows that already have a value are never touched):
  - Soul won: soul_won.memberId already links the member directly, so every
    soul_won row with a memberId sets that user's source_soul_won_id.
  - Visitors: visitors flagged is_member = 1 with a non-empty email are linked
    to the user whose email matches case-insensitively (trimmed). Matches are
    only made when the email is unique on BOTH sides (exactly one member
    visitor and exactly one user with that normalised email); ambiguous or
    missing matches are skipped and stay null.
*/

-- AlterTable
ALTER TABLE `user` ADD COLUMN `source_visitor_id` INTEGER NULL,
    ADD COLUMN `source_soul_won_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `user_source_visitor_id_idx` ON `user`(`source_visitor_id`);

-- CreateIndex
CREATE INDEX `user_source_soul_won_id_idx` ON `user`(`source_soul_won_id`);

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_source_visitor_id_fkey` FOREIGN KEY (`source_visitor_id`) REFERENCES `visitor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_source_soul_won_id_fkey` FOREIGN KEY (`source_soul_won_id`) REFERENCES `soul_won`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: soul-won conversions (direct link via soul_won.memberId, which is unique).
UPDATE `user` u
JOIN `soul_won` s ON s.`memberId` = u.`id`
SET u.`source_soul_won_id` = s.`id`
WHERE u.`source_soul_won_id` IS NULL;

-- Backfill: visitor conversions (unique case-insensitive email match only).
-- Both derived tables use GROUP BY/HAVING, so MySQL materialises them and the
-- self-reference to `user` is allowed in this UPDATE.
UPDATE `user` u
JOIN (
  SELECT LOWER(TRIM(v.`email`)) AS email_key, MIN(v.`id`) AS visitor_id
  FROM `visitor` v
  WHERE v.`is_member` = 1
    AND v.`email` IS NOT NULL
    AND TRIM(v.`email`) <> ''
  GROUP BY LOWER(TRIM(v.`email`))
  HAVING COUNT(*) = 1
) vm ON vm.`email_key` = LOWER(TRIM(u.`email`))
JOIN (
  SELECT LOWER(TRIM(uu.`email`)) AS email_key
  FROM `user` uu
  WHERE uu.`email` IS NOT NULL
    AND TRIM(uu.`email`) <> ''
  GROUP BY LOWER(TRIM(uu.`email`))
  HAVING COUNT(*) = 1
) um ON um.`email_key` = vm.`email_key`
SET u.`source_visitor_id` = vm.`visitor_id`
WHERE u.`source_visitor_id` IS NULL;
