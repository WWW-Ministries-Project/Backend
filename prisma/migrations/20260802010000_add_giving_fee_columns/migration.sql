-- The donor now bears the Paystack fee: the charge is grossed up so the giving
-- option's subaccount receives the full donation. That means three distinct
-- figures per contribution, where there used to be one.
--
-- `amount` keeps its meaning (the donation, what the subaccount receives).
-- Existing rows predate the gross-up, so fee 0 and a null amount_charged are
-- correct for them: nothing was added on top.

-- AlterTable
ALTER TABLE `givingContribution`
    ADD COLUMN `fee` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `amount_charged` INTEGER NULL,
    ADD COLUMN `fee_actual` INTEGER NULL;
