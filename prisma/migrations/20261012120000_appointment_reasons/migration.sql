/*
  Configurable appointment reasons.

  Admins manage the list of reasons members pick from when booking an
  appointment. Reasons are not linked to pastors/staff, and the client-side
  "Something else" option is never stored.

  Seeds the three starting reasons. Forward-only.
*/

-- CreateTable
CREATE TABLE `appointment_reason` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `appointment_reason_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed
INSERT INTO `appointment_reason` (`label`, `sort_order`, `is_active`, `updated_at`) VALUES
    ('Marriage & family', 0, true, CURRENT_TIMESTAMP(3)),
    ('Spiritual guidance', 1, true, CURRENT_TIMESTAMP(3)),
    ('Ministry & serving', 2, true, CURRENT_TIMESTAMP(3));
