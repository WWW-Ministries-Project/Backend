-- 20261025120000_life_centers_redesign added a "Leader" role where the church
-- already had one under another name (e.g. "CENTER LEADER"). Move anyone on the
-- added role to the existing one, then remove the duplicate.

UPDATE `life_center_member` m
JOIN `life_center_role` dup
  ON dup.id = m.roleId
 AND LOWER(TRIM(REPLACE(REPLACE(dup.name, '_', ' '), '-', ' '))) = 'leader'
JOIN (
  SELECT MIN(id) AS id FROM `life_center_role`
  WHERE LOWER(TRIM(REPLACE(REPLACE(name, '_', ' '), '-', ' '))) IN
    ('center leader', 'life center leader', 'lifecenter leader', 'centre leader', 'life centre leader')
) keep ON keep.id IS NOT NULL
SET m.roleId = keep.id;

DELETE dup FROM `life_center_role` dup
JOIN (
  SELECT MIN(id) AS id FROM `life_center_role`
  WHERE LOWER(TRIM(REPLACE(REPLACE(name, '_', ' '), '-', ' '))) IN
    ('center leader', 'life center leader', 'lifecenter leader', 'centre leader', 'life centre leader')
) keep ON keep.id IS NOT NULL
WHERE LOWER(TRIM(REPLACE(REPLACE(dup.name, '_', ' '), '-', ' '))) = 'leader'
  AND dup.id <> keep.id;
