import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { AppError } from "../../../utils/custom-error-handlers";

/** Error with an HTTP status, thrown by LMS services and mapped by `lmsHandler`. */
export class LmsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const positiveInt = (value: unknown, field: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new LmsError(`${field} must be a positive integer`);
  }
  return n;
};

export const optionalPositiveInt = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === "") return null;
  return positiveInt(value, field);
};

export const requiredText = (value: unknown, field: string, max = 191): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new LmsError(`${field} is required`);
  if (text.length > max) throw new LmsError(`${field} must be at most ${max} characters`);
  return text;
};

export const optionalDate = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new LmsError(`${field} must be a valid date`);
  return d;
};

export const requestUserId = (req: Request): number | null => {
  const id = Number((req as Request & { user?: { id?: unknown } }).user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Inline feedback left on a submission while grading. Stored on
 * `assignment_submission.inline_comments` and surfaced to both the staff
 * grading overlay and the learner's Strength/To-improve view.
 */
export type InlineComment = {
  id: string;
  text: string;
  quote?: string;
  kind?: "praise" | "improve";
};

/**
 * Validates an optional inline-comments payload. Returns `undefined` when the
 * field is omitted (callers leave the stored comments untouched) and a
 * normalized array otherwise. Each comment keeps a stable id, minting one when
 * the client did not supply it.
 */
export const normalizeInlineComments = (
  value: unknown,
  field = "comments",
): InlineComment[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new LmsError(`${field} must be an array`);
  return value.map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new LmsError(`${field}[${i}] must be an object`);
    }
    const c = raw as Record<string, unknown>;
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text) throw new LmsError(`${field}[${i}].text is required`);
    const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : randomUUID();
    const comment: InlineComment = { id, text };
    if (typeof c.quote === "string" && c.quote.trim()) comment.quote = c.quote.trim();
    if (c.kind === "praise" || c.kind === "improve") comment.kind = c.kind;
    return comment;
  });
};

/**
 * Wraps an LMS controller action: 200 with `{ message, data }`, LmsError → its
 * status, anything else → 500. Matches the response shape of the other
 * program controllers.
 */
export const lmsHandler =
  (successMessage: string, action: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const data = await action(req);
      return res.status(200).json({ message: successMessage, data });
    } catch (error: any) {
      // LmsError, or the shared AppError family (InputValidationError, NotFoundError, …).
      const status =
        error instanceof LmsError
          ? error.status
          : error instanceof AppError
            ? error.statusCode
            : 500;
      const known = status < 500;
      return res.status(status).json({
        message: known ? error.message : "Something went wrong",
        error: error?.message,
      });
    }
  };
