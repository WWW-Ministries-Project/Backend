import axios, { AxiosError } from "axios";
import {
  PaystackConfigError,
  resolvePaystackCredentials,
} from "./paystackCredentials";

export class PaystackError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type PaystackEnvelope<T> = {
  status?: boolean;
  message?: string;
  data?: T;
};

type PaystackRequestOptions = {
  method: "get" | "post" | "put";
  path: string;
  branchId?: number | null;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
};

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Thin wrapper over the Paystack REST API.
 *
 * Errors are normalised into PaystackError so callers never have to reason
 * about axios: 4xx becomes a 422 (the caller sent something Paystack rejected),
 * anything else becomes a 502 (Paystack is the one having a bad day).
 * The secret key is never included in a thrown message or logged.
 */
export const paystackRequest = async <T>(
  options: PaystackRequestOptions,
): Promise<T> => {
  const { secretKey, baseUrl } = await resolvePaystackCredentials(
    options.branchId,
  );

  let envelope: PaystackEnvelope<T>;

  try {
    const response = await axios.request<PaystackEnvelope<T>>({
      method: options.method,
      url: `${baseUrl}${options.path}`,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      ...(options.body !== undefined && { data: options.body }),
      ...(options.params !== undefined && { params: options.params }),
      timeout: REQUEST_TIMEOUT_MS,
    });

    envelope = response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    const status = axiosError.response?.status;
    const message = axiosError.response?.data?.message;

    if (status && status >= 400 && status < 500) {
      throw new PaystackError(
        422,
        message || "Paystack rejected the request",
      );
    }

    throw new PaystackError(
      502,
      message || "Unable to reach Paystack. Please try again shortly",
    );
  }

  if (!envelope?.status) {
    throw new PaystackError(
      422,
      envelope?.message || "Paystack rejected the request",
    );
  }

  return envelope.data as T;
};

export const isPaystackFailure = (
  error: unknown,
): error is PaystackError | PaystackConfigError =>
  error instanceof PaystackError || error instanceof PaystackConfigError;
