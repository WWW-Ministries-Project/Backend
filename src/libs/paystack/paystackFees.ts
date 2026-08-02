/**
 * The Paystack fee on a giving payment is borne by the DONOR, not by the church
 * and not by the fund. The charge is grossed up — the donor is charged
 * `donation + fee`, the fee is routed to the main account as a flat
 * `transaction_charge`, and the giving option's subaccount receives the full
 * donation the donor chose.
 *
 * Paystack has no "donor bears the fee" flag, and the combination the original
 * design assumed (100% to the subaccount with the subaccount bearing the fee)
 * is rejected outright: "Invalid split transaction values". A subaccount cannot
 * receive the whole amount and also pay the fee out of it.
 *
 * These rates are CONFIGURATION, not constants of nature. They default to
 * Paystack's standard published Ghana schedule, but an account with negotiated
 * rates must override them — otherwise every donation is grossed up by the
 * wrong amount. `settleContribution` compares this computed fee against the fee
 * Paystack actually reports and logs a mismatch, so a wrong rate here surfaces
 * in the logs rather than silently short-changing a fund.
 */

const DEFAULT_FEE_PERCENT = 1.95;
/** GHS 100.00. Paystack caps the domestic fee. */
const DEFAULT_FEE_CAP_MINOR_UNITS = 10_000;
const DEFAULT_FEE_FLAT_MINOR_UNITS = 0;

const readNumber = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw?.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export type PaystackFeeSchedule = {
  percent: number;
  capMinorUnits: number;
  flatMinorUnits: number;
};

export const resolveFeeSchedule = (): PaystackFeeSchedule => ({
  percent: readNumber(process.env.PAYSTACK_FEE_PERCENT, DEFAULT_FEE_PERCENT),
  capMinorUnits: readNumber(
    process.env.PAYSTACK_FEE_CAP_MINOR_UNITS,
    DEFAULT_FEE_CAP_MINOR_UNITS,
  ),
  flatMinorUnits: readNumber(
    process.env.PAYSTACK_FEE_FLAT_MINOR_UNITS,
    DEFAULT_FEE_FLAT_MINOR_UNITS,
  ),
});

/**
 * The fee to add on top of a donation, in minor units.
 *
 * Rounds UP deliberately. Rounding down would leave the fund a pesewa or two
 * short of what the donor chose to give, which is the one outcome this whole
 * mechanism exists to prevent; rounding up leaves at most a pesewa in the main
 * account instead.
 */
export const computeDonorBorneFee = (
  donationMinorUnits: number,
  schedule: PaystackFeeSchedule = resolveFeeSchedule(),
): number => {
  if (!Number.isInteger(donationMinorUnits) || donationMinorUnits <= 0) {
    return 0;
  }

  const percentPart = Math.ceil(
    (donationMinorUnits * schedule.percent) / 100,
  );
  const fee = percentPart + schedule.flatMinorUnits;

  return Math.min(fee, schedule.capMinorUnits);
};
