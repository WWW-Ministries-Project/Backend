/**
 * Pure helpers for Community: enum lists, request parsing, labels and text
 * previews. No Prisma, no I/O.
 */
import {
  community_audience,
  community_post_type,
  community_reaction_type,
  community_report_reason,
} from "@prisma/client";
import { InputValidationError } from "../../utils/custom-error-handlers";

export const POST_TYPES: community_post_type[] = [
  "PRAYER",
  "TESTIMONY",
  "DISCUSSION",
  "CELEBRATION",
  "QUESTION",
  "MESSAGE",
  "GENERAL",
];

export const AUDIENCES: community_audience[] = [
  "CHURCH",
  "DEPARTMENT",
  "SELECTED",
  "ONLY_ME",
];

/** Every post carries all five; comments only PRAY and LOVE. */
export const POST_REACTIONS: community_reaction_type[] = [
  "PRAY",
  "LOVE",
  "PRAISE",
  "CELEBRATE",
  "SUPPORT",
];
export const COMMENT_REACTIONS: community_reaction_type[] = ["PRAY", "LOVE"];

export const REPORT_REASONS: community_report_reason[] = [
  "INAPPROPRIATE",
  "HARASSMENT",
  "SAFEGUARDING",
  "SPAM",
  "MISLEADING",
  "OTHER",
];

export const MAX_BODY_LENGTH = 5000;
export const MAX_REPORT_DETAILS_LENGTH = 1000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_URL_LENGTH = 1024;
/** Important posts newer than this are pinned to the top of the feed. */
export const IMPORTANT_PIN_DAYS = 7;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_MEMBER_SEARCH = 20;

/** Lower-case label used in notification copy: "commented on your testimony". */
export const TYPE_LABEL: Record<community_post_type, string> = {
  PRAYER: "prayer request",
  TESTIMONY: "testimony",
  DISCUSSION: "discussion",
  CELEBRATION: "celebration",
  QUESTION: "question",
  MESSAGE: "message",
  GENERAL: "post",
};

export const withArticle = (label: string): string =>
  `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

export const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const toNonNegativeInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const parsePaging = (
  query: { skip?: unknown; take?: unknown },
  defaultTake = DEFAULT_PAGE_SIZE,
  maxTake = MAX_PAGE_SIZE,
) => {
  const skip = toNonNegativeInt(query.skip, 0);
  const take = Math.min(toPositiveInt(query.take) ?? defaultTake, maxTake);
  return { skip, take };
};

export const parseEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new InputValidationError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return normalized as T;
};

export const parseBody = (value: unknown, field = "body"): string => {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (!text) {
    throw new InputValidationError(`${field} is required`);
  }
  if (text.length > MAX_BODY_LENGTH) {
    throw new InputValidationError(`${field} must be ${MAX_BODY_LENGTH} characters or fewer`);
  }
  return text;
};

export const parseBoolean = (value: unknown): boolean =>
  value === true || value === "true" || value === 1 || value === "1";

export const initialsOf = (name?: string | null): string =>
  String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

/** One-line excerpt for notification copy. */
export const preview = (text: string, max = 140): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** UTC calendar day, used to dedupe "reactions on your post" per day. */
export const dayKey = (date: Date = new Date()): string => date.toISOString().slice(0, 10);

export const distinctIds = (ids: (number | null | undefined)[]): number[] =>
  Array.from(
    new Set(ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)),
  );
