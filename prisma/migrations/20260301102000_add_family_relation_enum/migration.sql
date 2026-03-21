UPDATE `family_relation`
SET `relation` = CASE
  WHEN LOWER(TRIM(`relation`)) IN ('spouse', 'wife', 'husband') THEN 'SPOUSE'
  WHEN LOWER(TRIM(`relation`)) IN ('parent', 'father', 'mother') THEN 'PARENT'
  WHEN LOWER(TRIM(`relation`)) IN ('child', 'children', 'son', 'daughter', 'kid', 'ward') THEN 'CHILD'
  WHEN LOWER(TRIM(`relation`)) IN ('sibling', 'siblings', 'brother', 'sister', 'bro', 'sis', 'sibs') THEN 'SIBLING'
  WHEN LOWER(TRIM(`relation`)) IN ('guardian') THEN 'GUARDIAN'
  WHEN LOWER(TRIM(`relation`)) IN ('dependent') THEN 'DEPENDENT'
  WHEN LOWER(TRIM(`relation`)) IN ('grandparent', 'grandfather', 'grandmother') THEN 'GRANDPARENT'
  WHEN LOWER(TRIM(`relation`)) IN ('grandchild', 'grandson', 'granddaughter') THEN 'GRANDCHILD'
  WHEN LOWER(TRIM(`relation`)) IN ('in-law', 'in law', 'in_law', 'inlaw') THEN 'IN_LAW'
  ELSE UPPER(TRIM(`relation`))
END;

ALTER TABLE `family_relation`
  MODIFY `relation` ENUM(
    'SPOUSE',
    'PARENT',
    'CHILD',
    'SIBLING',
    'GUARDIAN',
    'DEPENDENT',
    'GRANDPARENT',
    'GRANDCHILD',
    'IN_LAW'
  ) NOT NULL;
