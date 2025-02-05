-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_hod_user_id_fkey` FOREIGN KEY (`hod_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_ps_user_id_fkey` FOREIGN KEY (`ps_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
