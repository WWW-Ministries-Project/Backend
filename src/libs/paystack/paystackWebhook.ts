import { createHmac, timingSafeEqual } from "crypto";
import { resolvePaystackCredentials } from "./paystackCredentials";

/**
 * Real Paystack webhook payloads are a few KB. This route is unauthenticated by
 * necessity - the signature check IS the authentication - so without a ceiling
 * anyone could make the server run a synchronous SHA512 over a 25mb buffer.
 */
const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

/**
 * Verify a Paystack webhook signature against the raw request bytes.
 *
 * Paystack signs the RAW request bytes with the secret key (HMAC SHA512) and
 * sends the hex digest in the x-paystack-signature header.
 *
 * Verifying against a re-serialised body does not work: JSON.stringify of a
 * parsed object is not guaranteed to reproduce the original key order or
 * whitespace, so the digest silently stops matching for some payloads. The raw
 * buffer is captured by the express.json verify hook in index.ts.
 *
 * Throws PaystackConfigError if the secret key is unset. A 500 makes Paystack
 * retry, whereas a 401 false return would be treated as permanent, losing
 * genuine events during a misconfiguration window.
 */
export const verifyPaystackSignature = async (
  rawBody: Buffer | undefined,
  signature: unknown,
): Promise<boolean> => {
  if (!rawBody || rawBody.length === 0) {
    console.warn("[paystack-webhook] Rejected: missing or empty raw body");
    return false;
  }

  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    console.warn(
      `[paystack-webhook] Rejected: oversized body (${rawBody.length} > ${MAX_WEBHOOK_BODY_BYTES} bytes)`,
    );
    return false;
  }

  if (typeof signature !== "string" || signature.length === 0) {
    console.warn("[paystack-webhook] Rejected: missing or non-string signature header");
    return false;
  }

  const { secretKey } = await resolvePaystackCredentials();
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature.toLowerCase(), "utf8");

  // timingSafeEqual throws on length mismatch, so compare lengths first. A
  // wrong-length signature is already a failure, so this leaks nothing useful.
  if (expectedBuffer.length !== receivedBuffer.length) {
    console.warn("[paystack-webhook] Rejected: digest mismatch");
    return false;
  }

  const isValid = timingSafeEqual(expectedBuffer, receivedBuffer);
  if (!isValid) {
    console.warn("[paystack-webhook] Rejected: digest mismatch");
  }

  return isValid;
};
