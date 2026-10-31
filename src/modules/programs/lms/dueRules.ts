export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Week-based due rule stored on LearningUnit.due_rule. A cohort's due date is
 * derived from its startDate so every run of a program gets its own calendar.
 *
 * - mode "day":   the given weekday of week N, 23:59 UTC
 * - mode "after": N weeks in, plus `days` days after that week opens, 23:59 UTC
 */
export type DueRule = {
  week: number;
  mode: "day" | "after";
  day?: Weekday;
  days?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const parseDueRule = (value: unknown): DueRule | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const week = Number(raw.week);
  if (!Number.isInteger(week) || week < 1 || week > 104) return null;
  const mode = raw.mode === "after" ? "after" : "day";
  if (mode === "after") {
    const days = Number(raw.days);
    if (!Number.isInteger(days) || days < 0 || days > 365) return null;
    return { week, mode, days };
  }
  const day = WEEKDAYS.includes(raw.day as Weekday) ? (raw.day as Weekday) : "Sun";
  return { week, mode, day };
};

/** Returns null when the rule or the start date is unusable. */
export const dueDateFromRule = (
  startDate: Date | string | null | undefined,
  rule: DueRule | null,
): Date | null => {
  if (!rule || !startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const weekStart = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + (rule.week - 1) * 7,
  );

  let offsetDays: number;
  if (rule.mode === "after") {
    offsetDays = rule.days ?? 0;
  } else {
    const startWeekday = (new Date(weekStart).getUTCDay() + 6) % 7; // Mon = 0
    const targetWeekday = WEEKDAYS.indexOf(rule.day ?? "Sun");
    offsetDays = (targetWeekday - startWeekday + 7) % 7;
  }

  return new Date(weekStart + offsetDays * DAY_MS + (23 * 60 + 59) * 60 * 1000);
};

export const describeDueRule = (rule: DueRule | null): string => {
  if (!rule) return "No rule";
  return rule.mode === "after"
    ? `${rule.days ?? 0} days after week ${rule.week} opens`
    : `Week ${rule.week} · ${rule.day ?? "Sun"} 23:59`;
};
