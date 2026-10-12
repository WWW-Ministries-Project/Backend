import { InputValidationError } from "../../utils/custom-error-handlers";

/*
  Pure input rules for appointment reasons — no Prisma, so they are unit
  tested directly (appointment-reason-validation.test.ts).
*/

export const REASON_LABEL_MIN = 2;
export const REASON_LABEL_MAX = 120;
export const REASON_DESCRIPTION_MAX = 255;
export const REASON_REORDER_MAX = 500;

export type ReasonCreateInput = {
  label: string;
  description: string | null;
  is_active: boolean;
};

export type ReasonUpdateInput = Partial<ReasonCreateInput>;

const asBody = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

/** Trimmed label with inner whitespace collapsed; throws when out of range. */
export const normalizeReasonLabel = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new InputValidationError("Reason label is required");
  }
  const label = value.trim().replace(/\s+/g, " ");
  if (label.length < REASON_LABEL_MIN) {
    throw new InputValidationError(
      `Reason label must be at least ${REASON_LABEL_MIN} characters`,
    );
  }
  if (label.length > REASON_LABEL_MAX) {
    throw new InputValidationError(
      `Reason label must be at most ${REASON_LABEL_MAX} characters`,
    );
  }
  return label;
};

/** Trimmed description; empty or null clears it. */
export const normalizeReasonDescription = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InputValidationError("Reason description must be text");
  }
  const description = value.trim();
  if (!description) return null;
  if (description.length > REASON_DESCRIPTION_MAX) {
    throw new InputValidationError(
      `Reason description must be at most ${REASON_DESCRIPTION_MAX} characters`,
    );
  }
  return description;
};

export const normalizeReasonActive = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  throw new InputValidationError("is_active must be a boolean");
};

export const parseReasonCreate = (body: unknown): ReasonCreateInput => {
  const input = asBody(body);
  return {
    label: normalizeReasonLabel(input.label),
    description: normalizeReasonDescription(input.description),
    is_active:
      input.is_active === undefined ? true : normalizeReasonActive(input.is_active),
  };
};

/** Partial update: only keys present in the body are returned. */
export const parseReasonUpdate = (body: unknown): ReasonUpdateInput => {
  const input = asBody(body);
  const data: ReasonUpdateInput = {};
  if (input.label !== undefined) data.label = normalizeReasonLabel(input.label);
  if (input.description !== undefined) {
    data.description = normalizeReasonDescription(input.description);
  }
  if (input.is_active !== undefined) {
    data.is_active = normalizeReasonActive(input.is_active);
  }
  if (Object.keys(data).length === 0) {
    throw new InputValidationError(
      "Provide at least one of label, description or is_active",
    );
  }
  return data;
};

export const parseReasonId = (value: unknown): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InputValidationError("Reason id must be a positive integer");
  }
  return id;
};

/** `{ ids: number[] }` for reorder: non-empty, positive ints, no repeats. */
export const parseReorderIds = (body: unknown): number[] => {
  const raw = asBody(body).ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InputValidationError("ids must be a non-empty array");
  }
  if (raw.length > REASON_REORDER_MAX) {
    throw new InputValidationError(
      `ids must contain at most ${REASON_REORDER_MAX} entries`,
    );
  }
  const ids = raw.map((value) => {
    const id = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      throw new InputValidationError("Every id must be a positive integer");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new InputValidationError("ids must not contain duplicates");
  }
  return ids;
};

/** Case-insensitive label clash, ignoring the row being edited. */
export const findDuplicateLabel = (
  label: string,
  existing: Array<{ id: number; label: string }>,
  ignoreId?: number,
): boolean => {
  const key = label.toLocaleLowerCase();
  return existing.some(
    (row) => row.id !== ignoreId && row.label.trim().toLocaleLowerCase() === key,
  );
};

export type SerializedReason = {
  id: number;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const serializeReason = (row: {
  id: number;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): SerializedReason => ({
  id: row.id,
  label: row.label,
  description: row.description ?? null,
  sort_order: row.sort_order,
  is_active: row.is_active,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});
