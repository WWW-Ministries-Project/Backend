import { InputValidationError } from "../../utils/custom-error-handlers";

/** Digits only, without a leading trunk 0 — same rule as self-service `normalizePhone`. */
export const normalizeOtherNumber = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D+/g, "").replace(/^0+/, "");
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
};

/**
 * Reads optional `contact_info.other_number` from an admin member payload.
 * - absent -> `undefined` (leave the stored value untouched)
 * - blank / null -> `null` (clear it)
 * - valid -> normalised digits
 * Throws InputValidationError (400) for a non-blank value that isn't a phone number.
 */
export const parseOtherNumber = (contactInfo: unknown): string | null | undefined => {
  if (
    !contactInfo ||
    typeof contactInfo !== "object" ||
    !Object.prototype.hasOwnProperty.call(contactInfo, "other_number")
  ) {
    return undefined;
  }

  const raw = (contactInfo as Record<string, unknown>).other_number;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;

  const normalized = normalizeOtherNumber(raw);
  if (!normalized) {
    throw new InputValidationError("Enter a valid other phone number.");
  }
  return normalized;
};
