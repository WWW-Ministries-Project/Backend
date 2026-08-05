-- Add a booking-reason category label to positions (e.g. "Marriage & family",
-- "Spiritual guidance", "Ministry & serving", "Something else") so staff can be
-- filtered by reason when booking an appointment.
ALTER TABLE `position` ADD COLUMN `category` VARCHAR(191) NULL;
