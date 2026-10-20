/**
 * Pure helpers shared by the life center services. No database access here so
 * they can be unit-tested directly.
 */

export const LIFE_CENTER_ROLE_NAMES = {
  leader: "Leader",
  assistant: "Assistant leader",
  member: "Member",
} as const;

export type BuiltInRoleKey = keyof typeof LIFE_CENTER_ROLE_NAMES;

export const REMIND_LEADER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const LEADER_REMINDER_REASONS = [
  "overdue",
  "irregular",
  "attendance",
] as const;
export type LeaderReminderReason = (typeof LEADER_REMINDER_REASONS)[number];

/** "ASSISTANT_LEADER", " Assistant  Leader " and "assistant-leader" all → "assistant leader". */
export const normalizeRoleName = (name: unknown): string =>
  String(name ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const builtInRoleKey = (name: unknown): BuiltInRoleKey | null => {
  const normalized = normalizeRoleName(name);
  for (const key of Object.keys(LIFE_CENTER_ROLE_NAMES) as BuiltInRoleKey[]) {
    if (normalizeRoleName(LIFE_CENTER_ROLE_NAMES[key]) === normalized) return key;
  }
  return null;
};

export const isLeaderRoleName = (name: unknown) => builtInRoleKey(name) === "leader";
export const isMemberRoleName = (name: unknown) => builtInRoleKey(name) === "member";

/** Leader and Member are structural and can't be deleted. */
export const isProtectedRoleName = (name: unknown) => {
  const key = builtInRoleKey(name);
  return key === "leader" || key === "member";
};

/** "Monday, Wednesday" → ["Monday", "Wednesday"]. */
export const parseMeetingDays = (value: unknown): string[] =>
  String(value ?? "")
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);

/** Stored UTC date → YYYY-MM-DD. */
export const toDateKey = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

/** UTC bounds of the day the date falls on: [start, nextDayStart). */
export const utcDayBounds = (value: Date) => {
  const start = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a `YYYY-MM-DD` range boundary. `from` is the start of that UTC day,
 * `to` the last millisecond of it. Empty → undefined; invalid → throws.
 */
export const parseDateBoundary = (
  value: unknown,
  boundary: "from" | "to",
): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  if (!DATE_KEY_RE.test(raw)) {
    throw new Error(`${boundary} must be a date in YYYY-MM-DD format`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateKey(date) !== raw) {
    throw new Error(`${boundary} must be a valid date`);
  }
  return boundary === "to" ? new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1) : date;
};

/** First comma part of a location: "Adenta, Accra" → "Adenta". */
export const cityFromLocation = (location: unknown): string =>
  String(location ?? "").split(",")[0]?.trim() ?? "";

export type LifeCenterScope =
  | { mode: "all" | "member"; lifeCenterIds: number[] }
  | undefined
  | null;

export const isMemberScope = (scope: LifeCenterScope) =>
  scope?.mode === "member" && Array.isArray(scope?.lifeCenterIds);

/** True when the scope (if any) covers the center. No scope = unrestricted. */
export const scopeAllows = (scope: LifeCenterScope, lifeCenterId: number) =>
  !isMemberScope(scope) || scope!.lifeCenterIds.includes(lifeCenterId);

export const isReminderOnCooldown = (
  lastRemindedAt: Date | null | undefined,
  now: number = Date.now(),
) =>
  Boolean(lastRemindedAt) &&
  now - (lastRemindedAt as Date).getTime() < REMIND_LEADER_COOLDOWN_MS;

export const isLeaderReminderReason = (value: unknown): value is LeaderReminderReason =>
  typeof value === "string" &&
  (LEADER_REMINDER_REASONS as readonly string[]).includes(value);

export const leaderReminderCopy = (
  reason: LeaderReminderReason,
  centerName: string,
): { title: string; body: string } => {
  switch (reason) {
    case "overdue":
      return {
        title: "Record your life center meeting",
        body: `No recent meeting has been recorded for ${centerName}. Record your latest meeting, or note that it didn't hold.`,
      };
    case "irregular":
      return {
        title: "Check your meeting schedule",
        body: `Meetings for ${centerName} haven't matched the scheduled days lately. Record any meetings that held and check the schedule still works.`,
      };
    case "attendance":
    default:
      return {
        title: "Check in on attendance",
        body: `Attendance at ${centerName} has dropped in recent meetings. Check in on your members and record your next meeting.`,
      };
  }
};

/** Error carrying an HTTP status, thrown by services and mapped by controllers. */
export class LifeCenterHttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "LifeCenterHttpError";
  }
}

export const isLifeCenterHttpError = (error: unknown): error is LifeCenterHttpError =>
  error instanceof LifeCenterHttpError;
