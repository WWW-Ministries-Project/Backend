/**
 * Single place that knows how to obtain Paystack credentials.
 *
 * Today every branch shares the one organisation-wide secret key from the
 * environment. When per-branch keys land, this resolver is the only thing that
 * changes: look the branch up, fall back to the env key, return the same shape.
 * Nothing else in the codebase should read PAYSTACK_SECRET_KEY directly.
 */
export class PaystackConfigError extends Error {
  statusCode = 500;
}

export type PaystackCredentials = {
  secretKey: string;
  baseUrl: string;
};

const DEFAULT_BASE_URL = "https://api.paystack.co";

export const resolvePaystackCredentials = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _branchId?: number | null,
): Promise<PaystackCredentials> => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new PaystackConfigError(
      "Paystack is not configured. Set PAYSTACK_SECRET_KEY on the server",
    );
  }

  const baseUrl = process.env.PAYSTACK_BASE_URL?.trim() || DEFAULT_BASE_URL;

  return {
    secretKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
};
