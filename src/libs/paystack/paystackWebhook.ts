import { createHmac, timingSafeEqual } from "crypto";
import logger from "../../utils/logger-config";
import { resolvePaystackCredentials } from "./paystackCredentials";

/**
 * The one place this path is spelled.
 *
 * index.ts matches PAYSTACK_WEBHOOK_PATH against the full request URL to decide
 * whether to retain the raw request body. The giving option router registers the
 * handler at PAYSTACK_WEBHOOK_ROUTE, because that router is already mounted at
 * PAYSTACK_WEBHOOK_MOUNT - so it must NOT use the full path, or the route would
 * end up at /givingoption/givingoption/paystack-webhook.
 *
 * Deriving the full path from the two halves is what stops the parser and the
 * route drifting apart. Drift here fails silently: rawBody would be undefined,
 * verification would return false, and every genuine webhook would be rejected.
 */
export const PAYSTACK_WEBHOOK_MOUNT = "/givingoption";
export const PAYSTACK_WEBHOOK_ROUTE = "/paystack-webhook";
export const PAYSTACK_WEBHOOK_PATH = `${PAYSTACK_WEBHOOK_MOUNT}${PAYSTACK_WEBHOOK_ROUTE}`;

/**
 * Real Paystack webhook payloads are a few KB. This cap prevents the SHA512
 * operation from running over huge buffers - without it, anyone could trigger a
 * synchronous hash of a 25mb buffer. Note: the global express.json parser still
 * buffers and JSON-parses up to 25mb before this function is reached; this cap
 * protects only the cryptographic operation, not the overall request handling.
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
    logger.warn("[paystack-webhook] Rejected: missing or empty raw body");
    return false;
  }

  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    logger.warn(
      `[paystack-webhook] Rejected: oversized body (${rawBody.length} > ${MAX_WEBHOOK_BODY_BYTES} bytes)`,
    );
    return false;
  }

  if (typeof signature !== "string" || signature.length === 0) {
    logger.warn("[paystack-webhook] Rejected: missing or non-string signature header");
    return false;
  }

  const { secretKey } = await resolvePaystackCredentials();
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature.toLowerCase(), "utf8");

  // timingSafeEqual throws on length mismatch, so compare lengths first. A
  // wrong-length signature is already a failure, so this leaks nothing useful.
  if (expectedBuffer.length !== receivedBuffer.length) {
    logger.warn("[paystack-webhook] Rejected: signature length mismatch");
    return false;
  }

  const isValid = timingSafeEqual(expectedBuffer, receivedBuffer);
  if (!isValid) {
    logger.warn("[paystack-webhook] Rejected: digest mismatch");
  }

  return isValid;
};
