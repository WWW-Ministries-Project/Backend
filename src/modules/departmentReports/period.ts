import { InputValidationError } from "../../utils/custom-error-handlers";
import { Bucket, PeriodType } from "./types";

/**
 * Report periods. All maths is in UTC (the church runs on GMT), and every
 * range is [from, to) with an exclusive end.
 *
 * Keys: WEEKLY "2026-W42" (ISO week, Monday start) · MONTHLY "2026-09" ·
 * QUARTERLY "2026-Q3" · ANNUAL "2026" · CUSTOM "2026-08-01_2026-09-30"
 * (inclusive end date in the key).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY = 86_400_000;

export const PERIOD_TYPES: PeriodType[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"];

export const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const addMonths = (date: Date, months: number) =>
  utc(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const shortDate = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
export const longDate = (date: Date) =>
  `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
export const monthLabel = (date: Date) => MONTHS[date.getUTCMonth()];

/** Monday of the ISO week containing `date`. */
const weekStart = (date: Date) => {
  const day = (date.getUTCDay() + 6) % 7;
  return utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
};

const isoWeek = (date: Date) => {
  const thursday = addDays(weekStart(date), 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = addDays(weekStart(utc(year, 0, 4)), 3);
  return { year, week: 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY)) };
};

const weekFromKey = (year: number, week: number) =>
  addDays(weekStart(utc(year, 0, 4)), (week - 1) * 7);

export interface PeriodRange {
  type: PeriodType;
  key: string;
  label: string;
  from: Date;
  to: Date;
}

const rangeLabel = (from: Date, to: Date) => {
  const last = addDays(to, -1);
  if (from.getUTCFullYear() !== last.getUTCFullYear()) return `${longDate(from)} – ${longDate(last)}`;
  if (from.getUTCMonth() !== last.getUTCMonth()) return `${shortDate(from)} – ${longDate(last)}`;
  return `${from.getUTCDate()}–${longDate(last)}`;
};

export const parsePeriod = (typeRaw: unknown, keyRaw: unknown): PeriodRange => {
  const type = String(typeRaw || "MONTHLY").toUpperCase() as PeriodType;
  if (!PERIOD_TYPES.includes(type)) throw new InputValidationError("period_type is not supported");
  const key = String(keyRaw || "").trim() || defaultPeriodKey(type, new Date());

  if (type === "WEEKLY") {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(key);
    if (!match) throw new InputValidationError("period_key must look like 2026-W42");
    const from = weekFromKey(Number(match[1]), Number(match[2]));
    const canonical = isoWeek(from);
    if (canonical.year !== Number(match[1]) || canonical.week !== Number(match[2])) {
      throw new InputValidationError(`${key} is not a week in ${match[1]}`);
    }
    const to = addDays(from, 7);
    return { type, key, from, to, label: `Week ${Number(match[2])} · ${rangeLabel(from, to)}` };
  }
  if (type === "MONTHLY") {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (!match) throw new InputValidationError("period_key must look like 2026-09");
    const from = utc(Number(match[1]), Number(match[2]) - 1);
    return { type, key, from, to: addMonths(from, 1), label: `${MONTHS_LONG[from.getUTCMonth()]} ${from.getUTCFullYear()}` };
  }
  if (type === "QUARTERLY") {
    const match = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!match) throw new InputValidationError("period_key must look like 2026-Q3");
    const q = Number(match[2]);
    const from = utc(Number(match[1]), (q - 1) * 3);
    const to = addMonths(from, 3);
    return {
      type, key, from, to,
      label: `Q${q} ${from.getUTCFullYear()} · ${MONTHS[from.getUTCMonth()]}–${MONTHS[addMonths(from, 2).getUTCMonth()]}`,
    };
  }
  if (type === "ANNUAL") {
    const match = /^(\d{4})$/.exec(key);
    if (!match) throw new InputValidationError("period_key must look like 2026");
    const from = utc(Number(match[1]), 0);
    return { type, key, from, to: utc(Number(match[1]) + 1, 0), label: match[1] };
  }
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!match) throw new InputValidationError("period_key must look like 2026-08-01_2026-09-30");
  const from = new Date(`${match[1]}T00:00:00Z`);
  const to = addDays(new Date(`${match[2]}T00:00:00Z`), 1);
  if (!(to > from)) throw new InputValidationError("Custom period must end after it starts");
  if (to.getTime() - from.getTime() > 731 * DAY) throw new InputValidationError("Custom period can be at most two years");
  return { type, key, from, to, label: rangeLabel(from, to) };
};

const keyFor = (type: PeriodType, date: Date): string => {
  if (type === "WEEKLY") {
    const { year, week } = isoWeek(date);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (type === "MONTHLY") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (type === "QUARTERLY") return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return String(date.getUTCFullYear());
};

/** The most recent completed period of a type. */
export const defaultPeriodKey = (type: PeriodType, now: Date): string => {
  if (type === "CUSTOM") {
    const to = utc(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const from = addMonths(to, -2);
    return `${isoDate(from)}_${isoDate(addDays(to, -1))}`;
  }
  const current = parsePeriod(type, keyFor(type, now));
  return keyFor(type, addDays(current.from, -1));
};

/** Options for the period picker: last completed first, then in progress, then older. */
export const periodOptions = (type: PeriodType, now: Date) => {
  if (type === "CUSTOM") {
    const range = parsePeriod("CUSTOM", defaultPeriodKey("CUSTOM", now));
    return [{ key: range.key, label: range.label, in_progress: false }];
  }
  const current = parsePeriod(type, keyFor(type, now));
  const list = [{ key: current.key, label: `${current.label} (in progress)`, in_progress: true }];
  let cursor = current;
  for (let i = 0; i < 11; i += 1) {
    cursor = parsePeriod(type, keyFor(type, addDays(cursor.from, -1)));
    list.push({ key: cursor.key, label: cursor.label, in_progress: false });
  }
  return [list[1], list[0], ...list.slice(2)];
};

export const previousRange = (range: PeriodRange) => {
  if (range.type === "CUSTOM") {
    const span = range.to.getTime() - range.from.getTime();
    const from = new Date(range.from.getTime() - span);
    return { from, to: range.from, label: `the ${Math.round(span / DAY)} days before` };
  }
  const prev = parsePeriod(range.type, keyFor(range.type, addDays(range.from, -1)));
  const label =
    range.type === "WEEKLY" ? "last week" : range.type === "MONTHLY" ? `${MONTHS[prev.from.getUTCMonth()]} ${prev.from.getUTCFullYear()}` : range.type === "QUARTERLY" ? prev.key.replace(/(\d{4})-(Q\d)/, "$2 $1") : prev.key;
  return { from: prev.from, to: prev.to, label };
};

export const yoyRange = (range: PeriodRange) => {
  const shift = (d: Date) => utc(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
  if (range.type === "WEEKLY") {
    const { year, week } = isoWeek(range.from);
    const from = weekFromKey(year - 1, week);
    return { from, to: addDays(from, 7), label: `same week ${year - 1}` };
  }
  const from = shift(range.from);
  const to = shift(range.to);
  const label =
    range.type === "MONTHLY" ? `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}` : range.type === "QUARTERLY" ? `Q${Math.floor(from.getUTCMonth() / 3) + 1} ${from.getUTCFullYear()}` : range.type === "ANNUAL" ? String(from.getUTCFullYear()) : `same dates ${from.getUTCFullYear()}`;
  return { from, to, label };
};

/** Trend buckets ending with the selected period. */
export const trendBuckets = (range: PeriodRange): Bucket[] => {
  const out: Bucket[] = [];
  if (range.type === "WEEKLY") {
    for (let i = 12; i >= 0; i -= 1) {
      const from = addDays(range.from, -7 * i);
      out.push({ label: shortDate(from), from, to: addDays(from, 7) });
    }
    return out;
  }
  if (range.type === "QUARTERLY") {
    for (let i = 7; i >= 0; i -= 1) {
      const from = addMonths(range.from, -3 * i);
      out.push({ label: `Q${Math.floor(from.getUTCMonth() / 3) + 1} ${String(from.getUTCFullYear()).slice(2)}`, from, to: addMonths(from, 3) });
    }
    return out;
  }
  if (range.type === "ANNUAL") {
    for (let i = 4; i >= 0; i -= 1) {
      const from = utc(range.from.getUTCFullYear() - i, 0);
      out.push({ label: String(from.getUTCFullYear()), from, to: utc(from.getUTCFullYear() + 1, 0) });
    }
    return out;
  }
  const endMonth = utc(addDays(range.to, -1).getUTCFullYear(), addDays(range.to, -1).getUTCMonth());
  for (let i = 11; i >= 0; i -= 1) {
    const from = addMonths(endMonth, -i);
    out.push({ label: MONTHS[from.getUTCMonth()], from, to: addMonths(from, 1) });
  }
  return out;
};

/**
 * Monday-start weeks overlapping the period: the latest 26, leaving out weeks
 * that start after `now` (unless that would leave none). Keeping the latest
 * rather than the first 26 matters for ANNUAL and long CUSTOM periods.
 */
export const weekBuckets = (range: PeriodRange, now?: Date): Bucket[] => {
  const out: Bucket[] = [];
  let cursor = weekStart(range.from);
  while (cursor < range.to) {
    out.push({ label: shortDate(cursor), from: cursor, to: addDays(cursor, 7) });
    cursor = addDays(cursor, 7);
  }
  const started = now ? out.filter((w) => w.from < now) : out;
  return (started.length ? started : out).slice(-26);
};

/** Reports are due five days after the period closes. */
export const dueDate = (range: PeriodRange) => addDays(range.to, 4);
