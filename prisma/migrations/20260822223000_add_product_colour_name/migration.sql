-- Admins currently pick a product colour via a raw hex swatch, so every
-- colour dropdown downstream (e.g. the admin "place order for member" form)
-- shows an unreadable hex code with no human label. This adds an optional
-- human-readable name alongside the hex value; existing rows are left NULL
-- and callers fall back to the hex string until a name is set.
ALTER TABLE `product_colour` ADD COLUMN `colour_name` VARCHAR(191) NULL;
