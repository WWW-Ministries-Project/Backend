/** Pure channel decisions, kept import-free so they can be unit-tested without a DB. */

/** International (+ / 00) numbers must not get a country code prepended. */
export const smsCountryCodeFor = (address: string, stored: string | null): string | null => {
  const a = address.trim();
  if (a.startsWith("+") || a.startsWith("00")) return null;
  return stored ?? "+233";
};

/** Retryable unless Hubtel clearly said the request is permanently bad. */
export const isRetryableSmsError = (error: any): boolean => {
  if (error?.transient === true) return true;
  const status = error?.statusCode;
  if (status === 408 || status === 429) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return true;
  return error.transient !== false;
};

export const isValidEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export const sanitizeSubject = (s: string): string => s.replace(/[\r\n]+/g, " ");
