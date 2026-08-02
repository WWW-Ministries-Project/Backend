import { paystackRequest } from "./paystackClient";

export type PaystackInitializeInput = {
  email: string;
  /** Minor units (pesewas). Paystack rejects decimals here. */
  amount: number;
  currency: string;
  reference: string;
  subaccount: string;
  /** "subaccount" - the giving option bears the Paystack fee, not a main account */
  bearer: string;
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
  /** Minor units, as collected */
  amount: number;
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
