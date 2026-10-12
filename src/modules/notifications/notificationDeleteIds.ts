import { InputValidationError } from "../../utils/custom-error-handlers";

export const MAX_NOTIFICATION_DELETE_IDS = 500;

/**
 * `{ ids }` for POST /notifications/delete. Non-empty, at most 500, each a
 * positive integer (`in_app_notification.id` is Int); numeric strings are
 * accepted. Repeats are collapsed. Pure — unit tested without a DB.
 */
export const parseNotificationDeleteIds = (body: unknown): number[] => {
  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).ids
      : undefined;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InputValidationError("ids must be a non-empty array");
  }
  if (raw.length > MAX_NOTIFICATION_DELETE_IDS) {
    throw new InputValidationError(
      `ids must contain at most ${MAX_NOTIFICATION_DELETE_IDS} entries`,
    );
  }

  const ids = raw.map((value) => {
    const id =
      typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new InputValidationError("Every id must be a positive integer");
    }
    return id;
  });

  return Array.from(new Set(ids));
};
