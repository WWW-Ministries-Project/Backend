-- CreateTable
CREATE TABLE `request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `event_id` INTEGER NOT NULL,
    `department_id` INTEGER NOT NULL,
    `request_approval_status` ENUM('Draft', 'Awaiting_HOD_Approval', 'APPROVED', 'REJECTED') NOT NULL,
    `requisition_date` DATETIME(3) NOT NULL,
    `comment` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `URL` VARCHAR(191) NOT NULL,
    `request_id` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requested_product_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unitPrice` DOUBLE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `request` ADD CONSTRAINT `request_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requested_product_item` ADD CONSTRAINT `requested_product_item_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
