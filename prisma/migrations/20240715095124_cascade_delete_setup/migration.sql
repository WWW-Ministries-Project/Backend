-- DropForeignKey
ALTER TABLE `event_attendance` DROP FOREIGN KEY `event_attendance_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_departments` DROP FOREIGN KEY `user_departments_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_info` DROP FOREIGN KEY `user_info_user_id_fkey`;

-- AddForeignKey
ALTER TABLE `user_info` ADD CONSTRAINT `user_info_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_departments` ADD CONSTRAINT `user_departments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_attendance` ADD CONSTRAINT `event_attendance_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
