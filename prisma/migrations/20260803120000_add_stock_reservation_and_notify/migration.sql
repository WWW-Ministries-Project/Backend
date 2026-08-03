-- AlterTable: link an order line to the exact stock row it reserved, so it
-- can be released later without re-matching the display strings.
ALTER TABLE `order_items`
    ADD COLUMN `product_colour_id` INTEGER NULL,
    ADD COLUMN `size_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `order_items_product_colour_id_fkey` ON `order_items`(`product_colour_id`);

-- CreateIndex
CREATE INDEX `order_items_size_id_fkey` ON `order_items`(`size_id`);

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_colour_id_fkey`
    FOREIGN KEY (`product_colour_id`) REFERENCES `product_colour`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_size_id_fkey`
    FOREIGN KEY (`size_id`) REFERENCES `sizes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `stock_notification_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `product_colour_id` INTEGER NOT NULL,
    `size_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- CreateIndex
CREATE UNIQUE INDEX `stock_notification_requests_unique` ON `stock_notification_requests`(`user_id`, `product_colour_id`, `size_id`);

-- CreateIndex
CREATE INDEX `stock_notification_requests_colour_size_idx` ON `stock_notification_requests`(`product_colour_id`, `size_id`);

-- CreateIndex
CREATE INDEX `stock_notification_requests_user_id_fkey` ON `stock_notification_requests`(`user_id`);

-- AddForeignKey
ALTER TABLE `stock_notification_requests` ADD CONSTRAINT `stock_notification_requests_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_notification_requests` ADD CONSTRAINT `stock_notification_requests_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_notification_requests` ADD CONSTRAINT `stock_notification_requests_product_colour_id_fkey`
    FOREIGN KEY (`product_colour_id`) REFERENCES `product_colour`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_notification_requests` ADD CONSTRAINT `stock_notification_requests_size_id_fkey`
    FOREIGN KEY (`size_id`) REFERENCES `sizes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
