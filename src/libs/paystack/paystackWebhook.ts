import { createHmac, timingSafeEqual } from "crypto";
import { resolvePaystackCredentials } from "./paystackCredentials";

/**
 * Paystack signs the RAW request bytes with the secret key (HMAC SHA512) and
 * sends the hex digest in x-paystack-signature.
 *
 * Verifying against a re-serialised body does not work: JSON.stringify of a
 * parsed object is not guaranteed to reproduce the original key order or
 * whitespace, so the digest silently stops matching for some payloads. The raw
 * buffer is captured by the express.json verify hook in index.ts.
 */
export const verifyPaystackSignature = async (
  rawBody: Buffer | undefined,
  signature: unknown,
  branchId?: number | null,
): Promise<boolean> => {
  if (!rawBody || rawBody.length === 0) {
    return false;
  }

  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }

  const { secretKey } = await resolvePaystackCredentials(branchId);
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  // timingSafeEqual throws on length mismatch, so compare lengths first. A
  // wrong-length signature is already a failure, so this leaks nothing useful.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
};
