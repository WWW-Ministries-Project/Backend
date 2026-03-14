-- CreateIndex
CREATE INDEX `user_department_id_idx` ON `user`(`department_id`);

-- CreateIndex
CREATE INDEX `user_membership_type_idx` ON `user`(`membership_type`);

-- CreateIndex
CREATE INDEX `user_is_user_idx` ON `user`(`is_user`);

-- CreateIndex
CREATE INDEX `user_is_active_idx` ON `user`(`is_active`);

-- CreateIndex
CREATE INDEX `user_name_idx` ON `user`(`name`);
