/**
 * Payment return/cancel URLs come from the client (web and mobile send where
 * the gateway should bring the buyer back). Only this app's own origins are
 * accepted, so checkout can't be used as an open redirect.
 */

// Origins the payment gateway may send a buyer back to. The mobile app
// returns through the production dashboard's /out/verify-payment page.
const BUILT_IN_RETURN_ORIGINS = [
  "https://dashboard.worldwidewordministries.org",
  "https://dev.worldwidewordministries.org",
];

const toOrigin = (value: string | undefined | null): string | null => {
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
};

const allowedReturnOrigins = (): Set<string> => {
  const configured = [
    process.env.Frontend_URL,
    process.env.PAYSTACK_GIVING_CALLBACK_URL,
    process.env.PAYSTACK_PLEDGE_CALLBACK_URL,
    ...String(process.env.MARKETPLACE_RETURN_ORIGINS ?? "").split(","),
  ];
  return new Set(
    [...BUILT_IN_RETURN_ORIGINS, ...configured]
      .map((value) => toOrigin(value))
      .filter((origin): origin is string => Boolean(origin)),
  );
};

/**
 * Whether a client-supplied payment return/cancel URL points back at this
 * app. Anything else would turn checkout into an open redirect. Localhost is
 * accepted outside production for local development.
 */
export const isAllowedReturnUrl = (value: unknown): boolean => {
  if (typeof value !== "string" || !value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (
    process.env.NODE_ENV !== "production" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return allowedReturnOrigins().has(url.origin);
};

/** Throws when a return/cancel URL is given but points outside the app. */
export const assertReturnUrls = (...urls: (string | null | undefined)[]) => {
  for (const url of urls) {
    if (url == null || url === "") continue;
    if (!isAllowedReturnUrl(url)) {
      throw new Error("The payment return address must point back to this app.");
    }
  }
};
