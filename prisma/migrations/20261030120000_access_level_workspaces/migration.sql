-- Home workspaces per access level. NULL means "derive from permissions".
ALTER TABLE `access_level` ADD COLUMN `workspaces` JSON NULL;
