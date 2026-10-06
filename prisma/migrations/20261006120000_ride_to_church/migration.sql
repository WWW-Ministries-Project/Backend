/*
  Ride to church.

  Members offer spare seats on their way to the Sunday service; other members
  request them. A driver shares an AREA they set off from (`ride_area`) and the
  public landmarks they pass (`ride_pickup_point`) — never a home address.
  `ride_area_route` is the curated "suggested on your route" list per area,
  with typical minutes from setting off, which is how a rider is told when to
  be at a pickup point.

  `ride_offer` / `ride_offer_stop` are a driver's published ride for one
  service date; `ride_request` is a member asking for a seat on it. Phone and
  car details are only returned once a request is ACCEPTED.

  `ride_pickup_alert` is "notify me when a ride passes this point".
  `ride_report` goes to the church safety team (Membership_Management
  managers), never to the other member; `ride_block` keeps two members out of
  each other's rides.

  Seeds the Accra areas and landmarks the feature launched with. They are
  ordinary rows — the church office can add, rename or deactivate them through
  `/rides/admin/*`.

  Forward-only.
*/

-- CreateTable
CREATE TABLE `ride_area` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ride_area_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_pickup_point` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `area_label` VARCHAR(120) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ride_pickup_point_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_area_route` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `area_id` INTEGER NOT NULL,
    `pickup_point_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `minutes_from_start` INTEGER NOT NULL DEFAULT 10,

    INDEX `ride_area_route_pickup_point_id_idx`(`pickup_point_id`),
    UNIQUE INDEX `ride_area_route_area_id_pickup_point_id_key`(`area_id`, `pickup_point_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_offer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `driver_id` INTEGER NOT NULL,
    `service_date` DATE NOT NULL,
    `area_id` INTEGER NOT NULL,
    `depart_time` VARCHAR(5) NOT NULL,
    `seats_total` INTEGER NOT NULL,
    `car_details` VARCHAR(160) NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `reminder_sent` BOOLEAN NOT NULL DEFAULT false,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ride_offer_driver_id_service_date_idx`(`driver_id`, `service_date`),
    INDEX `ride_offer_service_date_status_idx`(`service_date`, `status`),
    INDEX `ride_offer_area_id_idx`(`area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_offer_stop` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `offer_id` INTEGER NOT NULL,
    `pickup_point_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `pickup_time` VARCHAR(5) NOT NULL,

    INDEX `ride_offer_stop_pickup_point_id_idx`(`pickup_point_id`),
    UNIQUE INDEX `ride_offer_stop_offer_id_pickup_point_id_key`(`offer_id`, `pickup_point_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `offer_id` INTEGER NOT NULL,
    `passenger_id` INTEGER NOT NULL,
    `pickup_point_id` INTEGER NOT NULL,
    `pickup_time` VARCHAR(5) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `decline_reason` VARCHAR(160) NULL,
    `decline_message` VARCHAR(500) NULL,
    `cancelled_by_driver` BOOLEAN NOT NULL DEFAULT false,
    `dismissed_at` DATETIME(3) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,

    INDEX `ride_request_offer_id_status_idx`(`offer_id`, `status`),
    INDEX `ride_request_passenger_id_status_idx`(`passenger_id`, `status`),
    INDEX `ride_request_pickup_point_id_idx`(`pickup_point_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_pickup_alert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `pickup_point_id` INTEGER NOT NULL,
    `service_date` DATE NOT NULL,
    `notified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ride_pickup_alert_pickup_point_id_service_date_idx`(`pickup_point_id`, `service_date`),
    UNIQUE INDEX `ride_pickup_alert_user_id_pickup_point_id_service_date_key`(`user_id`, `pickup_point_id`, `service_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reporter_id` INTEGER NOT NULL,
    `reported_user_id` INTEGER NULL,
    `offer_id` INTEGER NULL,
    `request_id` INTEGER NULL,
    `reason` VARCHAR(120) NOT NULL,
    `details` TEXT NULL,
    `blocked` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `resolution_note` TEXT NULL,
    `resolved_by` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ride_report_status_idx`(`status`),
    INDEX `ride_report_reporter_id_idx`(`reporter_id`),
    INDEX `ride_report_reported_user_id_idx`(`reported_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_block` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `blocker_id` INTEGER NOT NULL,
    `blocked_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ride_block_blocked_id_idx`(`blocked_id`),
    UNIQUE INDEX `ride_block_blocker_id_blocked_id_key`(`blocker_id`, `blocked_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ride_area_route` ADD CONSTRAINT `ride_area_route_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `ride_area`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_area_route` ADD CONSTRAINT `ride_area_route_pickup_point_id_fkey` FOREIGN KEY (`pickup_point_id`) REFERENCES `ride_pickup_point`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offer` ADD CONSTRAINT `ride_offer_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offer` ADD CONSTRAINT `ride_offer_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `ride_area`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offer_stop` ADD CONSTRAINT `ride_offer_stop_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `ride_offer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offer_stop` ADD CONSTRAINT `ride_offer_stop_pickup_point_id_fkey` FOREIGN KEY (`pickup_point_id`) REFERENCES `ride_pickup_point`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_request` ADD CONSTRAINT `ride_request_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `ride_offer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_request` ADD CONSTRAINT `ride_request_passenger_id_fkey` FOREIGN KEY (`passenger_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_request` ADD CONSTRAINT `ride_request_pickup_point_id_fkey` FOREIGN KEY (`pickup_point_id`) REFERENCES `ride_pickup_point`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_pickup_alert` ADD CONSTRAINT `ride_pickup_alert_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_pickup_alert` ADD CONSTRAINT `ride_pickup_alert_pickup_point_id_fkey` FOREIGN KEY (`pickup_point_id`) REFERENCES `ride_pickup_point`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_report` ADD CONSTRAINT `ride_report_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_report` ADD CONSTRAINT `ride_report_reported_user_id_fkey` FOREIGN KEY (`reported_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_report` ADD CONSTRAINT `ride_report_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_report` ADD CONSTRAINT `ride_report_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `ride_offer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_report` ADD CONSTRAINT `ride_report_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `ride_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_block` ADD CONSTRAINT `ride_block_blocker_id_fkey` FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_block` ADD CONSTRAINT `ride_block_blocked_id_fkey` FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: pickup points (public landmarks only)
INSERT INTO `ride_pickup_point` (`name`, `area_label`, `sort_order`, `updated_at`) VALUES
    ('A&C Mall', 'East Legon', 1, CURRENT_TIMESTAMP(3)),
    ('East Legon Shell', 'East Legon', 2, CURRENT_TIMESTAMP(3)),
    ('Airport junction', 'Airport', 3, CURRENT_TIMESTAMP(3)),
    ('37 Military Hospital', 'Cantonments', 4, CURRENT_TIMESTAMP(3)),
    ('Legon gate', 'Legon', 5, CURRENT_TIMESTAMP(3)),
    ('Atomic junction', 'Haatso', 6, CURRENT_TIMESTAMP(3)),
    ('Madina Zongo junction', 'Madina', 7, CURRENT_TIMESTAMP(3)),
    ('Shiashie', 'Shiashie', 8, CURRENT_TIMESTAMP(3)),
    ('Tetteh Quarshie', 'Tetteh Quarshie', 9, CURRENT_TIMESTAMP(3)),
    ('Accra Mall', 'Spintex Road', 10, CURRENT_TIMESTAMP(3)),
    ('Palace Mall', 'Spintex Road', 11, CURRENT_TIMESTAMP(3)),
    ('Tema Community 1', 'Tema', 12, CURRENT_TIMESTAMP(3));

-- Seed: starting areas
INSERT INTO `ride_area` (`name`, `sort_order`, `updated_at`) VALUES
    ('East Legon', 1, CURRENT_TIMESTAMP(3)),
    ('Spintex', 2, CURRENT_TIMESTAMP(3)),
    ('Madina', 3, CURRENT_TIMESTAMP(3)),
    ('Haatso', 4, CURRENT_TIMESTAMP(3)),
    ('Tema', 5, CURRENT_TIMESTAMP(3)),
    ('Adenta', 6, CURRENT_TIMESTAMP(3)),
    ('Airport Residential', 7, CURRENT_TIMESTAMP(3)),
    ('Cantonments', 8, CURRENT_TIMESTAMP(3)),
    ('Dansoman', 9, CURRENT_TIMESTAMP(3)),
    ('Kasoa', 10, CURRENT_TIMESTAMP(3));

-- Seed: landmarks each area usually passes, in order, with typical minutes from setting off
INSERT INTO `ride_area_route` (`area_id`, `pickup_point_id`, `position`, `minutes_from_start`)
SELECT a.`id`, p.`id`, r.`position`, r.`minutes`
FROM (
    SELECT 'East Legon' AS area, 'A&C Mall' AS point, 1 AS position, 10 AS minutes
    UNION ALL SELECT 'East Legon', 'East Legon Shell', 2, 12
    UNION ALL SELECT 'East Legon', 'Shiashie', 3, 13
    UNION ALL SELECT 'East Legon', 'Airport junction', 4, 17
    UNION ALL SELECT 'East Legon', '37 Military Hospital', 5, 22
    UNION ALL SELECT 'Spintex', 'Palace Mall', 1, 5
    UNION ALL SELECT 'Spintex', 'Accra Mall', 2, 10
    UNION ALL SELECT 'Spintex', 'Tetteh Quarshie', 3, 15
    UNION ALL SELECT 'Spintex', 'Airport junction', 4, 22
    UNION ALL SELECT 'Madina', 'Madina Zongo junction', 1, 5
    UNION ALL SELECT 'Madina', 'Legon gate', 2, 10
    UNION ALL SELECT 'Madina', 'Shiashie', 3, 18
    UNION ALL SELECT 'Madina', '37 Military Hospital', 4, 25
    UNION ALL SELECT 'Haatso', 'Atomic junction', 1, 5
    UNION ALL SELECT 'Haatso', 'Legon gate', 2, 10
    UNION ALL SELECT 'Haatso', 'Shiashie', 3, 17
    UNION ALL SELECT 'Haatso', 'Airport junction', 4, 22
    UNION ALL SELECT 'Tema', 'Tema Community 1', 1, 5
    UNION ALL SELECT 'Tema', 'Accra Mall', 2, 20
    UNION ALL SELECT 'Tema', 'Tetteh Quarshie', 3, 25
    UNION ALL SELECT 'Tema', '37 Military Hospital', 4, 32
    UNION ALL SELECT 'Adenta', 'Madina Zongo junction', 1, 8
    UNION ALL SELECT 'Adenta', 'Legon gate', 2, 13
    UNION ALL SELECT 'Adenta', 'A&C Mall', 3, 18
    UNION ALL SELECT 'Adenta', 'Shiashie', 4, 22
    UNION ALL SELECT 'Airport Residential', 'Airport junction', 1, 5
    UNION ALL SELECT 'Airport Residential', '37 Military Hospital', 2, 10
    UNION ALL SELECT 'Cantonments', '37 Military Hospital', 1, 5
) AS r
JOIN `ride_area` a ON a.`name` = r.area
JOIN `ride_pickup_point` p ON p.`name` = r.point;
