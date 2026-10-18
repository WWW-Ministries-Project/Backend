/*
  Marketplace fulfilment: pickup vs delivery on orders.

  Additive only (one new enum column with a default, one nullable column, one
  defaulted column), so existing rows and older clients are unaffected:
  - fulfilment_method: pickup (default, every existing order) or delivery.
  - delivery_address: free-text address, only set for delivery orders.
  - delivery_fee: fee charged on top of the item subtotal (0 for pickup).
    orders.total_amount already includes it.
*/

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `delivery_address` TEXT NULL,
    ADD COLUMN `delivery_fee` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `fulfilment_method` ENUM('pickup', 'delivery') NOT NULL DEFAULT 'pickup';
