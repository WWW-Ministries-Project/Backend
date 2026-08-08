import { paystackRequest } from "./paystackClient";

export type PaystackInitializeInput = {
  email: string;
  /**
   * Minor units (pesewas). Paystack rejects decimals here.
   *
   * For giving this is the GROSSED-UP total: the donation plus the fee the
   * donor is covering, which is what the card is actually charged.
   */
  amount: number;
  currency: string;
  reference: string;
  /** Omit for a plain charge to the main account (no split payment). */
  subaccount?: string;
  /**
   * Flat amount, in minor units, routed to the main account rather than the
   * subaccount. Set to the fee, so the subaccount receives exactly the donation
   * and the main account nets zero once it pays the fee.
   */
  transaction_charge?: number;
  /**
   * "account" - the main account is the fee bearer, having just been routed
   * exactly the fee via transaction_charge. NOT "subaccount": Paystack rejects
   * a subaccount that both receives the whole amount and bears the fee with
   * "Invalid split transaction values".
   */
  bearer?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
};

export type PaystackInitializeResult = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackTransaction = {
  id?: number;
  /** "success" | "failed" | "abandoned" | "ongoing" | ... */
  status: string;
  reference: string;
  /** Minor units, as collected. For giving this is the grossed-up total. */
  amount: number;
  /**
   * The fee Paystack actually charged, in minor units. Compared against the fee
   * we grossed up by, so a stale configured rate shows up as a logged mismatch
   * rather than quietly leaving a fund short.
   */
  fees?: number | null;
  currency?: string;
  channel?: string | null;
  paid_at?: string | null;
  gateway_response?: string | null;
};

export const initializeTransaction = (
  input: PaystackInitializeInput,
  branchId?: number | null,
): Promise<PaystackInitializeResult> =>
  paystackRequest<PaystackInitializeResult>({
    method: "post",
    path: "/transaction/initialize",
    branchId,
    body: input,
  });

export const verifyTransaction = (
  reference: string,
  branchId?: number | null,
): Promise<PaystackTransaction> =>
  paystackRequest<PaystackTransaction>({
    method: "get",
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
    branchId,
  });
